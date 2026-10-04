"""Theta session inbox: worker updates waiting to be told to the user.

When an agent in a chat session hands work to another agent through Kanban
(e.g. the voice agent creating a task for the worker), the task row carries
that chat's ``session_id``. This module watches the Kanban event log for
outcomes the user should hear about -- a task finished, failed, or is
blocked on a question -- and queues a message for the originating session.

The API server delivers queued messages: right away as a proactive agent
turn when the app is listening and the session is idle, otherwise after the
current turn ends or at the start of the user's next message.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from typing import Optional

# Kanban event kinds worth telling the user about, and how to phrase them.
NOTIFY_KINDS = ("completed", "blocked", "gave_up", "timed_out")


@dataclass
class InboxItem:
    id: int
    session_id: str
    task_id: str
    kind: str
    text: str


def _db():
    # Same database file as the agent roster (root data home).
    from gateway.agent_roster import _db as roster_db

    return roster_db()


def _ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS session_inbox ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " session_id TEXT NOT NULL,"
        " task_id TEXT NOT NULL,"
        " kind TEXT NOT NULL,"
        " text TEXT NOT NULL,"
        " created_at REAL NOT NULL,"
        " delivered_at REAL)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_inbox_pending"
        " ON session_inbox(session_id, delivered_at)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS inbox_cursor ("
        " source TEXT PRIMARY KEY, last_event_id INTEGER NOT NULL)"
    )


def format_update(kind: str, task_id: str, title: str, payload: dict) -> str:
    """Message handed to the session's agent for one Kanban outcome."""
    title = title or task_id
    if kind == "completed":
        summary = str(payload.get("summary") or "").strip() or "No summary given."
        return f"Task '{title}' ({task_id}) is done. Worker summary: {summary}"
    if kind == "blocked":
        reason = str(payload.get("reason") or "").strip() or "No reason given."
        return (
            f"Task '{title}' ({task_id}) is blocked and the worker needs input: {reason} "
            "Ask the user, then pass their answer back with kanban_comment and "
            f"kanban_unblock on {task_id}."
        )
    if kind == "timed_out":
        return f"Task '{title}' ({task_id}) ran out of time before finishing."
    detail = str(payload.get("error") or payload.get("reason") or "").strip()
    return f"Task '{title}' ({task_id}) failed and was given up." + (
        f" Last error: {detail}" if detail else ""
    )


def poll_kanban(kanban_db_path) -> list[str]:
    """Queue inbox items for new Kanban outcomes; return affected session ids.

    The first poll only records the current position, so a restart never
    replays old history to users.
    """
    from pathlib import Path

    path = Path(kanban_db_path)
    if not path.exists():
        return []
    source = str(path)
    with _db() as conn:
        _ensure_tables(conn)
        row = conn.execute(
            "SELECT last_event_id FROM inbox_cursor WHERE source = ?", (source,)
        ).fetchone()
    last_id = row[0] if row else None

    kconn = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=5)
    try:
        if last_id is None:
            max_id = kconn.execute("SELECT COALESCE(MAX(id), 0) FROM task_events").fetchone()[0]
            with _db() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO inbox_cursor (source, last_event_id) VALUES (?, ?)",
                    (source, max_id),
                )
            return []
        placeholders = ",".join("?" for _ in NOTIFY_KINDS)
        events = kconn.execute(
            "SELECT e.id, e.task_id, e.kind, e.payload, t.title, t.session_id"
            " FROM task_events e JOIN tasks t ON t.id = e.task_id"
            f" WHERE e.id > ? AND e.kind IN ({placeholders})"
            " ORDER BY e.id",
            (last_id, *NOTIFY_KINDS),
        ).fetchall()
        newest = kconn.execute("SELECT COALESCE(MAX(id), 0) FROM task_events").fetchone()[0]
    finally:
        kconn.close()

    sessions: list[str] = []
    with _db() as conn:
        for _eid, task_id, kind, payload, title, session_id in events:
            if not session_id:
                continue
            try:
                data = json.loads(payload) if payload else {}
            except (TypeError, ValueError):
                data = {}
            conn.execute(
                "INSERT INTO session_inbox (session_id, task_id, kind, text, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (session_id, task_id, kind, format_update(kind, task_id, title, data), time.time()),
            )
            if session_id not in sessions:
                sessions.append(session_id)
        conn.execute(
            "UPDATE inbox_cursor SET last_event_id = ? WHERE source = ?",
            (max(newest, last_id), source),
        )
    return sessions


def pending(session_id: Optional[str]) -> list[InboxItem]:
    if not session_id:
        return []
    with _db() as conn:
        _ensure_tables(conn)
        rows = conn.execute(
            "SELECT id, session_id, task_id, kind, text FROM session_inbox"
            " WHERE session_id = ? AND delivered_at IS NULL ORDER BY id",
            (session_id,),
        ).fetchall()
    return [InboxItem(*row) for row in rows]


def sessions_with_pending() -> list[str]:
    with _db() as conn:
        _ensure_tables(conn)
        rows = conn.execute(
            "SELECT DISTINCT session_id FROM session_inbox WHERE delivered_at IS NULL"
        ).fetchall()
    return [r[0] for r in rows]


def mark_delivered(ids: list[int]) -> None:
    if not ids:
        return
    with _db() as conn:
        _ensure_tables(conn)
        conn.executemany(
            "UPDATE session_inbox SET delivered_at = ? WHERE id = ?",
            [(time.time(), i) for i in ids],
        )


def render(items: list[InboxItem]) -> str:
    """Text block describing pending updates, for the agent (not the user)."""
    lines = "\n".join(f"- {item.text}" for item in items)
    return f"[Updates from the work agent]\n{lines}"
