"""
Extended REST API endpoints for Hermes Agent web dashboard and app.

Provides CRUD endpoints for memory, soul, tools, kanban, chat streaming,
gateway management, backup/import, MCP servers, and memory providers.
Mounted as a FastAPI APIRouter in web_server.py.

These endpoints fill the gap between the Electron Desktop's IPC handlers
and the existing web_server.py API surface, enabling the Desktop app to
be replaced by a pure-web SPA (Phase 1 of the unification plan).
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import secrets
import subprocess
import sys
import time
import uuid
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from hermes_cli.config import (
    cfg_get,
    get_config_path,
    get_hermes_home,
    load_config,
    save_config,
    save_env_value,
    remove_env_value,
)
from hermes_cli.profiles import get_profile_dir, normalize_profile_name, profile_exists
from hermes_cli.default_soul import DEFAULT_SOUL_MD

_log = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Memory file constants
# ---------------------------------------------------------------------------
ENTRY_DELIMITER = "\n§\n"
MEMORY_CHAR_LIMIT = 2200
USER_CHAR_LIMIT = 1375


def _profile_home(profile: Optional[str] = None) -> Path:
    """Resolve a profile name to its HERMES_HOME directory."""
    if profile and profile != "default":
        return get_profile_dir(profile)
    return get_hermes_home()


def _memory_path(profile: Optional[str] = None) -> Path:
    return _profile_home(profile) / "memories" / "MEMORY.md"


def _user_path(profile: Optional[str] = None) -> Path:
    return _profile_home(profile) / "memories" / "USER.md"


def _soul_path(profile: Optional[str] = None) -> Path:
    return _profile_home(profile) / "SOUL.md"


def _read_file_safe(file_path: Path) -> dict:
    """Read a file, returning {content, exists, lastModified}."""
    if not file_path.exists():
        return {"content": "", "exists": False, "lastModified": None}
    try:
        content = file_path.read_text(encoding="utf-8")
        mtime = file_path.stat().st_mtime
        return {
            "content": content,
            "exists": True,
            "lastModified": int(mtime * 1000),
        }
    except Exception:
        return {"content": "", "exists": False, "lastModified": None}


def _write_file_safe(file_path: Path, content: str) -> None:
    """Write content to file, creating parent directories if needed."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")


def _parse_memory_entries(content: str) -> List[dict]:
    """Split MEMORY.md content into indexed entries."""
    if not content.strip():
        return []
    return [
        {"index": i, "content": entry.strip()}
        for i, entry in enumerate(content.split(ENTRY_DELIMITER))
        if entry.strip()
    ]


def _serialize_entries(entries: List[dict]) -> str:
    return ENTRY_DELIMITER.join(e["content"] for e in entries)


def _get_session_stats(profile: Optional[str] = None) -> dict:
    """Get total session and message counts from state.db."""
    home = _profile_home(profile)
    db_path = home / "state.db"
    if not db_path.exists():
        return {"totalSessions": 0, "totalMessages": 0}
    try:
        from hermes_state import SessionDB
        db = SessionDB(str(db_path))
        try:
            sessions = db.list_sessions(limit=100000)
            total_sessions = len(sessions)
            total_messages = sum(s.get("message_count", 0) for s in sessions)
            return {"totalSessions": total_sessions, "totalMessages": total_messages}
        finally:
            db.close()
    except Exception as exc:
        _log.warning("get_session_stats failed: %s", exc)
        return {"totalSessions": 0, "totalMessages": 0}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class MemoryEntryAdd(BaseModel):
    content: str
    profile: str = "default"


class MemoryEntryUpdate(BaseModel):
    index: int
    content: str
    profile: str = "default"


class MemoryEntryDelete(BaseModel):
    index: int
    profile: str = "default"


class UserProfileUpdate(BaseModel):
    content: str
    profile: str = "default"


class SoulUpdate(BaseModel):
    content: str
    profile: str = "default"


class ToolsetToggle(BaseModel):
    key: str
    enabled: bool
    profile: str = "default"


class ChatMessageRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    model: Optional[str] = None
    profile: str = "default"
    history: Optional[List[Dict[str, str]]] = None


class BackupRequest(BaseModel):
    profile: str = "default"


class ImportRequest(BaseModel):
    archivePath: str
    profile: str = "default"


class KanbanCreateBoard(BaseModel):
    slug: str
    name: Optional[str] = None
    switchAfter: bool = False
    profile: str = "default"


class KanbanCreateTask(BaseModel):
    title: str
    body: Optional[str] = None
    assignee: Optional[str] = None
    priority: Optional[int] = None
    tenant: Optional[str] = None
    workspace: Optional[str] = None
    triage: bool = False
    skills: Optional[List[str]] = None
    maxRetries: Optional[int] = None
    profile: str = "default"


class KanbanAssignTask(BaseModel):
    taskId: str
    assignee: Optional[str] = None
    profile: str = "default"


class KanbanCompleteTask(BaseModel):
    taskId: str
    result: Optional[str] = None
    profile: str = "default"


class KanbanBlockTask(BaseModel):
    taskId: str
    reason: Optional[str] = None
    profile: str = "default"


class KanbanCommentTask(BaseModel):
    taskId: str
    body: str
    profile: str = "default"


class KanbanTaskAction(BaseModel):
    taskId: str
    profile: str = "default"


class KanbanReclaimTask(BaseModel):
    taskId: str
    reason: Optional[str] = None
    profile: str = "default"


# ---------------------------------------------------------------------------
# Memory endpoints
# ---------------------------------------------------------------------------

