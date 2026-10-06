"""Theta: agent settings, per-conversation policy and MCP servers for the app.

- ``GET/PUT /api/agents/{name}/settings``  model, fallbacks, default tools,
  project scope of one agent (profile)
- ``GET /api/sessions/{id}/policy``         what a conversation may use
- ``PUT /api/sessions/{id}/tools``          turn a toolset on/off for it
- ``PUT /api/sessions/{id}/project``        choose its project
- ``GET /api/projects``                     known projects
- ``POST/PUT/DELETE /api/mcp/servers``      manage MCP servers
"""

from __future__ import annotations

import re
from contextlib import contextmanager
from typing import Any, Iterator, Optional

from fastapi import APIRouter, HTTPException

from gateway import agent_policy
from gateway import agent_roster as roster

router = APIRouter()

_MCP_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


# ---------------------------------------------------------------------------
# Agent config editing (only the agent's own config.yaml is written)
# ---------------------------------------------------------------------------

def _agent_name(name: str) -> str:
    try:
        agent = roster.normalize_agent_name(name)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid agent name")
    if agent != roster.DEFAULT_AGENT and not roster.agent_exists(agent):
        raise HTTPException(status_code=404, detail=f"Agent '{agent}' not found")
    return agent


@contextmanager
def _agent_config_for_edit(agent: str) -> Iterator[dict]:
    if agent == roster.DEFAULT_AGENT:
        from hermes_cli.config import load_config, save_config

        config = load_config()
        yield config
        save_config(config)
        return
    from utils import atomic_yaml_write

    path = roster.agent_home(agent) / "config.yaml"
    config = roster._read_config(roster.agent_home(agent))
    yield config
    atomic_yaml_write(path, config)


def _theta_section(config: dict, key: str) -> dict:
    theta = config.setdefault("theta", {})
    if not isinstance(theta, dict):
        theta = config["theta"] = {}
    section = theta.setdefault(key, {})
    if not isinstance(section, dict):
        section = theta[key] = {}
    return section


def _clean_fallbacks(value: Any) -> list[dict]:
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail="fallbacks must be a list")
    out = []
    for item in value:
        if not isinstance(item, dict):
            continue
        provider = str(item.get("provider") or "").strip()
        model = str(item.get("model") or "").strip()
        if provider and model:
            entry = {"provider": provider, "model": model}
            base_url = str(item.get("base_url") or "").strip()
            if base_url:
                entry["base_url"] = base_url
            out.append(entry)
    return out


def _tool_rows(config: dict, overrides: Optional[dict] = None) -> list[dict]:
    defaults = agent_policy.default_toolsets(config)
    rows = []
    for item in agent_policy.toolset_catalog(config):
        default_on = item["name"] in defaults
        row = {**item, "default": default_on}
        if overrides is not None:
            override = overrides.get(item["name"])
            row["override"] = override
            row["enabled"] = default_on if override is None else override
        rows.append(row)
    return rows


def agent_settings(agent: str) -> dict:
    config = agent_policy.agent_config(agent)
    model = config.get("model") if isinstance(config.get("model"), dict) else {}
    fallbacks = config.get("fallback_providers")
    return {
        "name": agent,
        "model": {
            "provider": str(model.get("provider") or "auto"),
            "model": str(model.get("default") or model.get("model") or ""),
            "base_url": str(model.get("base_url") or ""),
        },
        "fallbacks": fallbacks if isinstance(fallbacks, list) else [],
        "tools": _tool_rows(config),
        "project_scope": agent_policy.project_scope(config),
    }


@router.get("/api/agents/{name}/settings")
async def get_agent_settings(name: str):
    return agent_settings(_agent_name(name))


