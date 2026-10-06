"""Theta: the dispatcher holds ready tasks once the daily token budget is used."""

import json
import sqlite3
import time
from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb
from tools import theta_work


@pytest.fixture
def kanban_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    (home / "profiles" / "alice").mkdir(parents=True)  # a real assignee profile
    kb.init_db()
    return home


def _dispatch():
    spawns = []
    with kb.connect() as conn:
        kb.create_task(conn, title="work", assignee="alice")
        kb.dispatch_once(conn, spawn_fn=lambda task, ws: spawns.append(task.id))
    return spawns


def test_no_budget_spawns(kanban_home, monkeypatch):
    monkeypatch.setattr(theta_work, "_work_config", lambda: {})
    assert len(_dispatch()) == 1


def test_budget_reached_holds_tasks(kanban_home, monkeypatch):
    monkeypatch.setattr(theta_work, "_work_config", lambda: {"budget": {"daily_tokens": 1000}})
    monkeypatch.setattr(theta_work, "tokens_used_since", lambda since: 1500)
    assert _dispatch() == []
    with kb.connect() as conn:
        assert [t.status for t in kb.list_tasks(conn)] == ["ready"]


def test_budget_not_reached_spawns(kanban_home, monkeypatch):
    monkeypatch.setattr(theta_work, "_work_config", lambda: {"budget": {"daily_tokens": 1000}})
    monkeypatch.setattr(theta_work, "tokens_used_since", lambda since: 10)
    assert len(_dispatch()) == 1


def test_tokens_used_since_sums_worker_sessions(kanban_home):
    with kb.connect() as conn:
        tid = kb.create_task(conn, title="t", assignee="alice")
        conn.execute(
            "INSERT INTO task_runs (task_id, status, started_at, metadata) VALUES (?, 'done', ?, ?)",
            (tid, int(time.time()), json.dumps({"worker_session_id": "s1"})),
        )
        conn.commit()
    state = kanban_home / "profiles" / "alice" / "state.db"
    with sqlite3.connect(state) as db:
        db.execute(
            "CREATE TABLE sessions (id TEXT, input_tokens INT, output_tokens INT, reasoning_tokens INT)"
        )
        db.execute("INSERT INTO sessions VALUES ('s1', 100, 20, 5)")
        db.execute("INSERT INTO sessions VALUES ('other', 999, 999, 0)")
    assert theta_work.tokens_used_since(time.time() - 60) == 125
    assert theta_work.tokens_used_since(time.time() + 60) == 0
