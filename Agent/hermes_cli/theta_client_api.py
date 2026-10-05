"""Theta: endpoints that let the Desktop app be a pure client.

Everything the app used to do on its own machine (reading .env/auth.json,
staging attachment files, discovering provider models with local keys,
renaming sessions in a local cache) now happens on the server, so the app
works the same whether the server is local or remote.

Mounted on the REST server (``hermes_cli.web_server``):

* ``/v1/{path}``                       -> forwarded to the gateway API server,
                                          streaming (chat, transcribe, ...).
                                          One address serves the whole app.
* ``POST /api/attachments``            -> store an uploaded file in the
                                          server workspace; returns its path.
* ``PATCH /api/sessions/{id}``         -> rename a session.
* ``GET/PUT /api/credential-pool``     -> provider credential pool.
* ``POST /api/providers/models``       -> list a provider's models using the
                                          server's own keys.
"""

from __future__ import annotations

import base64
import os
import re
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter()

MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
_HOP_HEADERS = {
    "host", "content-length", "connection", "keep-alive", "transfer-encoding",
    "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate",
}


def _gateway_base() -> str:
    port = os.getenv("API_SERVER_PORT", "8642").strip() or "8642"
    return f"http://127.0.0.1:{port}"


def _is_loopback(request: Request) -> bool:
    host = request.client.host if request.client else ""
    return host in ("127.0.0.1", "::1", "localhost")


@contextmanager
def _profile_scope(profile: Optional[str]) -> Iterator[None]:
    """Run against a profile's home (context-local, like agent scopes)."""
    if not profile or profile == "default":
        yield
        return
    from hermes_cli.profiles import get_profile_dir, profile_exists
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    if not profile_exists(profile):
        raise HTTPException(status_code=404, detail=f"Profile '{profile}' not found")
    token = set_hermes_home_override(get_profile_dir(profile))
    try:
        yield
    finally:
        reset_hermes_home_override(token)


# ---------------------------------------------------------------------------
# /v1 -> gateway
# ---------------------------------------------------------------------------

@router.api_route("/v1/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def forward_to_gateway(path: str, request: Request):
    import httpx

    headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_HEADERS}
    # Local clients are trusted by this server already (same rule as /api);
    # give them the gateway key so the app never needs to read it from disk.
    if _is_loopback(request) and not any(k.lower() == "authorization" for k in headers):
        key = os.getenv("API_SERVER_KEY", "").strip()
        if key:
            headers["Authorization"] = f"Bearer {key}"

    url = f"{_gateway_base()}/v1/{path}"
    body = await request.body()
    client = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=None, write=60.0, pool=10.0))
    try:
        upstream = await client.send(
            client.build_request(request.method, url, params=request.query_params,
                                 headers=headers, content=body),
            stream=True,
        )
    except httpx.HTTPError as exc:
        await client.aclose()
        return JSONResponse(
            {"error": {"message": f"Chat server unreachable: {exc}", "type": "gateway_unavailable"}},
            status_code=502,
        )

    async def relay():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    out_headers = {k: v for k, v in upstream.headers.items()
                   if k.lower() not in _HOP_HEADERS and k.lower() != "content-encoding"}
    return StreamingResponse(relay(), status_code=upstream.status_code, headers=out_headers)


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------

def _safe_segment(value: str, fallback: str) -> str:
    cleaned = re.sub(r'[\x00-\x1f<>:"/\\|?*]', "", value or "")
    cleaned = re.sub(r"\s+", "_", cleaned).replace("..", ".").strip(". ")
    return cleaned[:200] or fallback


def attachments_dir(session_id: str) -> Path:
    from hermes_constants import get_default_hermes_root

    return get_default_hermes_root() / "workspace" / "uploads" / _safe_segment(session_id, "unsorted")


@router.post("/api/attachments")
async def upload_attachment(body: dict):
    filename = _safe_segment(str(body.get("filename") or ""), "attachment")
    try:
        data = base64.b64decode(str(body.get("data") or ""), validate=True)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="data must be base64")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="Attachment too large (max 50 MB)")
    folder = attachments_dir(str(body.get("session_id") or ""))
    folder.mkdir(parents=True, exist_ok=True)
    stem, dot, ext = filename.rpartition(".")
    target = folder / filename
    n = 1
    while target.exists():
        target = folder / (f"{stem}-{n}.{ext}" if dot else f"{filename}-{n}")
        n += 1
    target.write_bytes(data)
    return {"ok": True, "path": str(target), "size": len(data)}


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

