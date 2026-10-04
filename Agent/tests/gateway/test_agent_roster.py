"""Tests for Theta agent switching: roster, switch tools, API server handoff."""

import asyncio
import json

import pytest
import yaml

from gateway import agent_roster as roster
from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter
from hermes_constants import get_hermes_home
from tools.agent_switch_tool import list_agents_tool, switch_agent_tool


def _make_agent_profile(name, description="", model="test-model"):
    home = roster.agent_home(name)
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(
        yaml.safe_dump({"model": {"default": model, "provider": "custom"}}),
        encoding="utf-8",
    )
    if description:
        (home / "profile.yaml").write_text(
            yaml.safe_dump({"description": description}), encoding="utf-8"
        )
    return home


class TestRoster:
    def test_unknown_session_uses_default_agent(self):
        assert roster.get_session_agent("s1") == "default"
        assert roster.get_session_agent(None) == "default"

    def test_handoff_switches_session_and_is_taken_once(self):
        _make_agent_profile("researcher")
        roster.record_handoff("s1", "researcher", "find papers on X")

        assert roster.get_session_agent("s1") == "researcher"
        handoff = roster.take_pending_handoff("s1")
        assert handoff == {
            "agent": "researcher",
            "previous_agent": "default",
            "note": "find papers on X",
        }
        assert roster.take_pending_handoff("s1") is None
        # The switch itself persists for later turns.
        assert roster.get_session_agent("s1") == "researcher"

    def test_list_agents_includes_profiles_with_descriptions(self):
        _make_agent_profile("researcher", description="Finds and summarises sources")
        agents = {a["name"]: a for a in roster.list_agents()}

        assert "default" in agents
        assert agents["researcher"]["description"] == "Finds and summarises sources"

    def test_agent_scope_points_home_at_profile_and_restores(self):
        home = _make_agent_profile("researcher", model="m-research")
        before = get_hermes_home()

        with roster.agent_scope("researcher") as cfg:
            assert get_hermes_home() == home
            assert cfg["model"]["default"] == "m-research"
        assert get_hermes_home() == before

    def test_agent_without_config_inherits_root_config(self):
        from hermes_constants import get_default_hermes_root

        root_cfg = get_default_hermes_root() / "config.yaml"
        root_cfg.write_text(
            yaml.safe_dump({"model": {"default": "root-model", "provider": "deepseek"}}),
            encoding="utf-8",
        )
        roster.agent_home("blank").mkdir(parents=True)

        with roster.agent_scope("blank") as cfg:
            assert cfg["model"] == {"default": "root-model", "provider": "deepseek"}

    def test_agent_config_overrides_root_config(self):
        from hermes_constants import get_default_hermes_root

        (get_default_hermes_root() / "config.yaml").write_text(
            yaml.safe_dump({"model": {"default": "root-model", "provider": "deepseek"},
                            "agent": {"max_turns": 50}}),
            encoding="utf-8",
        )
        _make_agent_profile("researcher", model="m-research")

        with roster.agent_scope("researcher") as cfg:
            assert cfg["model"]["default"] == "m-research"
            assert cfg["model"]["provider"] == "custom"
            assert cfg["agent"]["max_turns"] == 50

    def test_agent_scope_default_and_missing_agent_are_noops(self):
        before = get_hermes_home()
        with roster.agent_scope("default") as cfg:
            assert cfg is None
            assert get_hermes_home() == before
        with roster.agent_scope("ghost") as cfg:
            assert cfg is None
            assert get_hermes_home() == before


class TestSwitchTools:
    def test_switch_requires_session(self):
        out = json.loads(switch_agent_tool("researcher", "note", session_id=""))
        assert out["success"] is False

    def test_switch_to_unknown_agent_lists_available(self):
        _make_agent_profile("researcher")
        out = json.loads(switch_agent_tool("ghost", "note", session_id="s1"))

        assert out["success"] is False
        assert "researcher" in out["available_agents"]
        assert roster.get_session_agent("s1") == "default"

    def test_switch_to_current_agent_is_rejected(self):
        out = json.loads(switch_agent_tool("default", "note", session_id="s1"))
        assert out["success"] is False

    def test_switch_records_handoff(self):
        _make_agent_profile("researcher")
        out = json.loads(switch_agent_tool("Researcher", "user wants papers", session_id="s1"))

        assert out["success"] is True
        assert out["switched_to"] == "researcher"
        assert roster.take_pending_handoff("s1")["note"] == "user wants papers"

    def test_list_agents_tool(self):
        _make_agent_profile("researcher")
        out = json.loads(list_agents_tool())
        assert out["success"] is True
        assert {a["name"] for a in out["agents"]} >= {"default", "researcher"}


