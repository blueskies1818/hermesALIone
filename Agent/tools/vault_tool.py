"""
vault_tool.py — Hermes agent tools for the multi-bucket knowledge vault.

Registers 5 tools in the 'vault' toolset:
  - vault_list_buckets   : list all knowledge bases with doc/stale counts
  - vault_browse         : list files in a bucket (optionally filtered by path)
  - vault_search         : FTS5 full-text search with configurable depth/budget
  - vault_create_bucket  : create a new knowledge base directory + DB entry
  - vault_reindex        : sync DB with vault on disk (selective or full)

The agent DOES NOT use vault tools for file I/O. Notes are read and written
directly via the existing read_file / write_file / patch tools on the path
~/.hermes/vault/<bucket>/<note>.md. These tools handle only what requires
the DB: discovery, search, bucket management, and freshness tracking.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from hermes_constants import get_hermes_home
from tools.registry import registry, tool_error
from tools import vault_db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Vault root
# ---------------------------------------------------------------------------

def _vault_dir() -> Path:
    """~/.hermes/vault/ — created on first use."""
    d = get_hermes_home() / "vault"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _db_path() -> Path:
    return _vault_dir() / "vault.db"


def _get_conn():
    return vault_db.init_db(_db_path())


# ---------------------------------------------------------------------------
# Slug helpers
# ---------------------------------------------------------------------------

_SLUG_RE = re.compile(r"[^a-z0-9-]")
_MULTI_HYPHEN = re.compile(r"-{2,}")


def _slugify(name: str) -> str:
    s = name.lower().replace(" ", "-").replace("_", "-")
    s = _SLUG_RE.sub("", s)
    s = _MULTI_HYPHEN.sub("-", s).strip("-")
    return s


# ---------------------------------------------------------------------------
# Availability check
# ---------------------------------------------------------------------------

def _check_vault() -> bool:
    return True  # vault dir is auto-created; always available


# ---------------------------------------------------------------------------
# index.json helpers
# ---------------------------------------------------------------------------

def _load_index(vault_dir: Path) -> Dict[str, Any]:
    idx_path = vault_dir / "index.json"
    if idx_path.exists():
        try:
            return json.loads(idx_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"updated_at": "", "buckets": {}}


def _save_index(vault_dir: Path, index: Dict[str, Any]) -> None:
    from datetime import datetime
    index["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
    (vault_dir / "index.json").write_text(
        json.dumps(index, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Reindex helpers
# ---------------------------------------------------------------------------

def _index_bucket(conn, vault_dir: Path, bucket_id: str,
                  bucket_path: str, force: bool) -> Dict[str, int]:
    """Walk bucket dir and upsert changed/new documents into the DB.

    Returns {indexed, skipped, deleted}.
    """
    bkt_dir = vault_dir / bucket_path
    if not bkt_dir.is_dir():
        return {"indexed": 0, "skipped": 0, "deleted": 0}

    # Collect existing DB rows for this bucket
    existing = {
        row["rel_path"]: row
        for row in conn.execute(
            "SELECT id, rel_path, modified_at, is_stale FROM documents WHERE bucket_id = ?",
            (bucket_id,),
        ).fetchall()
    }

    indexed = skipped = deleted = 0
    seen_paths = set()

    for md_file in sorted(bkt_dir.rglob("*.md")):
        rel_path = str(md_file.relative_to(bkt_dir))
        seen_paths.add(rel_path)
        disk_mtime = md_file.stat().st_mtime

        existing_row = existing.get(rel_path)
        if (
            not force
            and existing_row
            and not existing_row["is_stale"]
            and disk_mtime <= existing_row["modified_at"] + 0.5
        ):
            skipped += 1
            continue

        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
            vault_db.upsert_document(
                conn,
                bucket_id=bucket_id,
                rel_path=rel_path,
                filename=md_file.name,
                content=content,
                mtime=disk_mtime,
            )
            indexed += 1
        except Exception as exc:
            logger.warning("vault_reindex: failed to index %s: %s", md_file, exc)

    # Delete rows for files that no longer exist
    for rel_path, row in existing.items():
        if rel_path not in seen_paths:
            vault_db.delete_document(conn, row["id"])
            deleted += 1

    # Reset stale_count and update doc_count
    doc_count = conn.execute(
        "SELECT COUNT(*) FROM documents WHERE bucket_id = ?", (bucket_id,)
    ).fetchone()[0]
    conn.execute(
        "UPDATE buckets SET stale_count = 0, doc_count = ?, updated_at = ? WHERE id = ?",
        (doc_count, time.time(), bucket_id),
    )
    conn.commit()

    return {"indexed": indexed, "skipped": skipped, "deleted": deleted}


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def _handle_list_buckets(args: Dict, **kw) -> str:
    vault_dir = _vault_dir()
    try:
        conn = _get_conn()
        try:
            # Refresh stale flags before listing
            vault_db.refresh_stale_flags(conn, vault_dir)
            buckets = vault_db.list_buckets(conn)

            if not buckets:
                return json.dumps({
                    "ok": True,
                    "buckets": [],
                    "hint": (
                        "No buckets yet. Use vault_create_bucket to create a "
                        "knowledge base, then write notes to "
                        "~/.hermes/vault/<bucket>/ using write_file."
                    ),
                })

            return json.dumps({
                "ok": True,
                "vault_path": str(vault_dir),
                "bucket_count": len(buckets),
                "buckets": [
                    {
                        "id": b["id"],
                        "name": b["name"],
                        "description": b["description"],
                        "path": b["path"],
                        "doc_count": b["doc_count"],
                        "stale_count": b["stale_count"],
                        "is_stale": b["stale_count"] > 0,
                        "note_path": str(vault_dir / b["path"]),
                    }
                    for b in buckets
                ],
            })
        finally:
            conn.close()
    except Exception as exc:
        logger.exception("vault_list_buckets failed")
        return tool_error(f"vault_list_buckets: {exc}")


def _handle_browse(args: Dict, **kw) -> str:
    bucket = (args.get("bucket") or "").strip()
    path_filter = (args.get("path") or "").strip()

    if not bucket:
        return tool_error("bucket is required")

    vault_dir = _vault_dir()
    try:
        conn = _get_conn()
        try:
            bkt_row = conn.execute(
                "SELECT id, name, path, stale_count FROM buckets WHERE id = ?",
                (bucket,),
            ).fetchone()
            if not bkt_row:
                return tool_error(
                    f"bucket '{bucket}' not found. "
                    "Call vault_list_buckets to see available buckets."
                )

            vault_db.refresh_stale_flags(conn, vault_dir, bucket_id=bucket)
            docs = vault_db.list_documents(conn, bucket, rel_prefix=path_filter)

            return json.dumps({
                "ok": True,
                "bucket_id": bucket,
                "bucket_name": bkt_row["name"],
                "path": str(vault_dir / bkt_row["path"]),
                "filter": path_filter or None,
                "file_count": len(docs),
                "files": [
                    {
                        "rel_path":  d["rel_path"],
                        "filename":  d["filename"],
                        "title":     d["title"],
                        "chars":     d["char_count"],
                        "is_stale":  bool(d["is_stale"]),
                        "full_path": str(vault_dir / bkt_row["path"] / d["rel_path"]),
                    }
                    for d in docs
                ],
            })
        finally:
            conn.close()
    except Exception as exc:
        logger.exception("vault_browse failed")
        return tool_error(f"vault_browse: {exc}")


def _handle_search(args: Dict, **kw) -> str:
    query = (args.get("query") or "").strip()
    bucket = (args.get("bucket") or "").strip() or None
    limit = min(int(args.get("limit") or 10), 50)
    token_budget = max(500, min(int(args.get("token_budget") or 4000), 32000))
    result_depth = (args.get("result_depth") or "snippet").strip().lower()

    if not query:
        return tool_error("query is required")
    if result_depth not in ("snippet", "summary", "full"):
        result_depth = "snippet"

    vault_dir = _vault_dir()
    try:
        conn = _get_conn()
        try:
            results = vault_db.fts_search(
                conn,
                vault_dir=vault_dir,
                query=query,
                bucket_id=bucket,
                limit=limit,
                token_budget=token_budget,
                result_depth=result_depth,
            )
            return json.dumps({
                "ok": True,
                "query": query,
                "bucket_filter": bucket,
                "result_depth": result_depth,
                "token_budget": token_budget,
                "result_count": len(results),
                "results": results,
                "hint": (
                    "Use read_file on full_path to read a note's complete content. "
                    "Set result_depth='full' to get content inline without a separate read_file."
                ) if result_depth != "full" else None,
            })
        finally:
            conn.close()
    except sqlite3.OperationalError as exc:
        if "fts5: syntax error" in str(exc).lower() or "no such table" in str(exc).lower():
            return tool_error(
                f"Search syntax error or index not ready: {exc}. "
                "Try vault_reindex to rebuild the search index."
            )
        logger.exception("vault_search failed")
        return tool_error(f"vault_search: {exc}")
    except Exception as exc:
        logger.exception("vault_search failed")
        return tool_error(f"vault_search: {exc}")


def _handle_create_bucket(args: Dict, **kw) -> str:
    name = (args.get("name") or "").strip()
    description = (args.get("description") or "").strip()

    if not name:
        return tool_error("name is required")

    bucket_id = _slugify(name)
    if not bucket_id:
        return tool_error(f"name '{name}' produces an empty slug")

    vault_dir = _vault_dir()
    bucket_dir = vault_dir / bucket_id
    bucket_dir.mkdir(parents=True, exist_ok=True)

    # Write bucket.json
    (bucket_dir / "bucket.json").write_text(
        json.dumps({
            "id": bucket_id,
            "name": name,
            "description": description,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
        }, indent=2),
        encoding="utf-8",
    )

    # Update index.json (agent also keeps this in sync directly)
    index = _load_index(vault_dir)
    if bucket_id not in index["buckets"]:
        index["buckets"][bucket_id] = {
            "path": bucket_id,
            "description": description,
        }
        _save_index(vault_dir, index)

    # Register in DB
    try:
        conn = _get_conn()
        try:
            vault_db.upsert_bucket(conn, bucket_id, name, description, bucket_id)
        finally:
            conn.close()
    except Exception as exc:
        logger.exception("vault_create_bucket: DB update failed")
        return tool_error(f"bucket directory created but DB update failed: {exc}")

    return json.dumps({
        "ok": True,
        "bucket_id": bucket_id,
        "name": name,
        "path": str(bucket_dir),
        "hint": (
            f"Bucket '{name}' created. Write notes to {bucket_dir}/<note>.md "
            "using write_file, then call vault_reindex to index them."
        ),
    })


def _handle_reindex(args: Dict, **kw) -> str:
    bucket_filter = (args.get("bucket") or "").strip() or None
    force_raw, err = _parse_bool(args.get("force"), "force")
    if err:
        return tool_error(err)
    force = force_raw

    vault_dir = _vault_dir()
    try:
        conn = _get_conn()
        try:
            # Sync buckets from index.json into DB first
            index = _load_index(vault_dir)
            for bkt_id, bkt_meta in index.get("buckets", {}).items():
                vault_db.upsert_bucket(
                    conn,
                    bkt_id,
                    bkt_meta.get("name", bkt_id),
                    bkt_meta.get("description", ""),
                    bkt_meta.get("path", bkt_id),
                )

            # Also discover bucket.json files not yet in index.json
            for child in sorted(vault_dir.iterdir()):
                if not child.is_dir() or child.name.startswith("."):
                    continue
                bj = child / "bucket.json"
                if bj.exists() and child.name not in index.get("buckets", {}):
                    try:
                        meta = json.loads(bj.read_text(encoding="utf-8"))
                        vault_db.upsert_bucket(
                            conn,
                            child.name,
                            meta.get("name", child.name),
                            meta.get("description", ""),
                            child.name,
                        )
                    except Exception:
                        pass

            buckets = vault_db.list_buckets(conn)
            if bucket_filter:
                buckets = [b for b in buckets if b["id"] == bucket_filter]
                if not buckets:
                    return tool_error(
                        f"bucket '{bucket_filter}' not found. "
                        "Call vault_list_buckets to see available buckets."
                    )

            summary: List[Dict] = []
            for b in buckets:
                stats = _index_bucket(conn, vault_dir, b["id"], b["path"], force)
                summary.append({
                    "bucket_id":  b["id"],
                    "bucket_name": b["name"],
                    **stats,
                })

            total_indexed = sum(s["indexed"] for s in summary)
            total_deleted = sum(s["deleted"] for s in summary)

            return json.dumps({
                "ok": True,
                "mode": "full" if force else "selective",
                "buckets_processed": len(summary),
                "total_indexed": total_indexed,
                "total_deleted": total_deleted,
                "details": summary,
            })
        finally:
            conn.close()
    except Exception as exc:
        logger.exception("vault_reindex failed")
        return tool_error(f"vault_reindex: {exc}")


def _parse_bool(value: Any, name: str):
    if value is None:
        return False, None
    if isinstance(value, bool):
        return value, None
    text = str(value).strip().lower()
    if text in ("true", "1", "yes"):
        return True, None
    if text in ("false", "0", "no"):
        return False, None
    return False, f"{name} must be a boolean"


# Need sqlite3 import in handler for error handling
import sqlite3  # noqa: E402 — imported after module-level code intentionally


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

VAULT_LIST_BUCKETS_SCHEMA = {
    "name": "vault_list_buckets",
    "description": (
        "List all knowledge base buckets in the Hermes vault with document "
        "counts and freshness status. Always call this first to orient before "
        "browsing or searching. Returns vault path and per-bucket stale indicators."
    ),
    "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

VAULT_BROWSE_SCHEMA = {
    "name": "vault_browse",
    "description": (
        "List markdown files in a vault bucket, optionally filtered by a path prefix. "
        "Returns filenames, titles, sizes, and freshness for each file. Use this to "
        "navigate the directory tree before reading a specific file with read_file."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "bucket": {
                "type": "string",
                "description": "Bucket id (slug). Get available ids from vault_list_buckets.",
            },
            "path": {
                "type": "string",
                "description": "Optional subdirectory prefix to filter results (e.g. 'chapter-1/').",
            },
        },
        "required": ["bucket"],
    },
}

VAULT_SEARCH_SCHEMA = {
    "name": "vault_search",
    "description": (
        "Full-text search across vault notes using FTS5. Searches all buckets by default "
        "or a specific bucket when 'bucket' is provided. "
        "result_depth controls content volume: "
        "'snippet' (default) = short fragment around match, good for discovery; "
        "'summary' = first 500 chars, good for deciding whether to read_file; "
        "'full' = entire document (subject to token_budget), avoids a separate read_file call. "
        "token_budget caps total chars returned (default 4000; raise for targeted deep queries). "
        "Call vault_reindex if the index seems stale."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "FTS5 search query. Supports phrases (\"exact phrase\"), "
                               "AND/OR/NOT operators, and prefix* wildcards.",
            },
            "bucket": {
                "type": "string",
                "description": "Optional bucket id to restrict search to one knowledge base.",
            },
            "limit": {
                "type": "integer",
                "description": "Max number of results (default 10, max 50).",
                "default": 10,
            },
            "token_budget": {
                "type": "integer",
                "description": "Approx max total chars returned across all results (default 4000). "
                               "Increase for deeper reads (e.g. 8000–16000).",
                "default": 4000,
            },
            "result_depth": {
                "type": "string",
                "enum": ["snippet", "summary", "full"],
                "description": "How much of each matching document to return. "
                               "snippet=short fragment; summary=first 500 chars; full=entire doc.",
                "default": "snippet",
            },
        },
        "required": ["query"],
    },
}

VAULT_CREATE_BUCKET_SCHEMA = {
    "name": "vault_create_bucket",
    "description": (
        "Create a new knowledge base bucket in the Hermes vault. "
        "Creates the directory, writes bucket.json, updates index.json, and registers "
        "the bucket in the DB. After creation, write notes to the bucket using write_file."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Human-readable bucket name (e.g. 'Python Notes'). "
                               "Auto-slugified to a directory name.",
            },
            "description": {
                "type": "string",
                "description": "Optional description of this knowledge base.",
            },
        },
        "required": ["name"],
    },
}

VAULT_REINDEX_SCHEMA = {
    "name": "vault_reindex",
    "description": (
        "Sync the vault database with files on disk. "
        "By default (force=false) only re-parses files that changed since the last index — "
        "call this after writing multiple notes in a session. "
        "Set force=true to rebuild the entire search index from scratch. "
        "Automatically discovers new buckets from bucket.json files and index.json. "
        "Removes DB entries for deleted files."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "bucket": {
                "type": "string",
                "description": "Optional: limit reindex to a specific bucket id. "
                               "Omit to reindex all buckets.",
            },
            "force": {
                "type": "boolean",
                "description": "If true, rebuild the entire FTS index (full reindex). "
                               "Default false (selective — only changed files).",
                "default": False,
            },
        },
        "required": [],
    },
}


# ---------------------------------------------------------------------------
# Filesystem + DB helpers — called by the Desktop HTTP API endpoints
# ---------------------------------------------------------------------------

def _build_tree_node(path: Path, base_dir: Path) -> List[Dict]:
    """Recursively build a tree of dirs and .md files, dirs first."""
    entries = []
    try:
        items = sorted(path.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
    except PermissionError:
        return []
    for entry in items:
        if entry.name.startswith(".") or entry.name == "bucket.json":
            continue
        rel = str(entry.relative_to(base_dir)).replace("\\", "/")
        if entry.is_dir():
            entries.append({
                "name": entry.name,
                "relPath": rel,
                "fullPath": str(entry),
                "type": "dir",
                "children": _build_tree_node(entry, base_dir),
            })
        elif entry.name.lower().endswith(".md"):
            entries.append({
                "name": entry.name,
                "relPath": rel,
                "fullPath": str(entry),
                "type": "file",
            })
    return entries


def _find_bucket_for_path(conn, vault_dir: Path, full_path: str) -> Optional[Dict]:
    """Return {id, path, dir} for the bucket that owns full_path, or None."""
    buckets = conn.execute(
        "SELECT id, path FROM buckets ORDER BY length(path) DESC"
    ).fetchall()
    for bkt in buckets:
        bkt_dir = str(vault_dir / bkt["path"])
        if full_path == bkt_dir or full_path.startswith(bkt_dir + "/"):
            return {"id": bkt["id"], "path": bkt["path"], "dir": bkt_dir}
    return None


def tree_bucket(bucket_id: str) -> Dict:
    """Return {ok, tree, bucketPath} for a bucket."""
    vault_dir = _vault_dir()
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT path FROM buckets WHERE id = ?", (bucket_id,)
        ).fetchone()
        if not row:
            return {"ok": False, "tree": [], "bucketPath": "",
                    "error": f"Bucket '{bucket_id}' not found"}
        bkt_dir = vault_dir / row["path"]
        return {
            "ok": True,
            "tree": _build_tree_node(bkt_dir, bkt_dir),
            "bucketPath": str(bkt_dir),
        }
    except Exception as exc:
        return {"ok": False, "tree": [], "bucketPath": "", "error": str(exc)}
    finally:
        conn.close()


def read_vault_file(full_path: str) -> Dict:
    p = Path(full_path)
    if not p.exists():
        return {"ok": False, "content": "", "error": "File not found"}
    try:
        return {"ok": True, "content": p.read_text(encoding="utf-8", errors="replace")}
    except Exception as exc:
        return {"ok": False, "content": "", "error": str(exc)}


def write_vault_file(full_path: str, content: str) -> Dict:
    try:
        p = Path(full_path)
        p.write_text(content, encoding="utf-8")
        vault_dir = _vault_dir()
        conn = _get_conn()
        try:
            bkt = _find_bucket_for_path(conn, vault_dir, full_path)
            if bkt:
                rel = str(p.relative_to(bkt["dir"])).replace("\\", "/")
                mtime = p.stat().st_mtime
                exists = conn.execute(
                    "SELECT id FROM documents WHERE bucket_id = ? AND rel_path = ?",
                    (bkt["id"], rel),
                ).fetchone()
                if exists:
                    conn.execute(
                        "UPDATE documents SET is_stale = 1, modified_at = ? "
                        "WHERE bucket_id = ? AND rel_path = ?",
                        (mtime, bkt["id"], rel),
                    )
                    sc = conn.execute(
                        "SELECT COUNT(*) FROM documents WHERE bucket_id = ? AND is_stale = 1",
                        (bkt["id"],),
                    ).fetchone()[0]
                    conn.execute(
                        "UPDATE buckets SET stale_count = ? WHERE id = ?", (sc, bkt["id"])
                    )
                    conn.commit()
        finally:
            conn.close()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def create_vault_file(full_path: str) -> Dict:
    try:
        p = Path(full_path)
        if p.exists():
            return {"ok": False, "error": "File already exists"}
        p.parent.mkdir(parents=True, exist_ok=True)
        title = p.stem.replace("-", " ").replace("_", " ")
        p.write_text(f"# {title}\n\n", encoding="utf-8")
        vault_dir = _vault_dir()
        conn = _get_conn()
        try:
            bkt = _find_bucket_for_path(conn, vault_dir, full_path)
            if bkt:
                conn.execute(
                    "UPDATE buckets SET stale_count = stale_count + 1, updated_at = ? WHERE id = ?",
                    (time.time(), bkt["id"]),
                )
                conn.commit()
        finally:
            conn.close()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def create_vault_folder(full_path: str) -> Dict:
    try:
        p = Path(full_path)
        if p.exists():
            return {"ok": False, "error": "Folder already exists"}
        p.mkdir(parents=True, exist_ok=True)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def delete_vault_item(full_path: str, is_dir: bool) -> Dict:
    import shutil
    try:
        p = Path(full_path)
        if not p.exists():
            return {"ok": False, "error": "Path not found"}
        if is_dir:
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)
        vault_dir = _vault_dir()
        conn = _get_conn()
        try:
            bkt = _find_bucket_for_path(conn, vault_dir, full_path)
            if bkt:
                rel = str(p.relative_to(bkt["dir"])).replace("\\", "/")
                if is_dir:
                    conn.execute(
                        "DELETE FROM fts_docs WHERE bucket_id = ? AND rel_path LIKE ?",
                        (bkt["id"], rel + "/%"),
                    )
                    conn.execute(
                        "DELETE FROM documents WHERE bucket_id = ? AND rel_path LIKE ?",
                        (bkt["id"], rel + "/%"),
                    )
                else:
                    conn.execute(
                        "DELETE FROM fts_docs WHERE bucket_id = ? AND rel_path = ?",
                        (bkt["id"], rel),
                    )
                    conn.execute(
                        "DELETE FROM documents WHERE bucket_id = ? AND rel_path = ?",
                        (bkt["id"], rel),
                    )
                dc = conn.execute(
                    "SELECT COUNT(*) FROM documents WHERE bucket_id = ?", (bkt["id"],)
                ).fetchone()[0]
                sc = conn.execute(
                    "SELECT COUNT(*) FROM documents WHERE bucket_id = ? AND is_stale = 1",
                    (bkt["id"],),
                ).fetchone()[0]
                conn.execute(
                    "UPDATE buckets SET doc_count = ?, stale_count = ?, updated_at = ? WHERE id = ?",
                    (dc, sc, time.time(), bkt["id"]),
                )
                conn.commit()
        finally:
            conn.close()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def move_vault_item(from_path: str, to_dir: str) -> Dict:
    import shutil
    try:
        src = Path(from_path)
        dst_dir = Path(to_dir)
        if not src.exists():
            return {"ok": False, "error": "Source not found"}
        dst = dst_dir / src.name
        if src == dst:
            return {"ok": True}
        if dst.exists():
            return {"ok": False, "error": "Destination already exists"}
        if str(dst).startswith(str(src) + "/"):
            return {"ok": False, "error": "Cannot move folder into itself"}
        dst_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        vault_dir = _vault_dir()
        conn = _get_conn()
        try:
            bkt = _find_bucket_for_path(conn, vault_dir, from_path)
            if bkt:
                bkt_dir = Path(bkt["dir"])
                old_rel = str(src.relative_to(bkt_dir)).replace("\\", "/")
                new_rel = str(dst.relative_to(bkt_dir)).replace("\\", "/")
                conn.execute(
                    "UPDATE documents SET rel_path = ?, filename = ?, is_stale = 1 "
                    "WHERE bucket_id = ? AND rel_path = ?",
                    (new_rel, dst.name, bkt["id"], old_rel),
                )
                children = conn.execute(
                    "SELECT id, rel_path FROM documents WHERE bucket_id = ? AND rel_path LIKE ?",
                    (bkt["id"], old_rel + "/%"),
                ).fetchall()
                for child in children:
                    new_child_rel = new_rel + child["rel_path"][len(old_rel):]
                    conn.execute(
                        "UPDATE documents SET rel_path = ?, is_stale = 1 WHERE id = ?",
                        (new_child_rel, child["id"]),
                    )
                sc = conn.execute(
                    "SELECT COUNT(*) FROM documents WHERE bucket_id = ? AND is_stale = 1",
                    (bkt["id"],),
                ).fetchone()[0]
                conn.execute(
                    "UPDATE buckets SET stale_count = ? WHERE id = ?", (sc, bkt["id"])
                )
                conn.commit()
        finally:
            conn.close()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def delete_vault_bucket(bucket_id: str) -> Dict:
    import shutil
    vault_dir = _vault_dir()
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT path FROM buckets WHERE id = ?", (bucket_id,)
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Bucket '{bucket_id}' not found"}
        vault_db.delete_bucket(conn, bucket_id)
        index = _load_index(vault_dir)
        if bucket_id in index.get("buckets", {}):
            del index["buckets"][bucket_id]
            _save_index(vault_dir, index)
        bkt_dir = vault_dir / row["path"]
        if bkt_dir.exists():
            shutil.rmtree(bkt_dir, ignore_errors=True)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        conn.close()


def update_vault_bucket(bucket_id: str, name: str, description: str) -> Dict:
    vault_dir = _vault_dir()
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT path FROM buckets WHERE id = ?", (bucket_id,)
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Bucket '{bucket_id}' not found"}
        conn.execute(
            "UPDATE buckets SET name = ?, description = ?, updated_at = ? WHERE id = ?",
            (name, description, time.time(), bucket_id),
        )
        conn.commit()
        bj = vault_dir / row["path"] / "bucket.json"
        if bj.exists():
            try:
                meta = json.loads(bj.read_text(encoding="utf-8"))
                meta["name"] = name
                meta["description"] = description
                bj.write_text(json.dumps(meta, indent=2), encoding="utf-8")
            except Exception:
                pass
        index = _load_index(vault_dir)
        if bucket_id in index.get("buckets", {}):
            index["buckets"][bucket_id]["name"] = name
            index["buckets"][bucket_id]["description"] = description
            _save_index(vault_dir, index)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        conn.close()


def get_vault_bucket_links(bucket_id: str) -> Dict:
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT d1.rel_path AS from_path, l.to_title,
                   d2.rel_path AS to_path
            FROM links l
            JOIN documents d1 ON l.from_doc = d1.id
            LEFT JOIN documents d2
              ON d2.bucket_id = d1.bucket_id
             AND (lower(d2.title) = lower(l.to_title)
                  OR lower(d2.filename) = lower(l.to_title || '.md'))
            WHERE d1.bucket_id = ?
            """,
            (bucket_id,),
        ).fetchall()
        return {
            "ok": True,
            "links": [
                {
                    "fromPath": r["from_path"],
                    "toPath": r["to_path"],
                    "toTitle": r["to_title"],
                }
                for r in rows
            ],
        }
    except Exception as exc:
        return {"ok": False, "links": [], "error": str(exc)}
    finally:
        conn.close()