@router.put("/api/agents/{name}/settings")
async def put_agent_settings(name: str, body: dict):
    agent = _agent_name(name)
    with _agent_config_for_edit(agent) as config:
        if "model" in body:
            m = body.get("model") or {}
            provider = str(m.get("provider") or "").strip()
            model = str(m.get("model") or "").strip()
            if not provider or not model:
                raise HTTPException(status_code=400, detail="provider and model are required")
            section = config.get("model") if isinstance(config.get("model"), dict) else {}
            section["provider"] = provider
            section["default"] = model
            # Named providers use their own endpoint; only custom ones keep a URL.
            section["base_url"] = str(m.get("base_url") or "").strip() if provider == "custom" else ""
            section.pop("context_length", None)
            config["model"] = section
        if "fallbacks" in body:
            config["fallback_providers"] = _clean_fallbacks(body.get("fallbacks"))
        if "tools" in body:
            changes = body.get("tools") or {}
            if not isinstance(changes, dict):
                raise HTTPException(status_code=400, detail="tools must be {toolset: true|false|null}")
            section = _theta_section(config, "tools")
            enabled = set(agent_policy._names(section.get("enabled")))
            disabled = set(agent_policy._names(section.get("disabled")))
            for toolset, state in changes.items():
                enabled.discard(toolset)
                disabled.discard(toolset)
                if state is True:
                    enabled.add(toolset)
                elif state is False:
                    disabled.add(toolset)
            section["enabled"] = sorted(enabled)
            section["disabled"] = sorted(disabled)
        if "project_scope" in body:
            scope = body.get("project_scope") or {}
            mode = str(scope.get("mode") or "all").strip().lower()
            if mode not in agent_policy.SCOPE_MODES:
                raise HTTPException(status_code=400, detail="mode must be all, fixed or chat")
            project = " ".join(str(scope.get("project") or "").split())[:80]
            if mode == "fixed" and not project:
                raise HTTPException(status_code=400, detail="A fixed scope needs a project")
            section = _theta_section(config, "project_scope")
            section["mode"] = mode
            section["project"] = project if mode == "fixed" else ""
    return agent_settings(agent)


# ---------------------------------------------------------------------------
# Per-conversation policy
# ---------------------------------------------------------------------------

def session_policy(session_id: str) -> dict:
    agent = roster.get_session_agent(session_id)
    config = agent_policy.agent_config(agent)
    return {
        "session_id": session_id,
        "agent": agent,
        "project": roster.get_session_project(session_id),
        "scope": agent_policy.session_scope(session_id),
        "tools": _tool_rows(config, agent_policy.session_tool_overrides(session_id)),
    }


@router.get("/api/sessions/{session_id}/policy")
async def get_session_policy(session_id: str):
    return session_policy(session_id)


@router.put("/api/sessions/{session_id}/tools")
async def put_session_tool(session_id: str, body: dict):
    toolset = str(body.get("toolset") or "").strip()
    state = body.get("enabled")
    if not toolset or state not in (True, False, None):
        raise HTTPException(status_code=400, detail="toolset and enabled (true/false/null) required")
    known = {t["name"] for t in agent_policy.toolset_catalog(agent_policy.agent_config(None))}
    if toolset not in known:
        raise HTTPException(status_code=404, detail=f"Unknown toolset '{toolset}'")
    agent_policy.set_session_tool(session_id, toolset, state)
    return session_policy(session_id)


@router.put("/api/sessions/{session_id}/project")
async def put_session_project(session_id: str, body: dict):
    project = " ".join(str(body.get("project") or "").split())[:80]
    if not project:
        raise HTTPException(status_code=400, detail="project is required")
    scope = agent_policy.session_scope(session_id)
    if scope["mode"] == "fixed" and project.lower() != (scope["project"] or "").lower():
        raise HTTPException(
            status_code=409,
            detail=f"This agent always works in '{scope['project']}' (change it in Profiles).",
        )
    roster.set_session_project(session_id, project)
    return session_policy(session_id)


