#!/usr/bin/env python3
"""
Agent switching tools (Theta).

Lets the user move a conversation between agents ("let me talk to the
researcher"). Agents are Hermes profiles; see ``gateway/agent_roster.py``.

``switch_agent`` records the handoff for the current session. The API server
then runs the target agent in the same turn, seeded with the handoff note,
and keeps routing the session to it until another switch.
"""

import json

from tools.registry import registry


LIST_AGENTS_SCHEMA = {
    "name": "list_agents",
    "description": (
        "List the agents the user can talk to, with a short description of each. "
        "Use this when the user asks who is available or names an agent you don't recognise."
    ),
    "parameters": {"type": "object", "properties": {}, "required": []},
}

SWITCH_AGENT_SCHEMA = {
    "name": "switch_agent",
    "description": (
        "Hand this conversation over to another agent when the user asks to talk to "
        "a different agent (e.g. 'let me talk to the researcher'). Only switch when the "
        "user asks for it. After a successful switch, end your turn with one short "
        "sentence; the other agent continues immediately."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "agent": {
                "type": "string",
                "description": "Name of the agent to switch to (see list_agents).",
            },
            "handoff_note": {
                "type": "string",
                "description": (
                    "What the next agent needs to know: the user's request and the "
                    "relevant context from this conversation, in a few sentences."
                ),
            },
        },
        "required": ["agent", "handoff_note"],
    },
}


def _error(message: str, **extra) -> str:
    return json.dumps({"success": False, "error": message, **extra})


def list_agents_tool() -> str:
    from gateway.agent_roster import list_agents

    return json.dumps({"success": True, "agents": list_agents()})


def switch_agent_tool(agent: str, handoff_note: str, session_id: str) -> str:
    from gateway import agent_roster as roster

    if not session_id:
        return _error("Agent switching is only available inside a conversation session.")
    if not str(agent or "").strip():
        return _error("Specify which agent to switch to.")
    try:
        target = roster.normalize_agent_name(agent)
    except ValueError:
        return _error(f"'{agent}' is not a valid agent name.")
    available = [a["name"] for a in roster.list_agents()]
    if not roster.agent_exists(target):
        return _error(f"No agent named '{target}'.", available_agents=available)
    current = roster.get_session_agent(session_id)
    if target == current:
        return _error(f"You are already '{target}'.", available_agents=available)

    roster.record_handoff(session_id, target, handoff_note or "")
    return json.dumps({
        "success": True,
        "switched_to": target,
        "message": f"Handoff to '{target}' recorded. End your turn with one short sentence; "
                   f"'{target}' will continue the conversation.",
    })


SET_PROJECT_SCHEMA = {
    "name": "set_project",
    "description": (
        "Say which project this conversation is about (e.g. 'garden app', 'tax return 2026'). "
        "Use it when the user names a project or the topic clearly belongs to one. The "
        "conversation, and tasks created from it, are filed under that project in the vault."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "project": {"type": "string", "description": "Short project name."},
        },
        "required": ["project"],
    },
}


def set_project_tool(project: str, session_id: str) -> str:
    from gateway import agent_roster as roster

    if not session_id:
        return _error("Projects can only be set inside a conversation session.")
    if not str(project or "").strip():
        return _error("Give the project a short name.")
    name = roster.set_session_project(session_id, project)
    return json.dumps({"success": True, "project": name})


registry.register(
    name="set_project",
    toolset="agents",
    schema=SET_PROJECT_SCHEMA,
    handler=lambda args, **kw: set_project_tool(
        project=args.get("project", ""), session_id=kw.get("task_id") or "",
    ),
    emoji="📁",
)

registry.register(
    name="list_agents",
    toolset="agents",
    schema=LIST_AGENTS_SCHEMA,
    handler=lambda args, **kw: list_agents_tool(),
    emoji="👥",
)

registry.register(
    name="switch_agent",
    toolset="agents",
    schema=SWITCH_AGENT_SCHEMA,
    handler=lambda args, **kw: switch_agent_tool(
        agent=args.get("agent", ""),
        handoff_note=args.get("handoff_note", ""),
        session_id=kw.get("task_id") or "",
    ),
    emoji="🔀",
)