@router.patch("/api/sessions/{session_id}")
async def update_session(session_id: str, body: dict):
    """Rename, pin/unpin or archive/unarchive a conversation."""
    from gateway import agent_roster
    from hermes_state import SessionDB

    has_title = "title" in body
    title = " ".join(str(body.get("title") or "").split())[:200]
    if has_title and not title:
        raise HTTPException(status_code=400, detail="title must not be empty")
    if not has_title and "pinned" not in body and "archived" not in body:
        raise HTTPException(status_code=400, detail="nothing to update")
    db = SessionDB()
    try:
        sid = db.resolve_session_id(session_id) or session_id
        if db.get_session(sid) is None:
            raise HTTPException(status_code=404, detail="Session not found")
        result: dict = {"ok": True, "session_id": sid}
        if has_title:
            db.set_session_title(sid, title)
            result["title"] = title
    finally:
        db.close()
    if "pinned" in body or "archived" in body:
        result.update(agent_roster.set_session_flags(
            sid, pinned=body.get("pinned"), archived=body.get("archived")))
    return result


# ---------------------------------------------------------------------------
# Credential pool
# ---------------------------------------------------------------------------

# Secret fields in pool entries. Values never leave the server in full:
# clients get a mask ending in the last 4 characters, and a masked value
# sent back on save means "keep the stored secret".
_SECRET_FIELDS = ("access_token", "refresh_token", "api_key", "key")
MASK_PREFIX = "••••"


def mask_secret(value: Any) -> Any:
    if not isinstance(value, str) or not value:
        return value
    return MASK_PREFIX + value[-4:] if len(value) > 8 else MASK_PREFIX


def mask_pool(pool: dict) -> dict:
    return {
        provider: [
            {k: (mask_secret(v) if k in _SECRET_FIELDS else v) for k, v in entry.items()}
            if isinstance(entry, dict) else entry
            for entry in (entries or [])
        ]
        for provider, entries in (pool or {}).items()
    }


def unmask_entries(entries: list, existing: list) -> list:
    """Replace masked secrets with the stored values they stand for."""
    stored = [e for e in existing if isinstance(e, dict)]
    out = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        entry = dict(entry)
        for field in _SECRET_FIELDS:
            value = entry.get(field)
            if isinstance(value, str) and value.startswith(MASK_PREFIX):
                tail = value[len(MASK_PREFIX):]
                match = next(
                    (e for e in stored
                     if (entry.get("id") and e.get("id") == entry.get("id"))
                     or (tail and any(isinstance(e.get(f), str) and e[f].endswith(tail)
                                      for f in _SECRET_FIELDS))),
                    None,
                )
                original = None
                if match:
                    original = match.get(field) or next(
                        (match[f] for f in _SECRET_FIELDS if isinstance(match.get(f), str) and match[f]), None)
                if original:
                    entry[field] = original
                else:
                    entry.pop(field)
        out.append(entry)
    return out


@router.get("/api/credential-pool")
async def get_credential_pool(profile: Optional[str] = None):
    from hermes_cli.auth import read_credential_pool

    with _profile_scope(profile):
        pool = read_credential_pool(None) or {}
    return {"pool": mask_pool(pool)}


@router.put("/api/credential-pool")
async def put_credential_pool(body: dict, profile: Optional[str] = None):
    from hermes_cli.auth import read_credential_pool, write_credential_pool

    provider = str(body.get("provider") or "").strip()
    entries = body.get("entries")
    if not provider or not isinstance(entries, list):
        raise HTTPException(status_code=400, detail="provider and entries are required")
    with _profile_scope(profile):
        existing = (read_credential_pool(None) or {}).get(provider) or []
        write_credential_pool(provider, unmask_entries(entries, existing))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Provider model discovery
# ---------------------------------------------------------------------------

_DISCOVERY_CACHE: dict[tuple, tuple[float, list]] = {}
_DISCOVERY_TTL = 600.0