@router.get("/api/memory")
async def get_memory(profile: str = Query("default")):
    """Read memory (MEMORY.md + USER.md) with session stats."""
    mem_file = _read_file_safe(_memory_path(profile))
    user_file = _read_file_safe(_user_path(profile))
    entries = _parse_memory_entries(mem_file["content"])

    return {
        "memory": {
            "content": mem_file["content"],
            "exists": mem_file["exists"],
            "lastModified": mem_file["lastModified"],
            "entries": entries,
            "charCount": len(mem_file["content"]),
            "charLimit": MEMORY_CHAR_LIMIT,
        },
        "user": {
            "content": user_file["content"],
            "exists": user_file["exists"],
            "lastModified": user_file["lastModified"],
            "charCount": len(user_file["content"]),
            "charLimit": USER_CHAR_LIMIT,
        },
        "stats": _get_session_stats(profile),
    }


@router.post("/api/memory")
async def add_memory_entry(body: MemoryEntryAdd):
    """Add a new entry to MEMORY.md."""
    file_path = _memory_path(body.profile)
    existing = _read_file_safe(file_path)
    entries = _parse_memory_entries(existing["content"])
    entries.append({"index": len(entries), "content": body.content.strip()})
    new_content = _serialize_entries(entries)

    if len(new_content) > MEMORY_CHAR_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Would exceed memory limit ({len(new_content)}/{MEMORY_CHAR_LIMIT} chars)",
        )

    _write_file_safe(file_path, new_content)
    return {"success": True}


@router.put("/api/memory")
async def update_memory_entry(body: MemoryEntryUpdate):
    """Update an existing MEMORY.md entry by index."""
    file_path = _memory_path(body.profile)
    existing = _read_file_safe(file_path)
    entries = _parse_memory_entries(existing["content"])

    if body.index < 0 or body.index >= len(entries):
        raise HTTPException(status_code=404, detail="Entry not found")

    entries[body.index]["content"] = body.content.strip()
    new_content = _serialize_entries(entries)

    if len(new_content) > MEMORY_CHAR_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Would exceed memory limit ({len(new_content)}/{MEMORY_CHAR_LIMIT} chars)",
        )

    _write_file_safe(file_path, new_content)
    return {"success": True}


@router.delete("/api/memory")
async def remove_memory_entry(body: MemoryEntryDelete):
    """Remove a MEMORY.md entry by index."""
    file_path = _memory_path(body.profile)
    existing = _read_file_safe(file_path)
    entries = _parse_memory_entries(existing["content"])

    if body.index < 0 or body.index >= len(entries):
        raise HTTPException(status_code=404, detail="Entry not found")

    entries.pop(body.index)
    _write_file_safe(file_path, _serialize_entries(entries))
    return {"success": True}


@router.put("/api/memory/user")
async def write_user_profile(body: UserProfileUpdate):
    """Write or update USER.md."""
    if len(body.content) > USER_CHAR_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Exceeds limit ({len(body.content)}/{USER_CHAR_LIMIT} chars)",
        )
    _write_file_safe(_user_path(body.profile), body.content)
    return {"success": True}


# ---------------------------------------------------------------------------
# Soul endpoints
# ---------------------------------------------------------------------------

@router.get("/api/soul")
async def get_soul(profile: str = Query("default")):
    """Read the SOUL.md persona file."""
    file_path = _soul_path(profile)
    info = _read_file_safe(file_path)
    return {
        "content": info["content"],
        "exists": info["exists"],
        "lastModified": info["lastModified"],
        "isDefault": not info["exists"] or info["content"].strip() == "",
    }


@router.put("/api/soul")
async def set_soul(body: SoulUpdate):
    """Write SOUL.md persona file."""
    _write_file_safe(_soul_path(body.profile), body.content)
    return {"success": True}


@router.post("/api/soul/reset")
async def reset_soul(profile: str = Query("default")):
    """Reset SOUL.md to the default template."""
    _write_file_safe(_soul_path(profile), DEFAULT_SOUL_MD)
    return {"content": DEFAULT_SOUL_MD}


# ---------------------------------------------------------------------------
# Tools endpoints
# ---------------------------------------------------------------------------

@router.put("/api/tools/toolset")
async def set_toolset_enabled(body: ToolsetToggle):
    """Enable or disable a toolset in config.yaml platform_toolsets.cli."""
    config = load_config()
    if "platform_toolsets" not in config:
        config["platform_toolsets"] = {}
    if "cli" not in config["platform_toolsets"]:
        config["platform_toolsets"]["cli"] = []

    cli_list = config["platform_toolsets"]["cli"]
    if not isinstance(cli_list, list):
        cli_list = []
        config["platform_toolsets"]["cli"] = cli_list

    if body.enabled and body.key not in cli_list:
        cli_list.append(body.key)
    elif not body.enabled and body.key in cli_list:
        cli_list.remove(body.key)

    config["platform_toolsets"]["cli"] = sorted(cli_list)
    save_config(config)
    return {"success": True}


# ---------------------------------------------------------------------------
# Gateway management endpoints
# ---------------------------------------------------------------------------

@router.post("/api/gateway/start")
async def start_gateway_endpoint(profile: str = Query("default")):
    """Start the Hermes gateway as a subprocess."""
    try:
        from hermes_cli.gateway import run_gateway as gateway_start
        result = gateway_start()
        return {"success": result is not None}
    except Exception as exc:
        _log.exception("Failed to start gateway")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/gateway/stop")
async def stop_gateway_endpoint(profile: str = Query("default")):
    """Stop the Hermes gateway."""
    try:
        from hermes_cli.gateway import stop_profile_gateway as gateway_stop
        result = gateway_stop()
        return {"success": result}
    except Exception as exc:
        _log.exception("Failed to stop gateway")
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Chat SSE streaming (proxies to the gateway API server)
# ---------------------------------------------------------------------------