class _FakeSessionDB:
    def __init__(self):
        self.prompts = {}

    def update_system_prompt(self, session_id, prompt):
        self.prompts[session_id] = prompt


class _FakeAgent:
    def __init__(self, label, on_run=None):
        self.label = label
        self.on_run = on_run
        self._session_db = _FakeSessionDB()
        self._cached_system_prompt = None
        self.session_id = "sess-1"
        self.session_prompt_tokens = 10
        self.session_completion_tokens = 5
        self.session_total_tokens = 15
        self.calls = []

    def _build_system_prompt(self, system_message=None):
        return f"system prompt of {self.label} built in {get_hermes_home()}"

    def run_conversation(self, user_message, conversation_history, task_id):
        self.calls.append({
            "message": user_message,
            "history": list(conversation_history or []),
            "task_id": task_id,
            "home": get_hermes_home(),
        })
        if self.on_run:
            self.on_run(task_id)
        return {"final_response": f"reply from {self.label}"}


class TestApiServerHandoff:
    def _adapter_with_fakes(self, monkeypatch, first_on_run=None):
        adapter = APIServerAdapter(PlatformConfig(enabled=True))
        created = []

        def fake_create_agent(**kwargs):
            label = "first" if not created else "second"
            agent = _FakeAgent(label, on_run=first_on_run if not created else None)
            agent.agent_config = kwargs.get("agent_config")
            created.append(agent)
            return agent

        monkeypatch.setattr(adapter, "_create_agent", fake_create_agent)
        return adapter, created

    def test_no_switch_runs_single_agent(self, monkeypatch):
        adapter, created = self._adapter_with_fakes(monkeypatch)
        result, usage = asyncio.run(adapter._run_agent(
            user_message="hi", conversation_history=[], session_id="sess-1",
        ))

        assert len(created) == 1
        assert result["final_response"] == "reply from first"
        assert usage["total_tokens"] == 15

    def test_switch_runs_new_agent_in_same_turn(self, monkeypatch):
        home = _make_agent_profile("researcher", model="m-research")
        switches = []
        deltas = []

        def first_on_run(task_id):
            roster.record_handoff(task_id, "researcher", "user wants papers on X")

        adapter, created = self._adapter_with_fakes(monkeypatch, first_on_run)
        result, usage = asyncio.run(adapter._run_agent(
            user_message="let me talk to the researcher",
            conversation_history=[{"role": "user", "content": "earlier"}],
            session_id="sess-1",
            stream_delta_callback=deltas.append,
            agent_switch_callback=lambda new, prev: switches.append((new, prev)),
        ))

        assert len(created) == 2
        first, second = created
        assert first.agent_config is None
        assert second.agent_config["model"]["default"] == "m-research"
        assert second.calls[0]["home"] == home
        assert "user wants papers on X" in second.calls[0]["message"]
        assert second.calls[0]["history"][-2:] == [
            {"role": "user", "content": "let me talk to the researcher"},
            {"role": "assistant", "content": "reply from first"},
        ]
        assert switches == [("researcher", "default")]
        # The new agent gets its own system prompt (persona/memory), stored
        # on the session so later turns reuse it; the first agent's is kept.
        assert first._cached_system_prompt is None
        assert second._cached_system_prompt == f"system prompt of second built in {home}"
        assert second._session_db.prompts["sess-1"] == second._cached_system_prompt
        assert result["final_response"] == "reply from second"
        assert result["agent"] == "researcher"
        assert usage["total_tokens"] == 30
        # Next turn is routed to the new agent.
        assert roster.get_session_agent("sess-1") == "researcher"
