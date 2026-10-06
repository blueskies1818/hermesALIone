"""Theta: per-agent tools, project scope, fallbacks and the settings API."""

import asyncio
import json

import pytest
import yaml
from fastapi import HTTPException

from gateway import agent_policy
from gateway import agent_roster as roster
from hermes_cli import theta_agents_api as api
from tools.agent_switch_tool import set_project_tool


def _make_agent(name, extra=None):
    home = roster.agent_home(name)
    home.mkdir(parents=True, exist_ok=True)
    config = {"model": {"default": "deepseek-flash", "provider": "deepseek"}}
    config.update(extra or {})
    (home / "config.yaml").write_text(yaml.safe_dump(config), encoding="utf-8")
    return home


def _run(coro):
    return asyncio.run(coro)


class TestToolsets:
    def test_agent_defaults_add_and_remove(self):
        base = agent_policy.default_toolsets({})
        assert "terminal" in base
        config = {"theta": {"tools": {"enabled": ["moa"], "disabled": ["terminal"]}}}
        tools = agent_policy.default_toolsets(config)
        assert "moa" in tools and "terminal" not in tools

    def test_session_overrides_win(self):
        config = {"theta": {"tools": {"disabled": ["terminal"]}}}
        agent_policy.set_session_tool("s1", "terminal", True)
        agent_policy.set_session_tool("s1", "web", False)
        tools = agent_policy.effective_toolsets(config, "s1")
        assert "terminal" in tools and "web" not in tools
        agent_policy.set_session_tool("s1", "terminal", None)
        assert "terminal" not in agent_policy.effective_toolsets(config, "s1")

    def test_catalog_includes_mcp_servers(self):
        catalog = agent_policy.toolset_catalog({"mcp_servers": {"time": {"command": "uvx"}}})
        mcp = [c for c in catalog if c["kind"] == "mcp"]
        assert mcp and mcp[0]["name"] == "time"


class TestProjectScope:
    def test_modes(self):
        assert agent_policy.project_scope({})["mode"] == "all"
        assert agent_policy.project_scope({"theta": {"project_scope": {"mode": "fixed"}}})["mode"] == "all"
        fixed = {"theta": {"project_scope": {"mode": "fixed", "project": "garden app"}}}
        assert agent_policy.project_scope(fixed) == {"mode": "fixed", "project": "garden app"}

    def test_fixed_agent_locks_project_and_vault(self):
        _make_agent("gardener", {"theta": {"project_scope": {"mode": "fixed", "project": "Garden App"}}})
        roster.record_handoff("s2", "gardener")
        agent_policy.enforce_fixed_project("s2", agent_policy.agent_config("gardener"))
        assert roster.get_session_project("s2") == "Garden App"
        assert agent_policy.allowed_bucket("s2") == (True, "garden-app")
        assert "Garden App" in agent_policy.scope_prompt("s2")

        refused = json.loads(set_project_tool("Taxes", "s2"))
        assert refused.get("success") is not True
        assert roster.get_session_project("s2") == "Garden App"

    def test_chat_scope_asks_until_chosen_then_locks(self):
        _make_agent("helper", {"theta": {"project_scope": {"mode": "chat"}}})
        roster.record_handoff("s3", "helper")
        assert agent_policy.allowed_bucket("s3") == (True, None)
        assert "Ask the user" in agent_policy.scope_prompt("s3")
        assert json.loads(set_project_tool("Taxes", "s3"))["success"] is True
        assert json.loads(set_project_tool("Other", "s3")).get("success") is not True

    def test_unrestricted_agent_is_free(self):
        assert agent_policy.allowed_bucket("s4") == (False, None)
        assert json.loads(set_project_tool("Anything", "s4"))["success"] is True

    def test_fallback_chain(self):
        assert agent_policy.fallback_chain({}) is None
        chain = [{"provider": "openrouter", "model": "x"}]
        assert agent_policy.fallback_chain({"fallback_providers": chain}) == chain