# In-memory store for active streams — maps stream_id → asyncio.Event for completion
_active_streams: Dict[str, Dict[str, Any]] = {}
_stream_lock = asyncio.Lock()


_GATEWAY_BASE = "http://127.0.0.1:8642"


def _get_api_key(profile: Optional[str] = None) -> Optional[str]:
    """Get the API server key from the profile's .env or config."""
    try:
        from hermes_cli.config import get_env_value
        key = get_env_value("API_SERVER_KEY", profile)
        if key:
            return key
    except Exception:
        pass
    return None


@router.post("/api/chat/send")
async def chat_send(body: ChatMessageRequest):
    """Send a chat message and return a stream_id for SSE consumption.

    Proxies to the gateway's /v1/chat/completions endpoint.
    """
    stream_id = secrets.token_urlsafe(16)

    _active_streams[stream_id] = {
        "chunks": [],
        "done": False,
        "error": None,
        "session_id": None,
        "usage": None,
        "tool_progress": [],
        "event": asyncio.Event(),
    }

    # Build messages payload
    messages = []
    if body.history:
        for msg in body.history:
            role = "assistant" if msg.get("role") == "agent" else msg.get("role", "user")
            messages.append({"role": role, "content": msg.get("content", "")})
    messages.append({"role": "user", "content": body.message})

    payload = {
        "model": body.model or "hermes-agent",
        "messages": messages,
        "stream": True,
    }
    if body.session_id:
        payload["session_id"] = body.session_id

    headers = {"Content-Type": "application/json"}
    api_key = _get_api_key(body.profile if body.profile != "default" else None)
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Fire and forget — the SSE consumer reads from _active_streams
    async def _stream_to_store():
        try:
            import httpx
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
                async with client.stream(
                    "POST",
                    f"{_GATEWAY_BASE}/v1/chat/completions",
                    json=payload,
                    headers=headers,
                ) as resp:
                    if resp.status_code != 200:
                        body_text = await resp.aread()
                        _active_streams[stream_id]["error"] = (
                            f"Gateway error {resp.status_code}: {body_text.decode()[:500]}"
                        )
                        _active_streams[stream_id]["done"] = True
                        _active_streams[stream_id]["event"].set()
                        return

                    sid = resp.headers.get("x-hermes-session-id")
                    if sid:
                        _active_streams[stream_id]["session_id"] = sid

                    buffer = ""
                    async for chunk in resp.aiter_bytes():
                        buffer += chunk.decode()
                        while "\n\n" in buffer:
                            block, buffer = buffer.split("\n\n", 1)
                            event_type = ""
                            data_line = ""
                            for line in block.split("\n"):
                                if line.startswith("event: "):
                                    event_type = line[7:].strip()
                                elif line.startswith("data: "):
                                    data_line = line[6:]
                            if not data_line:
                                continue
                            if data_line == "[DONE]":
                                break
                            if event_type == "hermes.tool.progress":
                                try:
                                    pl = json.loads(data_line)
                                    label = pl.get("label", pl.get("tool", ""))
                                    _active_streams[stream_id]["tool_progress"].append(label)
                                except Exception:
                                    pass
                                continue
                            try:
                                parsed = json.loads(data_line)
                                if parsed.get("error"):
                                    _active_streams[stream_id]["error"] = (
                                        parsed["error"].get("message", str(parsed["error"]))
                                    )
                                delta = parsed.get("choices", [{}])[0].get("delta", {})
                                if delta.get("content"):
                                    _active_streams[stream_id]["chunks"].append(delta["content"])
                                if parsed.get("usage"):
                                    _active_streams[stream_id]["usage"] = parsed["usage"]
                            except json.JSONDecodeError:
                                pass
        except Exception as exc:
            _active_streams[stream_id]["error"] = str(exc)
        finally:
            _active_streams[stream_id]["done"] = True
            _active_streams[stream_id]["event"].set()

    asyncio.create_task(_stream_to_store())
    return {"stream_id": stream_id}


@router.get("/api/chat/stream/{stream_id}")
async def chat_stream(stream_id: str):
    """SSE stream endpoint — clients connect here to receive chat responses."""

    if stream_id not in _active_streams:
        raise HTTPException(status_code=404, detail="Stream not found")

    stream_data = _active_streams[stream_id]

    async def _event_generator():
        idx = 0
        while True:
            # Emit any new chunks
            while idx < len(stream_data["chunks"]):
                chunk = stream_data["chunks"][idx]
                idx += 1
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

            if stream_data["done"]:
                if stream_data["error"]:
                    yield f"data: {json.dumps({'type': 'error', 'message': stream_data['error']})}\n\n"
                else:
                    result = {"type": "done"}
                    if stream_data["session_id"]:
                        result["session_id"] = stream_data["session_id"]
                    if stream_data["usage"]:
                        result["usage"] = stream_data["usage"]
                    yield f"data: {json.dumps(result)}\n\n"
                yield "data: [DONE]\n\n"
                # Clean up after 60s
                asyncio.get_event_loop().call_later(
                    60, lambda: _active_streams.pop(stream_id, None)
                )
                return

            # Wait for more data
            try:
                await asyncio.wait_for(stream_data["event"].wait(), timeout=1.0)
                stream_data["event"].clear()
            except asyncio.TimeoutError:
                # Send keepalive comment
                yield ": keepalive\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Kanban endpoints
# ---------------------------------------------------------------------------

