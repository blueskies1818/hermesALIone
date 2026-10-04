#!/usr/bin/env python3
"""
Theta approvals: dangerous commands from unattended workers go to the user.

A Kanban worker runs without anyone at a prompt, so the upstream approval
fallback ("Asking the user for approval") silently stalls. Instead:

1. The worker's command is recorded as a pending request for its task and
   the worker is told to block the task with an "Approval needed: ..."
   reason.
2. That block reaches the chat that created the task (session inbox), so
   the voice agent asks the user.
3. The orchestrating agent answers with ``kanban_approve``; an approval is
   stored for that task only, and the task is unblocked so the worker can
   retry.

Every command check is also appended to an audit log
(``<root data home>/logs/audit.jsonl``).
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from typing import Iterable, Optional

from tools.registry import registry, tool_error

APPROVAL_PREFIX = "Approval needed:"


# ---------------------------------------------------------------------------
# Store (shares the roster database in the root data home)
# ---------------------------------------------------------------------------

def _db():
    from gateway.agent_roster import _db as roster_db

    return roster_db()


def _ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS task_approvals ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " task_id TEXT NOT NULL,"
        " pattern_key TEXT NOT NULL,"
        " command TEXT NOT NULL,"
        " description TEXT NOT NULL,"
        " status TEXT NOT NULL,"  # pending | approved | denied
        " created_at REAL NOT NULL,"
        " decided_at REAL)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_task_approvals ON task_approvals(task_id, pattern_key)"
    )


def is_approved_for_task(task_id: str, pattern_keys: Iterable[str]) -> bool:
    """True when every pattern key has been approved for this task."""
    keys = list(pattern_keys)
    if not task_id or not keys:
        return False
    with _db() as conn:
        _ensure_tables(conn)
        approved = {
            row[0] for row in conn.execute(
                "SELECT pattern_key FROM task_approvals WHERE task_id = ? AND status = 'approved'",
                (task_id,),
            )
        }
    return all(key in approved for key in keys)


def request_approval(task_id: str, command: str, description: str, pattern_keys: Iterable[str]) -> None:
    """Record pending requests (one per pattern key) for a task."""
    now = time.time()
    with _db() as conn:
        _ensure_tables(conn)
        for key in pattern_keys:
            exists = conn.execute(
                "SELECT 1 FROM task_approvals WHERE task_id = ? AND pattern_key = ? AND status = 'pending'",
                (task_id, key),
            ).fetchone()
            if not exists:
                conn.execute(
                    "INSERT INTO task_approvals"
                    " (task_id, pattern_key, command, description, status, created_at)"
                    " VALUES (?, ?, ?, ?, 'pending', ?)",
                    (task_id, key, command[:2000], description[:500], now),
                )


def pending_requests(task_id: str) -> list[dict]:
    with _db() as conn:
        _ensure_tables(conn)
        rows = conn.execute(
            "SELECT pattern_key, command, description FROM task_approvals"
            " WHERE task_id = ? AND status = 'pending' ORDER BY id",
            (task_id,),
        ).fetchall()
    return [{"pattern_key": r[0], "command": r[1], "description": r[2]} for r in rows]


def decide(task_id: str, approve: bool) -> list[dict]:
    """Approve or deny all pending requests for a task; return them."""
    requests = pending_requests(task_id)
    with _db() as conn:
        _ensure_tables(conn)
        conn.execute(
            "UPDATE task_approvals SET status = ?, decided_at = ?"
            " WHERE task_id = ? AND status = 'pending'",
            ("approved" if approve else "denied", time.time(), task_id),
        )
    return requests


def worker_block_message(description: str, command: str) -> str:
    """What a worker is told when a command needs the user's approval."""
    return (
        f"BLOCKED: this command needs the user's approval ({description}).\n"
        "Do not work around it: no other command, script or tool that has the same "
        "effect. Call kanban_block on your task with the reason:\n"
        f"\"{APPROVAL_PREFIX} {description}. Command: {command[:300]}\"\n"
        "The user will be asked. If they approve, the task is unblocked and you can "
        "run the command again; if they decline, find another way or explain why "
        "the task can't be done."
    )


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

def audit(event: str, **fields) -> None:
    """Append one JSON line to the audit log. Never raises."""
    try:
        from hermes_constants import get_default_hermes_root

        path = get_default_hermes_root() / "logs" / "audit.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "event": event,
            "profile": os.environ.get("HERMES_PROFILE") or _current_profile(),
            "task": os.environ.get("HERMES_KANBAN_TASK") or None,
            **fields,
        }
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _current_profile() -> Optional[str]:
    try:
        from hermes_constants import get_hermes_home_override

        override = get_hermes_home_override()
        return os.path.basename(override) if override else "default"
    except Exception:
        return None


# ---------------------------------------------------------------------------
# kanban_approve tool (for orchestrators such as the voice agent)
# ---------------------------------------------------------------------------

KANBAN_APPROVE_SCHEMA = {
    "name": "kanban_approve",
    "description": (
        "Answer a worker's request for approval. Use this when a task is blocked with "
        f"'{APPROVAL_PREFIX} ...' and the user has said yes or no. Approval applies to "
        "that task only. The task is unblocked either way so the worker can continue."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "task_id": {"type": "string", "description": "The blocked task's id."},
            "approve": {"type": "boolean", "description": "True if the user approved, false if they declined."},
            "note": {"type": "string", "description": "Optional message for the worker (e.g. conditions or an alternative)."},
        },
        "required": ["task_id", "approve"],
    },
}


def kanban_approve_tool(task_id: str, approve: bool, note: str = "") -> str:
    if not task_id:
        return tool_error("task_id is required")
    requests = decide(task_id, bool(approve))
    if not requests:
        return tool_error(f"Task {task_id} has no pending approval requests.")
    decision = "APPROVED" if approve else "DECLINED"
    commands = "; ".join(r["command"][:200] for r in requests)
    comment = f"User {decision} the requested command(s): {commands}"
    if note:
        comment += f"\nNote from the user: {note}"
    if not approve:
        comment += "\nDo not run it. Find another approach or explain why the task can't be done."
    audit("approval_decision", decision=decision.lower(), kanban_task=task_id, commands=commands)

    from tools import kanban_tools

    comment_out = kanban_tools._handle_comment({"task_id": task_id, "body": comment})
    unblock_out = kanban_tools._handle_unblock({"task_id": task_id})
    return json.dumps({
        "success": True,
        "decision": decision.lower(),
        "task_id": task_id,
        "comment": json.loads(comment_out) if comment_out.startswith("{") else comment_out,
        "unblock": json.loads(unblock_out) if unblock_out.startswith("{") else unblock_out,
    })


def _check_orchestrator() -> bool:
    from tools.kanban_tools import _check_kanban_orchestrator_mode

    return _check_kanban_orchestrator_mode()


registry.register(
    name="kanban_approve",
    toolset="kanban",
    schema=KANBAN_APPROVE_SCHEMA,
    handler=lambda args, **kw: kanban_approve_tool(
        task_id=str(args.get("task_id") or ""),
        approve=bool(args.get("approve")),
        note=str(args.get("note") or ""),
    ),
    check_fn=_check_orchestrator,
    emoji="✅",
)
