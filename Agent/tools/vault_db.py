"""
vault_db.py — SQLite database layer for the Hermes multi-bucket knowledge vault.

Manages structured metadata and FTS5 full-text search for notes stored in
~/.hermes/vault/. This module only handles the DB — file I/O is done by the
agent directly using the existing file toolset (read_file, write_file, patch).

Vault layout on disk:
    ~/.hermes/vault/
    ├── vault.db          ← this module's DB
    ├── index.json        ← bucket registry (agent maintains via write_file)
    ├── <bucket>/
    │   ├── bucket.json
    │   └── **/*.md
    └── ...

Freshness tracking:
    documents.modified_at stores the file's mtime at index time.
    mark_stale() walks the vault dir and sets is_stale=1 on any document
    whose on-disk mtime is newer than modified_at, and deletes rows for
    files that no longer exist. vault_reindex then only re-parses stale/new
    files (selective sync), or all files when force=True.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_WAL_INCOMPAT_MARKERS = ("locking protocol", "not authorized", "disk i/o error")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS buckets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    path        TEXT NOT NULL,
    doc_count   INTEGER NOT NULL DEFAULT 0,
    stale_count INTEGER NOT NULL DEFAULT 0,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    bucket_id   TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    rel_path    TEXT NOT NULL,
    title       TEXT,
    char_count  INTEGER NOT NULL DEFAULT 0,
    indexed_at  REAL NOT NULL,
    modified_at REAL NOT NULL,
    is_stale    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tags (
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
    from_doc    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    to_title    TEXT NOT NULL,
    line_number INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_docs USING fts5(
    title,
    content,
    bucket_id UNINDEXED,
    rel_path  UNINDEXED,
    tokenize  = 'unicode61'
);

CREATE INDEX IF NOT EXISTS idx_documents_bucket ON documents(bucket_id);
CREATE INDEX IF NOT EXISTS idx_documents_stale  ON documents(is_stale);
CREATE INDEX IF NOT EXISTS idx_tags_doc         ON tags(doc_id);
CREATE INDEX IF NOT EXISTS idx_links_from       ON links(from_doc);
"""

# Wikilink pattern: [[Target Title]] or [[Target Title|display]]
_WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
# YAML frontmatter block
_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
# Inline YAML tags: tags: [a, b] or tags:\n  - a
_TAGS_RE = re.compile(r"^tags\s*:\s*(.+)$", re.MULTILINE)


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