def _kanban_connect(profile: Optional[str] = None, board: Optional[str] = None):
    """Get a kanban DB connection for the given profile."""
    from hermes_cli.kanban_db import connect
    home = _profile_home(profile)
    db_path = home / "kanban.db"
    conn = connect(db_path, board=board)
    return conn


@router.get("/api/kanban/boards")
async def kanban_list_boards(
    includeArchived: bool = Query(True),
    profile: str = Query("default"),
):
    """List all kanban boards."""
    try:
        from hermes_cli.kanban_db import list_boards
        boards = list_boards(include_archived=includeArchived)
        return {"success": True, "data": boards}
    except Exception as exc:
        _log.exception("kanban list_boards failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/kanban/boards/current")
async def kanban_current_board(profile: str = Query("default")):
    """Get the currently active kanban board slug."""
    try:
        from hermes_cli.kanban_db import get_current_board
        slug = get_current_board()
        return {"success": True, "data": slug}
    except Exception as exc:
        _log.exception("kanban current_board failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/boards")
async def kanban_create_board(body: KanbanCreateBoard):
    """Create a new kanban board."""
    try:
        from hermes_cli.kanban_db import create_board
        board_path = create_board(body.slug, name=body.name)
        if body.switchAfter:
            from hermes_cli.kanban_db import set_current_board
            set_current_board(body.slug)
        return {"success": True, "data": {"slug": body.slug, "path": str(board_path)}}
    except Exception as exc:
        _log.exception("kanban create_board failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/api/kanban/boards/{slug}")
async def kanban_remove_board(
    slug: str,
    hardDelete: bool = Query(False),
    profile: str = Query("default"),
):
    """Remove (archive) a kanban board."""
    try:
        from hermes_cli.kanban_db import remove_board
        result = remove_board(slug, archive=not hardDelete)
        return {"success": True, "data": result}
    except Exception as exc:
        _log.exception("kanban remove_board failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/boards/{slug}/switch")
async def kanban_switch_board(slug: str, profile: str = Query("default")):
    """Switch to a different kanban board."""
    try:
        from hermes_cli.kanban_db import set_current_board
        set_current_board(slug)
        return {"success": True}
    except Exception as exc:
        _log.exception("kanban switch_board failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/kanban/tasks")
async def kanban_list_tasks(
    status: Optional[str] = Query(None),
    assignee: Optional[str] = Query(None),
    tenant: Optional[str] = Query(None),
    includeArchived: bool = Query(False),
    profile: str = Query("default"),
):
    """List kanban tasks with optional filters."""
    try:
        from hermes_cli.kanban_db import list_tasks
        conn = _kanban_connect(profile)
        try:
            filters: dict = {}
            if status:
                filters["status"] = status
            if assignee:
                filters["assignee"] = assignee
            if tenant:
                filters["tenant"] = tenant
            if includeArchived:
                filters["includeArchived"] = True
            tasks = list_tasks(conn, **filters)
            # Convert Task objects to dicts
            task_dicts = []
            for t in tasks:
                td = {
                    "id": t.id,
                    "title": t.title,
                    "body": t.body,
                    "assignee": t.assignee,
                    "status": t.status,
                    "priority": t.priority,
                    "tenant": t.tenant,
                    "workspace_kind": t.workspace_kind,
                    "workspace_path": t.workspace_path,
                    "created_by": t.created_by,
                    "created_at": t.created_at,
                    "started_at": t.started_at,
                    "completed_at": t.completed_at,
                    "result": t.result,
                    "skills": t.skills or [],
                    "max_retries": t.max_retries,
                }
                task_dicts.append(td)
            return {"success": True, "data": task_dicts}
        finally:
            conn.close()
    except Exception as exc:
        _log.exception("kanban list_tasks failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/kanban/tasks/{task_id}")
async def kanban_get_task(task_id: str, profile: str = Query("default")):
    """Get detailed info for a single kanban task."""
    try:
        from hermes_cli.kanban_db import (
            connect as kb_connect, init_db, get_task, list_comments,
            list_events, parent_ids, child_ids,
        )
        conn = _kanban_connect(profile)
        try:
            task = get_task(conn, task_id)
            if task is None:
                raise HTTPException(status_code=404, detail="Task not found")
            comments = list_comments(conn, task_id)
            events = list_events(conn, task_id)
            parents = parent_ids(conn, task_id)
            children = child_ids(conn, task_id)

            return {
                "success": True,
                "data": {
                    "task": {
                        "id": task.id,
                        "title": task.title,
                        "body": task.body,
                        "assignee": task.assignee,
                        "status": task.status,
                        "priority": task.priority,
                        "tenant": task.tenant,
                        "workspace_kind": task.workspace_kind,
                        "workspace_path": task.workspace_path,
                        "created_by": task.created_by,
                        "created_at": task.created_at,
                        "started_at": task.started_at,
                        "completed_at": task.completed_at,
                        "result": task.result,
                        "skills": task.skills or [],
                        "max_retries": task.max_retries,
                    },
                    "comments": [
                        {"id": c.id, "task_id": c.task_id, "author": c.author,
                         "body": c.body, "created_at": c.created_at}
                        for c in comments
                    ],
                    "events": [
                        {"id": e.id, "task_id": e.task_id, "kind": e.kind,
                         "payload": e.payload, "created_at": e.created_at,
                         "run_id": e.run_id}
                        for e in events
                    ],
                    "parents": parents,
                    "children": children,
                    "runs": [],
                    "latest_summary": None,
                },
            }
        finally:
            conn.close()
    except HTTPException:
        raise
    except Exception as exc:
        _log.exception("kanban get_task failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/tasks")