def get_vault_status() -> Dict:
    vault_dir = _vault_dir()
    conn = _get_conn()
    try:
        vault_db.refresh_stale_flags(conn, vault_dir)
        status = vault_db.get_sync_status(conn)
        return {"ok": True, **status}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

registry.register(
    name="vault_list_buckets",
    toolset="vault",
    schema=VAULT_LIST_BUCKETS_SCHEMA,
    handler=_handle_list_buckets,
    check_fn=_check_vault,
    emoji="🗄️",
)

registry.register(
    name="vault_browse",
    toolset="vault",
    schema=VAULT_BROWSE_SCHEMA,
    handler=_handle_browse,
    check_fn=_check_vault,
    emoji="📂",
)

registry.register(
    name="vault_search",
    toolset="vault",
    schema=VAULT_SEARCH_SCHEMA,
    handler=_handle_search,
    check_fn=_check_vault,
    emoji="🔍",
    max_result_size_chars=50_000,
)

registry.register(
    name="vault_create_bucket",
    toolset="vault",
    schema=VAULT_CREATE_BUCKET_SCHEMA,
    handler=_handle_create_bucket,
    check_fn=_check_vault,
    emoji="📚",
)

registry.register(
    name="vault_reindex",
    toolset="vault",
    schema=VAULT_REINDEX_SCHEMA,
    handler=_handle_reindex,
    check_fn=_check_vault,
    emoji="🔄",
)
