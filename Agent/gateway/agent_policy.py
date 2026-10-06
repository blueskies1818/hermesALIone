"""Theta: per-agent and per-conversation policy.

Each agent (profile) can set, in its config.yaml:

    theta:
      tools:
        enabled: [web]        # extra toolsets on top of the platform default
        disabled: [terminal]  # toolsets off by default for this agent
      project_scope:
        mode: all | fixed | chat
        project: "garden app" # for mode "fixed"
    fallback_providers: [{provider: ..., model: ...}]

A conversation can then turn individual toolsets on or off for itself
(``session_tools`` table) and pick its project (``session_projects``).

Project scope modes:
  all   - the agent may work across every project (default)
  fixed - every conversation with this agent is locked to one project
  chat  - the conversation is locked to the project chosen for it
"""

from __future__ import annotations

import time
from typing import Iterable, Optional

from gateway import agent_roster as roster

SCOPE_MODES = ("all", "fixed", "chat")


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def _theta(config: Optional[dict]) -> dict:
    value = (config or {}).get("theta")
    return value if isinstance(value, dict) else {}


def _names(value) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return [str(v).strip() for v in value if str(v or "").strip()]


def tool_defaults(config: Optional[dict]) -> dict:
    tools = _theta(config).get("tools")
    tools = tools if isinstance(tools, dict) else {}
    return {"enabled": _names(tools.get("enabled")), "disabled": _names(tools.get("disabled"))}


def project_scope(config: Optional[dict]) -> dict:
    scope = _theta(config).get("project_scope")
    scope = scope if isinstance(scope, dict) else {}
    mode = str(scope.get("mode") or "all").strip().lower()
    if mode not in SCOPE_MODES:
        mode = "all"
    project = " ".join(str(scope.get("project") or "").split())[:80]
    if mode == "fixed" and not project:
        mode = "all"
    return {"mode": mode, "project": project if mode == "fixed" else ""}


def fallback_chain(config: Optional[dict]):
    """The agent's own fallback chain, or None to use the global one."""
    value = (config or {}).get("fallback_providers") or (config or {}).get("fallback_model")
    return value or None


def agent_config(agent: Optional[str]) -> dict:
    """Merged config (root + the agent's own) for ``agent``."""
    from hermes_constants import get_default_hermes_root

    name = roster.normalize_agent_name(agent or roster.DEFAULT_AGENT)
    root = roster._read_config(get_default_hermes_root())
    if name == roster.DEFAULT_AGENT or not roster.agent_exists(name):
        return root
    return roster._deep_merge(root, roster._read_config(roster.agent_home(name)))


# ---------------------------------------------------------------------------
# Per-conversation tool overrides
# ---------------------------------------------------------------------------

def _ensure_tools_table(conn) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS session_tools ("
        " session_id TEXT NOT NULL, toolset TEXT NOT NULL, enabled INTEGER NOT NULL,"
        " updated_at REAL NOT NULL, PRIMARY KEY (session_id, toolset))"
    )


def session_tool_overrides(session_id: Optional[str]) -> dict[str, bool]:
    if not session_id:
        return {}
    with roster._db() as conn:
        _ensure_tools_table(conn)
        rows = conn.execute(
            "SELECT toolset, enabled FROM session_tools WHERE session_id = ?", (session_id,)
        ).fetchall()
    return {row[0]: bool(row[1]) for row in rows}


def set_session_tool(session_id: str, toolset: str, enabled: Optional[bool]) -> None:
    """Turn a toolset on/off for one conversation; ``None`` clears the override."""
    with roster._db() as conn:
        _ensure_tools_table(conn)
        if enabled is None:
            conn.execute(
                "DELETE FROM session_tools WHERE session_id = ? AND toolset = ?",
                (session_id, toolset),
            )
        else:
            conn.execute(
                "INSERT INTO session_tools (session_id, toolset, enabled, updated_at)"
                " VALUES (?, ?, ?, ?) ON CONFLICT(session_id, toolset) DO UPDATE SET"
                " enabled = excluded.enabled, updated_at = excluded.updated_at",
                (session_id, toolset, 1 if enabled else 0, time.time()),
            )