async def kanban_create_task(body: KanbanCreateTask):
    """Create a new kanban task."""
    try:
        from hermes_cli.kanban_db import connect as kb_connect, init_db, create_task as kb_create_task
        if not body.title.strip():
            raise HTTPException(status_code=400, detail="Title is required")
        conn = _kanban_connect(body.profile if body.profile != "default" else None)
        try:
            with conn:
                task_id = kb_create_task(
                    conn,
                    title=body.title,
                    body=body.body,
                    assignee=body.assignee,
                    priority=body.priority,
                    tenant=body.tenant,
                    workspace_kind=body.workspace if body.workspace else None,
                    triage=body.triage,
                    skills=body.skills,
                    max_retries=body.maxRetries,
                )
            return {"success": True, "data": {"id": task_id}}
        finally:
            conn.close()
    except HTTPException:
        raise
    except Exception as exc:
        _log.exception("kanban create_task failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/tasks/{task_id}/assign")
async def kanban_assign_task(task_id: str, body: KanbanAssignTask):
    """Assign a task to a profile."""
    try:
        from hermes_cli.kanban_db import connect as kb_connect, init_db, assign_task
        conn = _kanban_connect(body.profile if body.profile != "default" else None)
        try:
            with conn:
                success = assign_task(conn, body.taskId or task_id, body.assignee)
            return {"success": success}
        finally:
            conn.close()
    except Exception as exc:
        _log.exception("kanban assign_task failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/tasks/{task_id}/complete")
async def kanban_complete_task(task_id: str, body: KanbanCompleteTask):
    """Mark a task as completed."""
    try:
        from hermes_cli.kanban_db import (
            connect as kb_connect, init_db, get_task, _end_run, _append_event, write_txn,
        )
        conn = _kanban_connect(body.profile if body.profile != "default" else None)
        try:
            with conn:
                task = get_task(conn, body.taskId or task_id)
                if task is None:
                    raise HTTPException(status_code=404, detail="Task not found")
                _end_run(conn, task, "completed", body.result or "")
                _append_event(conn, task, "completed", body.result or "")
                conn.execute(
                    "UPDATE tasks SET status='done', result=?, completed_at=? WHERE id=?",
                    (body.result or "", int(time.time()), body.taskId or task_id),
                )
            return {"success": True}
        finally:
            conn.close()
    except HTTPException:
        raise
    except Exception as exc:
        _log.exception("kanban complete_task failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/tasks/{task_id}/block")
async def kanban_block_task(task_id: str, body: KanbanBlockTask):
    """Block a task."""
    try:
        from hermes_cli.kanban_db import (
            connect as kb_connect, init_db, _append_event, write_txn,
        )
        conn = _kanban_connect(body.profile if body.profile != "default" else None)
        try:
            with conn:
                conn.execute(
                    "UPDATE tasks SET status='blocked' WHERE id=?",
                    (body.taskId or task_id,),
                )
                _append_event(conn, body.taskId or task_id, "blocked",
                            {"reason": body.reason} if body.reason else None)
            return {"success": True}
        finally:
            conn.close()
    except Exception as exc:
        _log.exception("kanban block_task failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/tasks/{task_id}/unblock")
async def kanban_unblock_task(task_id: str, body: KanbanTaskAction):
    """Unblock a task (set back to ready)."""
    try:
        from hermes_cli.kanban_db import (
            connect as kb_connect, init_db, _append_event, write_txn,
        )
        conn = _kanban_connect(body.profile if body.profile != "default" else None)
        try:
            with conn:
                conn.execute(
                    "UPDATE tasks SET status='ready' WHERE id=?",
                    (body.taskId or task_id,),
                )
                _append_event(conn, body.taskId or task_id, "unblocked", None)
            return {"success": True}
        finally:
            conn.close()
    except Exception as exc:
        _log.exception("kanban unblock_task failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/tasks/{task_id}/archive")
async def kanban_archive_task(task_id: str, body: KanbanTaskAction):
    """Archive a task."""
    try:
        from hermes_cli.kanban_db import connect as kb_connect, init_db
        conn = _kanban_connect(body.profile if body.profile != "default" else None)
        try:
            with conn:
                conn.execute(
                    "UPDATE tasks SET status='archived' WHERE id=?",
                    (body.taskId or task_id,),
                )
            return {"success": True}
        finally:
            conn.close()
    except Exception as exc:
        _log.exception("kanban archive_task failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/tasks/{task_id}/specify")
async def kanban_specify_task(task_id: str, body: KanbanTaskAction):
    """Move a task to the specify/triage state."""
    try:
        from hermes_cli.kanban_db import connect as kb_connect, init_db
        conn = _kanban_connect(body.profile if body.profile != "default" else None)
        try:
            with conn:
                conn.execute(
                    "UPDATE tasks SET status='triage' WHERE id=?",
                    (body.taskId or task_id,),
                )
            return {"success": True}
        finally:
            conn.close()
    except Exception as exc:
        _log.exception("kanban specify_task failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/tasks/{task_id}/reclaim")
async def kanban_reclaim_task(task_id: str, body: KanbanReclaimTask):
    """Reclaim a task (unassign and set back to ready)."""
    try:
        from hermes_cli.kanban_db import (
            connect as kb_connect, init_db, reclaim_task as kb_reclaim,
        )
        conn = _kanban_connect(body.profile if body.profile != "default" else None)
        try:
            with conn:
                kb_reclaim(conn, body.taskId or task_id, body.reason)
            return {"success": True}
        finally:
            conn.close()
    except Exception as exc:
        _log.exception("kanban reclaim_task failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/tasks/{task_id}/comment")