@router.get("/api/projects")
async def list_projects():
    """Projects from the vault plus any named on conversations."""
    names: dict[str, str] = {}
    try:
        import json

        from tools import vault_tool

        data = json.loads(vault_tool._handle_list_buckets({}))
        for bucket in data.get("buckets") or []:
            name = str(bucket.get("name") or bucket.get("id") or "").strip()
            if name:
                names[name.lower()] = name
    except Exception:
        pass
    try:
        with roster._db() as conn:
            roster._ensure_project_table(conn)
            for (project,) in conn.execute("SELECT DISTINCT project FROM session_projects"):
                if project and project.lower() not in names:
                    names[project.lower()] = project
    except Exception:
        pass
    return {"projects": sorted(names.values(), key=str.lower)}


# ---------------------------------------------------------------------------
# MCP servers (root config; per-agent use is a tool setting)
# ---------------------------------------------------------------------------

def _mcp_entry(body: dict) -> dict:
    url = str(body.get("url") or "").strip()
    command = str(body.get("command") or "").strip()
    if bool(url) == bool(command):
        raise HTTPException(status_code=400, detail="Give either a command (stdio) or a url (http)")
    entry: dict[str, Any] = {}
    if url:
        if not re.match(r"^https?://", url):
            raise HTTPException(status_code=400, detail="url must start with http:// or https://")
        entry["url"] = url
        headers = body.get("headers")
        if isinstance(headers, dict) and headers:
            entry["headers"] = {str(k): str(v) for k, v in headers.items()}
    else:
        entry["command"] = command
        args = body.get("args")
        if isinstance(args, list):
            entry["args"] = [str(a) for a in args]
        env = body.get("env")
        if isinstance(env, dict) and env:
            entry["env"] = {str(k): str(v) for k, v in env.items()}
    entry["enabled"] = bool(body.get("enabled", True))
    return entry


def _mcp_list(config: dict) -> list[dict]:
    servers = config.get("mcp_servers") or {}
    out = []
    for name, cfg in servers.items():
        cfg = cfg if isinstance(cfg, dict) else {}
        out.append({
            "name": str(name),
            "type": "http" if cfg.get("url") else "stdio",
            "command": cfg.get("command") or "",
            "args": cfg.get("args") or [],
            "url": cfg.get("url") or "",
            "enabled": cfg.get("enabled", True) is not False,
            "env_keys": sorted((cfg.get("env") or {}).keys()),
            "header_keys": sorted((cfg.get("headers") or {}).keys()),
        })
    return out


@router.get("/api/theta/mcp/servers")
async def list_mcp():
    from hermes_cli.config import load_config

    return {"servers": _mcp_list(load_config())}


@router.post("/api/theta/mcp/servers")
async def add_mcp(body: dict):
    from hermes_cli.config import load_config, save_config

    name = str(body.get("name") or "").strip()
    if not _MCP_NAME.match(name):
        raise HTTPException(status_code=400, detail="Name: letters, digits, - and _ only")
    entry = _mcp_entry(body)
    config = load_config()
    servers = config.get("mcp_servers")
    if not isinstance(servers, dict):
        servers = config["mcp_servers"] = {}
    if name in servers and not body.get("replace"):
        raise HTTPException(status_code=409, detail=f"An MCP server named '{name}' already exists")
    servers[name] = entry
    save_config(config)
    return {"servers": _mcp_list(config), "restart_required": True}


@router.put("/api/theta/mcp/servers/{name}")
async def toggle_mcp(name: str, body: dict):
    from hermes_cli.config import load_config, save_config

    config = load_config()
    servers = config.get("mcp_servers") or {}
    if name not in servers or not isinstance(servers[name], dict):
        raise HTTPException(status_code=404, detail="MCP server not found")
    servers[name]["enabled"] = bool(body.get("enabled", True))
    save_config(config)
    return {"servers": _mcp_list(config), "restart_required": True}


@router.delete("/api/theta/mcp/servers/{name}")
async def delete_mcp(name: str):
    from hermes_cli.config import load_config, save_config

    config = load_config()
    servers = config.get("mcp_servers") or {}
    if name not in servers:
        raise HTTPException(status_code=404, detail="MCP server not found")
    del servers[name]
    if not servers:
        config.pop("mcp_servers", None)
    save_config(config)
    return {"servers": _mcp_list(config), "restart_required": True}