# ---------------------------------------------------------------------------
# Toolsets
# ---------------------------------------------------------------------------

def default_toolsets(config: Optional[dict]) -> set[str]:
    """Toolsets an agent gets in a new conversation."""
    from hermes_cli.tools_config import _get_platform_tools

    base = set(_get_platform_tools(config or {}, "api_server"))
    defaults = tool_defaults(config)
    return (base | set(defaults["enabled"])) - set(defaults["disabled"])


def apply_overrides(toolsets: Iterable[str], overrides: dict[str, bool]) -> list[str]:
    result = set(toolsets)
    for name, enabled in overrides.items():
        if enabled:
            result.add(name)
        else:
            result.discard(name)
    return sorted(result)


def effective_toolsets(config: Optional[dict], session_id: Optional[str] = None) -> list[str]:
    return apply_overrides(default_toolsets(config), session_tool_overrides(session_id))


def toolset_catalog(config: Optional[dict] = None) -> list[dict]:
    """Every toolset the app can switch: built-in groups plus MCP servers."""
    from hermes_cli.tools_config import _get_effective_configurable_toolsets

    items = [
        {"name": name, "label": label, "description": desc, "kind": "builtin"}
        for name, label, desc in _get_effective_configurable_toolsets()
    ]
    servers = (config or {}).get("mcp_servers") or {}
    known = {i["name"] for i in items}
    for name, cfg in servers.items():
        if str(name) in known:
            continue
        detail = ""
        if isinstance(cfg, dict):
            detail = str(cfg.get("url") or cfg.get("command") or "")
        items.append({
            "name": str(name),
            "label": str(name),
            "description": f"MCP server {detail}".strip(),
            "kind": "mcp",
        })
    return items


# ---------------------------------------------------------------------------
# Project scope
# ---------------------------------------------------------------------------

def session_scope(session_id: Optional[str]) -> dict:
    """Project scope in force for a conversation.

    Returns ``{"mode", "project", "locked"}`` where ``project`` is the project
    the conversation must stay in (``None`` when unrestricted or not chosen
    yet) and ``locked`` says whether the agent may change it.
    """
    agent = roster.get_session_agent(session_id) if session_id else roster.DEFAULT_AGENT
    scope = project_scope(agent_config(agent))
    current = roster.get_session_project(session_id) if session_id else None
    if scope["mode"] == "fixed":
        return {"mode": "fixed", "project": scope["project"], "locked": True}
    if scope["mode"] == "chat":
        return {"mode": "chat", "project": current, "locked": bool(current)}
    return {"mode": "all", "project": None, "locked": False}


def enforce_fixed_project(session_id: Optional[str], config: Optional[dict]) -> Optional[str]:
    """File a conversation under the agent's fixed project, if it has one."""
    scope = project_scope(config)
    if not session_id or scope["mode"] != "fixed":
        return None
    if roster.get_session_project(session_id) != scope["project"]:
        roster.set_session_project(session_id, scope["project"])
    return scope["project"]


def scope_prompt(session_id: Optional[str]) -> str:
    """A short instruction for the agent about its project limits."""
    scope = session_scope(session_id)
    if scope["mode"] == "all":
        return ""
    if scope["project"]:
        return (
            f"This conversation is limited to the project '{scope['project']}'. "
            "Only use vault notes and files from this project; do not look into other projects."
        )
    return (
        "This conversation must stay inside a single project, but none is chosen yet. "
        "Ask the user which project it is about, then call set_project before using the vault."
    )


def project_bucket(project: Optional[str]) -> Optional[str]:
    if not project:
        return None
    from tools import vault_tool

    return vault_tool._slugify(project) or None


def allowed_bucket(session_id: Optional[str]) -> tuple[bool, Optional[str]]:
    """``(restricted, bucket)`` for vault tools in this conversation."""
    scope = session_scope(session_id)
    if scope["mode"] == "all":
        return False, None
    return True, project_bucket(scope["project"])
