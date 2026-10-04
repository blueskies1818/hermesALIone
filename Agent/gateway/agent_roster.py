"""Theta agent roster: which agent (profile) a conversation is talking to.

Each agent is a Hermes profile with its own SOUL.md, model, toolsets and
memory. A conversation (session id) is served by one agent at a time; the
``switch_agent`` tool records a handoff here and the API server picks the
new agent up for the rest of the turn and for later turns.

Agents share provider keys from the root ``.env``. An agent's own settings
are applied by scoping ``get_hermes_home()`` to its profile directory with
the context-local override (no ``os.environ`` mutation), so concurrent
agents in one process do not interfere with each other.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

DEFAULT_AGENT = "default"

_lock = threading.Lock()


def _db_path() -> Path:
    # Anchored to the root data home, not the (possibly profile-scoped)
    # current home, so every agent sees the same roster.
    from hermes_constants import get_default_hermes_root

    return get_default_hermes_root() / "agent_roster.db"


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=5)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS session_agents ("
        " session_id TEXT PRIMARY KEY,"
        " agent TEXT NOT NULL,"
        " previous_agent TEXT,"
        " handoff_note TEXT,"
        " handoff_pending INTEGER NOT NULL DEFAULT 0,"
        " updated_at REAL NOT NULL)"
    )
    return conn


@contextmanager
def _db() -> Iterator[sqlite3.Connection]:
    """Serialized connection that commits on success and always closes."""
    with _lock:
        conn = _connect()
        try:
            with conn:
                yield conn
        finally:
            conn.close()


def normalize_agent_name(name: str) -> str:
    from hermes_cli.profiles import normalize_profile_name

    return normalize_profile_name(str(name or "").strip() or DEFAULT_AGENT)


def agent_exists(name: str) -> bool:
    from hermes_cli.profiles import profile_exists

    try:
        return profile_exists(normalize_agent_name(name))
    except ValueError:
        return False


def agent_home(name: str) -> Path:
    from hermes_cli.profiles import get_profile_dir

    return get_profile_dir(normalize_agent_name(name))


def list_agents() -> list[dict]:
    """Return the available agents with a short description each."""
    from hermes_cli.profiles import list_profiles, read_profile_meta

    agents = []
    for info in list_profiles():
        meta = read_profile_meta(info.path) or {}
        agents.append({
            "name": info.name,
            "description": str(meta.get("description") or "").strip(),
            "model": info.model or "",
        })
    return agents


def get_session_agent(session_id: Optional[str]) -> str:
    """Agent currently serving ``session_id`` (``default`` if never switched)."""
    if not session_id:
        return DEFAULT_AGENT
    with _db() as conn:
        row = conn.execute(
            "SELECT agent FROM session_agents WHERE session_id = ?", (session_id,)
        ).fetchone()
    return row[0] if row else DEFAULT_AGENT


def assign_initial_agent(session_id: Optional[str], agent: str) -> bool:
    """Start ``session_id`` with ``agent`` if the session has no agent yet.

    Used for entry points with a natural default agent (voice mode starts
    with the voice agent). Never overrides an earlier switch. Returns True
    when the agent was assigned.
    """
    if not session_id or not agent_exists(agent):
        return False
    target = normalize_agent_name(agent)
    with _db() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO session_agents"
            " (session_id, agent, previous_agent, handoff_note, handoff_pending, updated_at)"
            " VALUES (?, ?, NULL, '', 0, ?)",
            (session_id, target, time.time()),
        )
        return cur.rowcount == 1


def voice_agent_name() -> str:
    """Agent that voice-mode conversations start with (``theta.voice_agent``)."""
    from hermes_constants import get_default_hermes_root

    theta_cfg = _read_config(get_default_hermes_root()).get("theta") or {}
    return str(theta_cfg.get("voice_agent") or "voice")


GENERAL_PROJECT = "general"


def _ensure_project_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS session_projects ("
        " session_id TEXT PRIMARY KEY, project TEXT NOT NULL, updated_at REAL NOT NULL)"
    )


def set_session_project(session_id: str, project: str) -> str:
    """Set the project a conversation belongs to (vault filing, task tenant)."""
    name = " ".join(str(project or "").split())[:80] or GENERAL_PROJECT
    with _db() as conn:
        _ensure_project_table(conn)
        conn.execute(
            "INSERT INTO session_projects (session_id, project, updated_at) VALUES (?, ?, ?)"
            " ON CONFLICT(session_id) DO UPDATE SET project = excluded.project,"
            " updated_at = excluded.updated_at",
            (session_id, name, time.time()),
        )
    return name


def get_session_project(session_id: Optional[str]) -> Optional[str]:
    if not session_id:
        return None
    with _db() as conn:
        _ensure_project_table(conn)
        row = conn.execute(
            "SELECT project FROM session_projects WHERE session_id = ?", (session_id,)
        ).fetchone()
    return row[0] if row else None


def record_handoff(session_id: str, to_agent: str, note: str = "") -> str:
    """Point ``session_id`` at ``to_agent`` and mark a handoff as pending."""
    target = normalize_agent_name(to_agent)
    previous = get_session_agent(session_id)
    with _db() as conn:
        conn.execute(
            "INSERT INTO session_agents"
            " (session_id, agent, previous_agent, handoff_note, handoff_pending, updated_at)"
            " VALUES (?, ?, ?, ?, 1, ?)"
            " ON CONFLICT(session_id) DO UPDATE SET"
            " agent = excluded.agent, previous_agent = excluded.previous_agent,"
            " handoff_note = excluded.handoff_note, handoff_pending = 1,"
            " updated_at = excluded.updated_at",
            (session_id, target, previous, note.strip(), time.time()),
        )
    return target


def take_pending_handoff(session_id: Optional[str]) -> Optional[dict]:
    """Return and clear a pending handoff for ``session_id``, if any."""
    if not session_id:
        return None
    with _db() as conn:
        row = conn.execute(
            "SELECT agent, previous_agent, handoff_note FROM session_agents"
            " WHERE session_id = ? AND handoff_pending = 1",
            (session_id,),
        ).fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE session_agents SET handoff_pending = 0 WHERE session_id = ?",
            (session_id,),
        )
    return {"agent": row[0], "previous_agent": row[1] or DEFAULT_AGENT, "note": row[2] or ""}


@contextmanager
def agent_scope(name: Optional[str]) -> Iterator[Optional[dict]]:
    """Scope ``get_hermes_home()`` to an agent's profile for this context.

    Yields the agent's parsed config.yaml for non-default agents, or ``None``
    for the default agent (which uses the gateway's own config unchanged).
    """
    agent = normalize_agent_name(name or DEFAULT_AGENT)
    if agent == DEFAULT_AGENT or not agent_exists(agent):
        yield None
        return

    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    from hermes_constants import get_default_hermes_root

    # Agents inherit the root config; their own config.yaml (if any) wins.
    config = _deep_merge(_read_config(get_default_hermes_root()), _read_config(agent_home(agent)))
    token = set_hermes_home_override(agent_home(agent))
    try:
        yield config
    finally:
        reset_hermes_home_override(token)


def _deep_merge(base: dict, override: dict) -> dict:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _read_config(home: Path) -> dict:
    path = home / "config.yaml"
    if not path.exists():
        return {}
    import yaml

    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}