class TestSettingsApi:
    def test_round_trip_writes_only_agent_config(self):
        home = _make_agent("worker")
        out = _run(api.put_agent_settings("worker", {
            "model": {"provider": "deepseek", "model": "deepseek-pro"},
            "fallbacks": [{"provider": "openrouter", "model": "a/b"}, {"provider": ""}],
            "tools": {"terminal": False, "moa": True},
            "project_scope": {"mode": "fixed", "project": "Garden App"},
        }))
        assert out["model"] == {"provider": "deepseek", "model": "deepseek-pro", "base_url": ""}
        assert out["fallbacks"] == [{"provider": "openrouter", "model": "a/b"}]
        tools = {t["name"]: t["default"] for t in out["tools"]}
        assert tools["terminal"] is False and tools["moa"] is True
        saved = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
        assert saved["theta"]["tools"] == {"enabled": ["moa"], "disabled": ["terminal"]}

        out = _run(api.put_agent_settings("worker", {"tools": {"terminal": None}}))
        assert {t["name"]: t["default"] for t in out["tools"]}["terminal"] is True

    def test_validation(self):
        _make_agent("worker")
        with pytest.raises(HTTPException):
            _run(api.put_agent_settings("worker", {"project_scope": {"mode": "fixed"}}))
        with pytest.raises(HTTPException):
            _run(api.put_agent_settings("worker", {"model": {"provider": "deepseek"}}))
        with pytest.raises(HTTPException):
            _run(api.get_agent_settings("nobody"))

    def test_session_policy_and_project(self):
        _make_agent("gardener", {"theta": {"project_scope": {"mode": "fixed", "project": "Garden"}}})
        roster.record_handoff("s5", "gardener")
        with pytest.raises(HTTPException) as exc:
            _run(api.put_session_project("s5", {"project": "Taxes"}))
        assert exc.value.status_code == 409

        out = _run(api.put_session_tool("s5", {"toolset": "terminal", "enabled": False}))
        row = next(t for t in out["tools"] if t["name"] == "terminal")
        assert row["override"] is False and row["enabled"] is False
        with pytest.raises(HTTPException):
            _run(api.put_session_tool("s5", {"toolset": "nope", "enabled": True}))

    def test_mcp_crud(self):
        out = _run(api.add_mcp({"name": "time", "command": "uvx", "args": ["mcp-server-time"],
                                "env": {"TOKEN": "secret"}}))
        server = out["servers"][0]
        assert server["name"] == "time" and server["env_keys"] == ["TOKEN"]
        assert "secret" not in json.dumps(out)
        with pytest.raises(HTTPException):
            _run(api.add_mcp({"name": "time", "command": "uvx"}))
        with pytest.raises(HTTPException):
            _run(api.add_mcp({"name": "bad name", "command": "uvx"}))
        with pytest.raises(HTTPException):
            _run(api.add_mcp({"name": "both", "command": "x", "url": "http://y"}))
        out = _run(api.toggle_mcp("time", {"enabled": False}))
        assert out["servers"][0]["enabled"] is False
        out = _run(api.delete_mcp("time"))
        assert out["servers"] == []


class TestDefaultAgent:
    def test_default_agent_setting(self):
        assert roster.default_agent_name() == "default"
        _make_agent("worker")
        assert _run(api.put_default_agent({"agent": "worker"})) == {"agent": "worker"}
        assert roster.default_agent_name() == "worker"
        assert _run(api.put_default_agent({"agent": "default"})) == {"agent": "default"}
        with pytest.raises(HTTPException):
            _run(api.put_default_agent({"agent": "nobody"}))


class TestAgentSkills:
    def test_disable_per_agent(self, monkeypatch):
        fake = [
            {"name": "alpha", "description": "a", "category": "x"},
            {"name": "beta", "description": "b", "category": "y"},
        ]
        monkeypatch.setattr(api, "_all_skills", lambda: fake)
        home = _make_agent("worker")
        out = _run(api.put_agent_skills("worker", {"skills": {"beta": False}}))
        states = {s["name"]: s["enabled"] for s in out["skills"]}
        assert states == {"alpha": True, "beta": False}
        saved = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
        assert saved["skills"]["disabled"] == ["beta"]
        # Other agents are unaffected.
        assert all(s["enabled"] for s in _run(api.get_agent_skills("default"))["skills"])
        with pytest.raises(HTTPException):
            _run(api.put_agent_skills("worker", {"skills": {"nope": True}}))

    def test_install_only_for_some_agents(self, monkeypatch):
        state = {"skills": [{"name": "alpha", "category": "x"}]}
        monkeypatch.setattr(api, "_all_skills", lambda: state["skills"])

        def fake_install(identifier, force=False, skip_confirm=False):
            state["skills"] = state["skills"] + [{"name": "gamma", "category": "x"}]

        import hermes_cli.skills_hub as hub
        monkeypatch.setattr(hub, "do_install", fake_install)
        _make_agent("worker")
        _make_agent("voice")
        out = _run(api.install_skill_for({"identifier": "x/gamma", "agents": ["worker"]}))
        assert out["installed"] == ["gamma"]
        assert {s["name"]: s["enabled"] for s in _run(api.get_agent_skills("worker"))["skills"]}["gamma"]
        assert not {s["name"]: s["enabled"] for s in _run(api.get_agent_skills("voice"))["skills"]}["gamma"]
        assert not {s["name"]: s["enabled"] for s in _run(api.get_agent_skills("default"))["skills"]}["gamma"]