async def kanban_comment_task(task_id: str, body: KanbanCommentTask):
    """Add a comment to a task."""
    try:
        from hermes_cli.kanban_db import connect as kb_connect, init_db, add_comment
        if not body.body.strip():
            raise HTTPException(status_code=400, detail="Empty comment")
        conn = _kanban_connect(body.profile if body.profile != "default" else None)
        try:
            with conn:
                add_comment(conn, body.taskId or task_id, body.body, author=None)
            return {"success": True}
        finally:
            conn.close()
    except HTTPException:
        raise
    except Exception as exc:
        _log.exception("kanban comment_task failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/kanban/dispatch")
async def kanban_dispatch_once(
    dryRun: bool = Query(False),
    profile: str = Query("default"),
):
    """Trigger a dispatch cycle."""
    try:
        from hermes_cli.kanban_db import connect as kb_connect, init_db
        from hermes_cli.kanban_db import list_tasks, claim_task
        conn = _kanban_connect(profile)
        try:
            ready = list_tasks(conn, status="ready")
            if dryRun:
                return {"success": True, "data": {"ready_count": len(ready), "dry_run": True}}
            claimed = []
            for task in ready:
                if claim_task(conn, task.id, profile):
                    claimed.append(task.id)
            return {"success": True, "data": {"claimed": claimed, "total_ready": len(ready)}}
        finally:
            conn.close()
    except Exception as exc:
        _log.exception("kanban dispatch_once failed")
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Backup / Import endpoints
# ---------------------------------------------------------------------------

@router.post("/api/backup")
async def run_backup(profile: str = Query("default")):
    """Run a backup of the Hermes home directory."""
    try:
        from hermes_cli.backup import run_backup as do_backup
        result = do_backup(profile if profile != "default" else None)
        return {"success": True, "path": result}
    except Exception as exc:
        _log.exception("backup failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/import")
async def run_import(body: ImportRequest):
    """Import a backup archive."""
    try:
        from hermes_cli.backup import run_import as do_import
        result = do_import(body.archivePath, body.profile if body.profile != "default" else None)
        return {"success": True}
    except Exception as exc:
        _log.exception("import failed")
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# MCP servers endpoint
# ---------------------------------------------------------------------------

@router.get("/api/mcp/servers")
async def list_mcp_servers(profile: str = Query("default")):
    """List configured MCP servers from config.yaml."""
    try:
        from hermes_cli.mcp_config import _get_mcp_servers
        servers = _get_mcp_servers()
        result = []
        for name, cfg in servers.items():
            result.append({
                "name": name,
                "type": cfg.get("type", cfg.get("command", "stdio")),
                "enabled": cfg.get("enabled", True),
                "detail": cfg.get("command", cfg.get("url", "")),
            })
        return {"servers": result}
    except Exception as exc:
        _log.exception("list_mcp_servers failed")
        return {"servers": []}


# ---------------------------------------------------------------------------
# Memory providers endpoint
# ---------------------------------------------------------------------------

@router.get("/api/memory/providers")
async def discover_memory_providers(profile: str = Query("default")):
    """Discover installed memory provider plugins."""
    try:
        from hermes_cli.plugins_cmd import _discover_memory_providers
        raw = _discover_memory_providers()
        return {
            "providers": [
                {"name": name, "description": desc, "installed": True, "active": False, "envVars": []}
                for name, desc in raw
            ]
        }
    except Exception as exc:
        _log.exception("discover_memory_providers failed")
        return {"providers": []}


# ---------------------------------------------------------------------------
# Connection config endpoint (read-only)
# ---------------------------------------------------------------------------

@router.get("/api/connection")
async def get_connection_config():
    """Get the current connection configuration (local/remote/ssh mode)."""
    try:
        config = load_config()
        connection = config.get("connection", {})
        return {
            "mode": connection.get("mode", "local"),
            "remoteUrl": connection.get("remote_url", ""),
            "hasApiKey": bool(connection.get("api_key", "")),
            "ssh": {
                "host": connection.get("ssh_host", ""),
                "port": connection.get("ssh_port", 22),
                "username": connection.get("ssh_user", ""),
                "keyPath": connection.get("ssh_key_path", ""),
                "remotePort": connection.get("ssh_remote_port", 9119),
                "localPort": connection.get("ssh_local_port", 19642),
            },
        }
    except Exception as exc:
        _log.exception("get_connection_config failed")
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Auth / pairing endpoints (no session token required — public paths)
# ---------------------------------------------------------------------------

# In-memory pairing state. Set by generate_pairing_code() on server startup
# when no API_SERVER_KEY is configured. Cleared after TTL expires.
_PAIRING_CODE: str | None = None
_PAIRING_CODE_GENERATED_AT: float = 0.0
_PAIRING_TTL_SECONDS = 900  # 15 minutes


def generate_pairing_code() -> str | None:
    """Generate a one-time pairing passphrase for remote client linking.

    Only called when no API_SERVER_KEY is configured. The code is printed
    to the server console so the operator can share it with the remote user.
    Returns None if a key already exists (pairing not needed).
    """
    global _PAIRING_CODE, _PAIRING_CODE_GENERATED_AT
    from hermes_cli.config import load_env
    env = load_env()
    if env.get("API_SERVER_KEY", "").strip():
        return None  # already configured, no pairing needed
    # Generate a 4-word passphrase from a short word list
    words = [
        "alpha", "bravo", "cobalt", "delta", "echo", "falcon",
        "garden", "haven", "iris", "jade", "kiwi", "lemon",
        "maple", "nova", "ocean", "pilot", "quartz", "river",
        "sage", "tango", "ultra", "vapor", "willow", "xenon",
        "yarrow", "zinc",
    ]
    code_words = [secrets.choice(words) for _ in range(4)]
    _PAIRING_CODE = "-".join(code_words)
    _PAIRING_CODE_GENERATED_AT = time.time()
    return _PAIRING_CODE