def connect(db_path: Path) -> sqlite3.Connection:
    """Open a connection with WAL mode, FK enforcement, and a 5 s busy timeout."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=5.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        conn.execute("PRAGMA journal_mode = WAL")
    except sqlite3.OperationalError as exc:
        msg = str(exc).lower()
        if any(m in msg for m in _WAL_INCOMPAT_MARKERS):
            conn.execute("PRAGMA journal_mode = DELETE")
        else:
            raise
    return conn


def init_db(db_path: Path) -> sqlite3.Connection:
    """Create schema if needed and return an open connection."""
    conn = connect(db_path)
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Doc ID
# ---------------------------------------------------------------------------

def _doc_id(bucket_id: str, rel_path: str) -> str:
    return hashlib.sha256(f"{bucket_id}\x00{rel_path}".encode()).hexdigest()[:32]


# ---------------------------------------------------------------------------
# Frontmatter / link extraction
# ---------------------------------------------------------------------------

def _extract_metadata(content: str) -> Tuple[Optional[str], List[str], str]:
    """Return (title, tags, body_without_frontmatter).

    Title comes from frontmatter ``title:`` field, or falls back to the
    first ``# Heading`` in the body.
    """
    title: Optional[str] = None
    tags: List[str] = []
    body = content

    fm_match = _FRONTMATTER_RE.match(content)
    if fm_match:
        fm_text = fm_match.group(1)
        body = content[fm_match.end():]

        # title
        for line in fm_text.splitlines():
            if line.lower().startswith("title:"):
                title = line.split(":", 1)[1].strip().strip("\"'")
                break

        # tags
        tags_match = _TAGS_RE.search(fm_text)
        if tags_match:
            raw = tags_match.group(1).strip()
            if raw.startswith("["):
                raw = raw.strip("[]")
                tags = [t.strip().strip("\"'") for t in raw.split(",") if t.strip()]
            else:
                tags = [raw.strip().strip("\"'-")]

    if not title:
        for line in body.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break

    return title, tags, body


def _extract_wikilinks(content: str) -> List[str]:
    return _WIKILINK_RE.findall(content)


# ---------------------------------------------------------------------------
# Upsert / delete
# ---------------------------------------------------------------------------

def upsert_bucket(
    conn: sqlite3.Connection,
    bucket_id: str,
    name: str,
    description: str,
    rel_path: str,
) -> None:
    now = time.time()
    conn.execute(
        """
        INSERT INTO buckets (id, name, description, path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name        = excluded.name,
            description = excluded.description,
            path        = excluded.path,
            updated_at  = excluded.updated_at
        """,
        (bucket_id, name, description, rel_path, now, now),
    )
    conn.commit()


def upsert_document(
    conn: sqlite3.Connection,
    bucket_id: str,
    rel_path: str,
    filename: str,
    content: str,
    mtime: float,
) -> str:
    """Parse and index a document. Returns the document id."""
    doc_id = _doc_id(bucket_id, rel_path)
    title, tags, body = _extract_metadata(content)
    wikilinks = _extract_wikilinks(content)
    now = time.time()

    conn.execute(
        """
        INSERT INTO documents (id, bucket_id, filename, rel_path, title,
                               char_count, indexed_at, modified_at, is_stale)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
            filename    = excluded.filename,
            title       = excluded.title,
            char_count  = excluded.char_count,
            indexed_at  = excluded.indexed_at,
            modified_at = excluded.modified_at,
            is_stale    = 0
        """,
        (doc_id, bucket_id, filename, rel_path,
         title, len(content), now, mtime),
    )

    # FTS: delete old entry then insert fresh
    conn.execute("DELETE FROM fts_docs WHERE rel_path = ? AND bucket_id = ?",
                 (rel_path, bucket_id))
    conn.execute(
        "INSERT INTO fts_docs (title, content, bucket_id, rel_path) VALUES (?, ?, ?, ?)",
        (title or filename, body, bucket_id, rel_path),
    )

    # Tags
    conn.execute("DELETE FROM tags WHERE doc_id = ?", (doc_id,))
    if tags:
        conn.executemany("INSERT INTO tags (doc_id, tag) VALUES (?, ?)",
                         [(doc_id, t) for t in tags if t])

    # Wikilinks
    conn.execute("DELETE FROM links WHERE from_doc = ?", (doc_id,))
    if wikilinks:
        conn.executemany(
            "INSERT INTO links (from_doc, to_title) VALUES (?, ?)",
            [(doc_id, lnk) for lnk in wikilinks],
        )

    return doc_id


def delete_document(conn: sqlite3.Connection, doc_id: str) -> None:
    conn.execute("DELETE FROM fts_docs WHERE rowid IN "
                 "(SELECT rowid FROM fts_docs WHERE rel_path = "
                 "(SELECT rel_path FROM documents WHERE id = ?))", (doc_id,))
    conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))


def delete_bucket(conn: sqlite3.Connection, bucket_id: str) -> None:
    conn.execute("DELETE FROM fts_docs WHERE bucket_id = ?", (bucket_id,))
    conn.execute("DELETE FROM buckets WHERE id = ?", (bucket_id,))
    conn.commit()


# ---------------------------------------------------------------------------
# Freshness
# ---------------------------------------------------------------------------

def refresh_stale_flags(
    conn: sqlite3.Connection,
    vault_dir: Path,
    bucket_id: Optional[str] = None,
) -> Dict[str, int]:
    """Walk the vault dir and update is_stale flags.

    Returns {bucket_id: stale_count} for affected buckets.

    Marks a document stale when its on-disk mtime > modified_at.
    Deletes DB rows for .md files that no longer exist on disk.
    Does NOT re-parse content — that is done by vault_reindex.
    """
    query = "SELECT id, bucket_id, rel_path, modified_at FROM documents"
    params: tuple = ()
    if bucket_id:
        query += " WHERE bucket_id = ?"
        params = (bucket_id,)

    rows = conn.execute(query, params).fetchall()
    stale_counts: Dict[str, int] = {}
    to_delete: List[str] = []
    to_mark_stale: List[str] = []
    to_mark_fresh: List[str] = []

    for row in rows:
        bkt = row["bucket_id"]
        bucket_row = conn.execute(
            "SELECT path FROM buckets WHERE id = ?", (bkt,)
        ).fetchone()
        if not bucket_row:
            to_delete.append(row["id"])
            continue
        file_path = vault_dir / bucket_row["path"] / row["rel_path"]
        if not file_path.exists():
            to_delete.append(row["id"])
            continue
        disk_mtime = file_path.stat().st_mtime
        if disk_mtime > row["modified_at"] + 0.5:  # 0.5 s grace for FS clock skew
            to_mark_stale.append(row["id"])
            stale_counts[bkt] = stale_counts.get(bkt, 0) + 1
        else:
            to_mark_fresh.append(row["id"])

    if to_delete:
        conn.executemany("DELETE FROM documents WHERE id = ?",
                         [(d,) for d in to_delete])
        conn.executemany("DELETE FROM fts_docs WHERE rel_path IN "
                         "(SELECT rel_path FROM documents WHERE id = ?)",
                         [(d,) for d in to_delete])

    if to_mark_stale:
        conn.executemany("UPDATE documents SET is_stale = 1 WHERE id = ?",
                         [(d,) for d in to_mark_stale])
    if to_mark_fresh:
        conn.executemany("UPDATE documents SET is_stale = 0 WHERE id = ?",
                         [(d,) for d in to_mark_fresh])

    # Update stale_count on each affected bucket
    affected_buckets = set(stale_counts.keys())
    if bucket_id and bucket_id not in affected_buckets:
        affected_buckets.add(bucket_id)

    for bkt in affected_buckets:
        sc = conn.execute(
            "SELECT COUNT(*) FROM documents WHERE bucket_id = ? AND is_stale = 1",
            (bkt,),
        ).fetchone()[0]
        dc = conn.execute(
            "SELECT COUNT(*) FROM documents WHERE bucket_id = ?", (bkt,)
        ).fetchone()[0]
        conn.execute(
            "UPDATE buckets SET stale_count = ?, doc_count = ?, updated_at = ? WHERE id = ?",
            (sc, dc, time.time(), bkt),
        )

    conn.commit()
    return stale_counts


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def get_sync_status(conn: sqlite3.Connection) -> Dict[str, Any]:
    """Return overall vault sync status."""
    total = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    stale = conn.execute(
        "SELECT COUNT(*) FROM documents WHERE is_stale = 1"
    ).fetchone()[0]
    buckets = [
        dict(row)
        for row in conn.execute(
            "SELECT id, name, doc_count, stale_count FROM buckets ORDER BY name"
        ).fetchall()
    ]
    return {"total_docs": total, "stale_docs": stale, "buckets": buckets}


def list_buckets(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, name, description, path, doc_count, stale_count, "
        "created_at, updated_at FROM buckets ORDER BY name"
    ).fetchall()
    return [dict(r) for r in rows]


def list_documents(
    conn: sqlite3.Connection,
    bucket_id: str,
    rel_prefix: str = "",
) -> List[Dict[str, Any]]:
    """List documents in a bucket, optionally filtered by path prefix."""
    if rel_prefix:
        rows = conn.execute(
            "SELECT id, filename, rel_path, title, char_count, is_stale "
            "FROM documents WHERE bucket_id = ? AND rel_path LIKE ? ORDER BY rel_path",
            (bucket_id, rel_prefix.rstrip("/") + "%"),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, filename, rel_path, title, char_count, is_stale "
            "FROM documents WHERE bucket_id = ? ORDER BY rel_path",
            (bucket_id,),
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# FTS search
# ---------------------------------------------------------------------------

_DEPTH_CHARS = {"snippet": 160, "summary": 500, "full": None}


def fts_search(
    conn: sqlite3.Connection,
    vault_dir: Path,
    query: str,
    bucket_id: Optional[str] = None,
    limit: int = 10,
    token_budget: int = 4000,
    result_depth: str = "snippet",
) -> List[Dict[str, Any]]:
    """Full-text search using FTS5.

    result_depth controls how much document content is returned per match:
      - 'snippet'  : FTS5 highlighted fragment (~160 chars around match)
      - 'summary'  : first 500 chars of document
      - 'full'     : entire document content (subject to token_budget)
    token_budget caps total chars returned across all results.
    """
    if result_depth not in _DEPTH_CHARS:
        result_depth = "snippet"

    if bucket_id:
        fts_rows = conn.execute(
            "SELECT title, content, bucket_id, rel_path, "
            "snippet(fts_docs, 1, '[', ']', '...', 20) AS snip "
            "FROM fts_docs WHERE fts_docs MATCH ? AND bucket_id = ? LIMIT ?",
            (query, bucket_id, limit),
        ).fetchall()
    else:
        fts_rows = conn.execute(
            "SELECT title, content, bucket_id, rel_path, "
            "snippet(fts_docs, 1, '[', ']', '...', 20) AS snip "
            "FROM fts_docs WHERE fts_docs MATCH ? LIMIT ?",
            (query, limit),
        ).fetchall()

    results: List[Dict[str, Any]] = []
    chars_used = 0

    for row in fts_rows:
        if chars_used >= token_budget:
            break

        bkt_row = conn.execute(
            "SELECT name FROM buckets WHERE id = ?", (row["bucket_id"],)
        ).fetchone()
        bucket_name = bkt_row["name"] if bkt_row else row["bucket_id"]

        if result_depth == "snippet":
            text = row["snip"] or (row["content"] or "")[:160]
        elif result_depth == "summary":
            text = (row["content"] or "")[:500]
        else:  # full
            # Read from disk for freshest content
            bkt_path_row = conn.execute(
                "SELECT path FROM buckets WHERE id = ?", (row["bucket_id"],)
            ).fetchone()
            if bkt_path_row:
                file_path = vault_dir / bkt_path_row["path"] / row["rel_path"]
                try:
                    text = file_path.read_text(encoding="utf-8")
                except OSError:
                    text = row["content"] or ""
            else:
                text = row["content"] or ""

        remaining = token_budget - chars_used
        if len(text) > remaining:
            text = text[:remaining] + "…"

        results.append({
            "bucket_id":   row["bucket_id"],
            "bucket_name": bucket_name,
            "rel_path":    row["rel_path"],
            "title":       row["title"],
            "match":       text,
            "depth":       result_depth,
        })
        chars_used += len(text)

    return results