@router.post("/api/providers/models")
async def discover_provider_models(body: dict, profile: Optional[str] = None):
    import asyncio

    from hermes_cli.models import probe_api_models
    from hermes_cli.runtime_provider import resolve_runtime_provider

    provider = str(body.get("provider") or "").strip().lower()
    base_url = str(body.get("base_url") or "").strip().rstrip("/") or None
    api_key = str(body.get("api_key") or "").strip() or None
    if not provider and not base_url:
        return {"models": [], "status": "unknown-host", "cached": False}

    with _profile_scope(profile):
        if not api_key or not base_url:
            try:
                runtime = resolve_runtime_provider(requested=provider or "custom",
                                                   explicit_base_url=base_url)
            except Exception:
                runtime = {}
            api_key = api_key or runtime.get("api_key")
            base_url = base_url or runtime.get("base_url")
    if not base_url:
        return {"models": [], "status": "unknown-host", "cached": False}

    key = (provider, base_url)
    cached = _DISCOVERY_CACHE.get(key)
    if cached and time.time() - cached[0] < _DISCOVERY_TTL:
        return {"models": cached[1], "status": "ok", "cached": True, "source": "live"}
    if not api_key and provider not in ("custom", "ollama", "lmstudio"):
        return {"models": [], "status": "no-key", "cached": False}

    result: dict[str, Any] = await asyncio.to_thread(probe_api_models, api_key, base_url)
    models = [m for m in (result.get("models") or []) if m]
    if result.get("models") is None:
        return {"models": [], "status": "ok", "cached": False, "source": "error"}
    _DISCOVERY_CACHE[key] = (time.time(), models)
    return {"models": models, "status": "ok", "cached": False, "source": "live"}


# ---------------------------------------------------------------------------
# Rewind (edit / regenerate)
# ---------------------------------------------------------------------------

def rewind_cut_index(messages: list, user_turn: int) -> Optional[int]:
    """Index of the ``user_turn``-th (0-based) user message the user can see.

    Counts user messages the way the app displays them (see
    ``session_inbox.clean_history_for_display``): worker-update messages
    that the user never typed are skipped.
    """
    from gateway.session_inbox import UPDATE_HEADER, USER_MARKER

    seen = -1
    for i, msg in enumerate(messages):
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.startswith(UPDATE_HEADER) and USER_MARKER not in content:
            continue
        seen += 1
        if seen == user_turn:
            return i
    return None


@router.post("/api/sessions/{session_id}/rewind")
async def rewind_session(session_id: str, body: dict):
    """Drop a user message and everything after it (edit / regenerate)."""
    from hermes_state import SessionDB

    try:
        user_turn = int(body.get("user_turn"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="user_turn (int) is required")
    db = SessionDB()
    try:
        sid = db.resolve_session_id(session_id) or session_id
        messages = db.get_messages(sid)
        cut = rewind_cut_index(messages, user_turn)
        if cut is None:
            raise HTTPException(status_code=404, detail="No such message in this session")
        db.replace_messages(sid, messages[:cut])
        return {"ok": True, "session_id": sid, "removed": len(messages) - cut}
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Files the agent produced (workspace + vault only)
# ---------------------------------------------------------------------------

MAX_FILE_FETCH_BYTES = 25 * 1024 * 1024


def _shared_roots() -> list[Path]:
    from hermes_constants import get_default_hermes_root

    root = get_default_hermes_root()
    return [(root / "workspace").resolve(), (root / "vault").resolve()]


def resolve_shared_file(path: str) -> Optional[Path]:
    """The file at ``path`` if it is inside the workspace or vault, else None."""
    from agent.theta_guard import is_secret_file

    try:
        resolved = Path(str(path or "")).expanduser().resolve()
    except (OSError, ValueError):
        return None
    if not resolved.is_file() or is_secret_file(str(resolved)):
        return None
    for root in _shared_roots():
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    return None


def _mime_for(path: Path) -> str:
    import mimetypes

    mime, _ = mimetypes.guess_type(path.name)
    if mime:
        return mime
    if path.suffix.lower() in {".md", ".markdown"}:
        return "text/markdown"
    return "application/octet-stream"


@router.post("/api/files/info")
async def files_info(body: dict):
    """Describe the shareable files among ``paths`` (others are omitted)."""
    paths = body.get("paths") or []
    if not isinstance(paths, list):
        raise HTTPException(status_code=400, detail="paths must be a list")
    out = []
    for raw in paths[:50]:
        resolved = resolve_shared_file(str(raw))
        if resolved is None:
            continue
        out.append({
            "path": str(raw),
            "resolved": str(resolved),
            "name": resolved.name,
            "size": resolved.stat().st_size,
            "mime": _mime_for(resolved),
        })
    return {"files": out}


@router.get("/api/files/content")
async def file_content(path: str):
    resolved = resolve_shared_file(path)
    if resolved is None:
        raise HTTPException(status_code=404, detail="File not found in the workspace or vault")
    size = resolved.stat().st_size
    if size > MAX_FILE_FETCH_BYTES:
        raise HTTPException(status_code=413, detail="File too large to fetch (max 25 MB)")
    return {
        "name": resolved.name,
        "mime": _mime_for(resolved),
        "size": size,
        "data": base64.b64encode(resolved.read_bytes()).decode("ascii"),
    }