def _get_api_server_key() -> str:
    """Read the API_SERVER_KEY from the server's .env file."""
    from hermes_cli.config import load_env
    env = load_env()
    return env.get("API_SERVER_KEY", "").strip()


def _set_api_server_key(key: str) -> None:
    """Persist the API_SERVER_KEY to the server's .env file."""
    from hermes_cli.config import save_env_value, invalidate_env_cache
    save_env_value("API_SERVER_KEY", key)
    invalidate_env_cache()


@router.get("/api/auth/status")
async def auth_status():
    """Return whether the server has a configured API_SERVER_KEY.

    Public endpoint — no session token required. Used by remote clients
    to determine whether pairing is needed before attempting to connect.
    """
    key = _get_api_server_key()
    has_pairing_code = bool(
        _PAIRING_CODE
        and (time.time() - _PAIRING_CODE_GENERATED_AT) < _PAIRING_TTL_SECONDS
    )
    return {
        "configured": bool(key),
        "pairingAvailable": has_pairing_code,
    }


class PairRequest(BaseModel):
    secret: str = Field(description="One-time pairing code or existing API_SERVER_KEY")


@router.post("/api/auth/pair")
async def auth_pair(body: PairRequest):
    """Exchange a pairing secret for a persistent API key.

    Accepts either:
    - The one-time pairing code shown in the server console (when no key is set)
    - An existing API_SERVER_KEY (to retrieve the current key — for recovery)

    On successful pairing, the one-time code is consumed (can't be reused).
    Returns the API_SERVER_KEY for the client to store.
    """
    global _PAIRING_CODE, _PAIRING_CODE_GENERATED_AT

    secret = body.secret.strip()
    if not secret:
        raise HTTPException(status_code=400, detail="Secret is required")

    existing_key = _get_api_server_key()

    # Path 1: Server has a configured key — match against it
    if existing_key:
        if not hmac.compare_digest(secret.encode(), existing_key.encode()):
            raise HTTPException(status_code=401, detail="Invalid API key")
        return {"apiKey": existing_key, "paired": True}

    # Path 2: No configured key — accept the one-time pairing code
    now = time.time()
    valid_code = (
        _PAIRING_CODE
        and hmac.compare_digest(secret.encode(), _PAIRING_CODE.encode())
        and (now - _PAIRING_CODE_GENERATED_AT) < _PAIRING_TTL_SECONDS
    )

    if not valid_code:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired pairing code. "
            "Check the server console for the current code.",
        )

    # Generate a persistent API key and store it
    new_key = secrets.token_urlsafe(32)
    _set_api_server_key(new_key)

    # Consume the one-time code
    _PAIRING_CODE = None
    _PAIRING_CODE_GENERATED_AT = 0.0

    return {"apiKey": new_key, "paired": True, "newKey": True}


# ---------------------------------------------------------------------------
# Models CRUD (Desktop models.json)
# ---------------------------------------------------------------------------

_MODELS_FILE = Path(get_hermes_home()) / "models.json"


def _read_models() -> List[Dict[str, Any]]:
    """Read models.json, return empty list if missing or corrupt."""
    try:
        if _MODELS_FILE.exists():
            return json.loads(_MODELS_FILE.read_text())
    except Exception:
        pass
    return []


def _write_models(models: List[Dict[str, Any]]) -> None:
    _MODELS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _MODELS_FILE.write_text(json.dumps(models, indent=2))


class AddModelRequest(BaseModel):
    name: str
    provider: str
    model: str
    baseUrl: str = ""


class UpdateModelRequest(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    baseUrl: Optional[str] = None


@router.get("/api/models")
async def list_models_endpoint():
    """List saved custom models from models.json."""
    return _read_models()


@router.post("/api/models")
async def add_model_endpoint(body: AddModelRequest):
    """Add a custom model to models.json."""
    models = _read_models()
    existing = next(
        (m for m in models if m.get("model") == body.model and m.get("provider") == body.provider),
        None,
    )
    if existing:
        return existing
    entry: Dict[str, Any] = {
        "id": uuid.uuid4().hex,
        "name": body.name,
        "provider": body.provider,
        "model": body.model,
        "baseUrl": body.baseUrl,
        "createdAt": int(time.time() * 1000),
    }
    models.append(entry)
    _write_models(models)
    return entry


@router.delete("/api/models/{model_id}")
async def delete_model_endpoint(model_id: str):
    """Remove a custom model from models.json."""
    models = _read_models()
    filtered = [m for m in models if m.get("id") != model_id]
    if len(filtered) == len(models):
        raise HTTPException(status_code=404, detail="Model not found")
    _write_models(filtered)
    return {"ok": True}


@router.put("/api/models/{model_id}")
async def update_model_endpoint(model_id: str, body: UpdateModelRequest):
    """Update a custom model in models.json."""
    models = _read_models()
    for m in models:
        if m.get("id") == model_id:
            for key in ("name", "provider", "model", "baseUrl"):
                val = getattr(body, key, None)
                if val is not None:
                    m[key] = val
            _write_models(models)
            return {"ok": True}


# =============================================================================
# Vault endpoints — proxy to vault_tool.py helpers
# =============================================================================

class VaultCreateBucketRequest(BaseModel):
    name: str
    description: str = ""
    path: Optional[str] = None


class VaultUpdateBucketRequest(BaseModel):
    name: str
    description: str = ""


class VaultSearchRequest(BaseModel):
    query: str
    bucket: Optional[str] = None
    limit: int = 20
    token_budget: int = 4000
    result_depth: str = "snippet"


class VaultWriteFileRequest(BaseModel):
    path: str
    content: str


class VaultFilePathRequest(BaseModel):
    path: str


class VaultDeleteItemRequest(BaseModel):
    path: str
    is_dir: bool = False


class VaultMoveRequest(BaseModel):
    from_path: str
    to_dir: str


class VaultReindexRequest(BaseModel):
    bucket: Optional[str] = None
    force: bool = False


def _import_vault():
    """Lazy import of vault_tool to avoid circular imports at startup."""
    import importlib
    return importlib.import_module("tools.vault_tool")


@router.get("/api/vault/status")
async def vault_status():
    vt = _import_vault()
    return vt.get_vault_status()


@router.get("/api/vault/buckets")
async def vault_list_buckets():
    vt = _import_vault()
    result = json.loads(vt._handle_list_buckets({}))
    return result


@router.get("/api/vault/buckets/{bucket_id}/tree")
async def vault_tree(bucket_id: str):
    vt = _import_vault()
    return vt.tree_bucket(bucket_id)


@router.post("/api/vault/search")
async def vault_search(body: VaultSearchRequest):
    vt = _import_vault()
    result = json.loads(vt._handle_search({
        "query": body.query,
        "bucket": body.bucket or "",
        "limit": body.limit,
        "token_budget": body.token_budget,
        "result_depth": body.result_depth,
    }))
    return result


@router.post("/api/vault/buckets")
async def vault_create_bucket(body: VaultCreateBucketRequest):
    vt = _import_vault()
    # Support custom path: temporarily override slug via path field
    if body.path and body.path.strip():
        # Inline the create logic with custom path support
        import re as _re
        import time as _time
        from tools import vault_db as _vault_db

        vault_dir = vt._vault_dir()
        raw_path = body.path.strip().replace("\\", "/")
        # Sanitize each segment
        def _slug(s: str) -> str:
            s = s.lower().replace(" ", "-").replace("_", "-")
            s = _re.sub(r"[^a-z0-9-]", "", s)
            return _re.sub(r"-{2,}", "-", s).strip("-")
        rel_path = "/".join(_slug(seg) for seg in raw_path.split("/") if seg)
        if not rel_path:
            raise HTTPException(status_code=400, detail="Path produces an empty slug")
        bucket_id = rel_path
        conn = vt._get_conn()
        try:
            existing = conn.execute("SELECT id FROM buckets WHERE id = ?", (bucket_id,)).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail=f"Bucket already exists at '{rel_path}'")
            bkt_dir = vault_dir / rel_path
            bkt_dir.mkdir(parents=True, exist_ok=True)
            import json as _json
            (bkt_dir / "bucket.json").write_text(
                _json.dumps({"id": bucket_id, "name": body.name,
                             "description": body.description,
                             "created_at": _time.strftime("%Y-%m-%dT%H:%M:%S", _time.gmtime())},
                            indent=2),
                encoding="utf-8",
            )
            index = vt._load_index(vault_dir)
            if bucket_id not in index["buckets"]:
                index["buckets"][bucket_id] = {"path": rel_path, "description": body.description, "name": body.name}
                vt._save_index(vault_dir, index)
            _vault_db.upsert_bucket(conn, bucket_id, body.name, body.description, rel_path)
        finally:
            conn.close()
        return {"ok": True, "bucket_id": bucket_id, "name": body.name, "path": str(bkt_dir)}
    else:
        result = json.loads(vt._handle_create_bucket({"name": body.name, "description": body.description}))
        return result


@router.delete("/api/vault/buckets/{bucket_id:path}")
async def vault_delete_bucket(bucket_id: str):
    vt = _import_vault()
    return vt.delete_vault_bucket(bucket_id)


@router.patch("/api/vault/buckets/{bucket_id:path}")
async def vault_update_bucket(bucket_id: str, body: VaultUpdateBucketRequest):
    vt = _import_vault()
    return vt.update_vault_bucket(bucket_id, body.name, body.description)


@router.get("/api/vault/buckets/{bucket_id:path}/links")
async def vault_bucket_links(bucket_id: str):
    vt = _import_vault()
    return vt.get_vault_bucket_links(bucket_id)


@router.get("/api/vault/files")
async def vault_read_file(path: str = Query(..., description="Absolute file path")):
    vt = _import_vault()
    return vt.read_vault_file(path)


@router.post("/api/vault/files")
async def vault_write_file(body: VaultWriteFileRequest):
    vt = _import_vault()
    return vt.write_vault_file(body.path, body.content)


@router.post("/api/vault/files/create")
async def vault_create_file(body: VaultFilePathRequest):
    vt = _import_vault()
    return vt.create_vault_file(body.path)


@router.post("/api/vault/files/mkdir")
async def vault_create_folder(body: VaultFilePathRequest):
    vt = _import_vault()
    return vt.create_vault_folder(body.path)


@router.delete("/api/vault/files")
async def vault_delete_item(body: VaultDeleteItemRequest):
    vt = _import_vault()
    return vt.delete_vault_item(body.path, body.is_dir)


@router.post("/api/vault/files/move")
async def vault_move_item(body: VaultMoveRequest):
    vt = _import_vault()
    return vt.move_vault_item(body.from_path, body.to_dir)


@router.post("/api/vault/reindex")
async def vault_reindex(body: VaultReindexRequest):
    vt = _import_vault()
    result = json.loads(vt._handle_reindex({"bucket": body.bucket or "", "force": body.force}))
    return result
    raise HTTPException(status_code=404, detail="Model not found")
