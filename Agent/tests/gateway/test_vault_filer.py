"""Tests for the Theta vault filer (projects, task notes, conversation notes)."""

import json
import sqlite3
import time

import pytest

from gateway import agent_roster as roster
from gateway import vault_filer as vf
from hermes_constants import get_default_hermes_root


def _kanban(path):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT,"
        " status TEXT, tenant TEXT, session_id TEXT, workspace_path TEXT,"
        " created_at INTEGER, completed_at INTEGER)"
    )
    conn.execute(
        "CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,"
        " run_id INTEGER, kind TEXT, payload TEXT, created_at INTEGER)"
    )
    conn.commit()
    return conn


def _add_task(conn, task_id, title, tenant=None, session_id=None, workspace=None, status="done"):
    conn.execute(
        "INSERT INTO tasks VALUES (?, ?, 'Do the thing.', 'worker', ?, ?, ?, ?, ?, ?)",
        (task_id, title, status, tenant, session_id, workspace, int(time.time()) - 60, int(time.time())),
    )
    conn.commit()


def _event(conn, task_id, kind, payload):
    conn.execute(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?, ?, ?, 0)",
        (task_id, kind, json.dumps(payload)),
    )
    conn.commit()


def _state_db(path, session_id, messages, ts):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT)")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT,"
        " role TEXT, content TEXT, timestamp REAL)"
    )
    conn.execute("INSERT OR IGNORE INTO sessions VALUES (?, 'api_server')", (session_id,))
    for i, (role, content) in enumerate(messages):
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            (session_id, role, content, ts + i),
        )
    conn.commit()
    conn.close()


@pytest.fixture(autouse=True)
def fixed_summary(monkeypatch):
    monkeypatch.setattr(vf, "summarize", lambda transcript: {
        "title": "Planning the garden beds",
        "summary": "User asked for a planting plan. The worker wrote it.",
        "decisions": ["Use raised beds"],
        "open_items": ["Buy soil"],
    })


def test_project_bucket_is_created_in_shared_vault():
    path = vf.project_dir("Garden App")
    assert path == get_default_hermes_root() / "vault" / "garden-app"
    assert json.loads((path / "bucket.json").read_text())["name"] == "Garden App"
    assert (path / "conversations").is_dir() and (path / "tasks").is_dir()


class TestTaskNotes:
    def test_first_pass_does_not_backfill(self, tmp_path):
        conn = _kanban(tmp_path / "kanban.db")
        _add_task(conn, "t_old", "Old task")
        _event(conn, "t_old", "completed", {"summary": "old"})
        assert vf.file_task_events(tmp_path / "kanban.db") == set()

    def test_completed_task_is_filed_under_its_project(self, tmp_path):
        ws = tmp_path / "ws"
        ws.mkdir()
        (ws / "plan.md").write_text("# plan", encoding="utf-8")
        conn = _kanban(tmp_path / "kanban.db")
        vf.file_task_events(tmp_path / "kanban.db")
        _add_task(conn, "t_1", "Write planting plan", tenant="Garden App", session_id="s1", workspace=str(ws))
        _event(conn, "t_1", "completed", {"summary": "Wrote plan.md with three beds."})

        touched = vf.file_task_events(tmp_path / "kanban.db")

        bucket = get_default_hermes_root() / "vault" / "garden-app"
        assert touched == {bucket}
        note = next((bucket / "tasks").glob("*-t_1.md"))
        text = note.read_text(encoding="utf-8")
        assert "Wrote plan.md with three beds." in text and "`plan.md`" in text
        assert vf.read_frontmatter(note)["status"] == "done"

    def test_task_without_project_goes_to_general_and_blocked_is_recorded(self, tmp_path):
        conn = _kanban(tmp_path / "kanban.db")
        vf.file_task_events(tmp_path / "kanban.db")
        _add_task(conn, "t_2", "Ask about name", status="blocked")
        _event(conn, "t_2", "blocked", {"reason": "Need the pet's name"})

        vf.file_task_events(tmp_path / "kanban.db")

        note = next((get_default_hermes_root() / "vault" / "general" / "tasks").glob("*-t_2.md"))
        assert "Need the pet's name" in note.read_text(encoding="utf-8")


class TestConversationNotes:
    def test_conversation_filed_with_summary_and_tasks(self, tmp_path):
        conn = _kanban(tmp_path / "kanban.db")
        _add_task(conn, "t_1", "Write planting plan", tenant="Garden App", session_id="sess-abcdefgh")
        roster.set_session_project("sess-abcdefgh", "Garden App")
        _state_db(tmp_path / "state.db", "sess-abcdefgh",
                  [("user", "Plan my garden"), ("assistant", "On it.")], time.time() - 3600)

        note = vf.file_conversation("sess-abcdefgh", tmp_path / "state.db", tmp_path / "kanban.db")

        assert note.parent == get_default_hermes_root() / "vault" / "garden-app" / "conversations"
        text = note.read_text(encoding="utf-8")
        assert "Planning the garden beds" in text and "Use raised beds" in text and "Buy soil" in text
        assert "Write planting plan" in text

    def test_refile_keeps_path_and_project_change_moves_note(self, tmp_path):
        _kanban(tmp_path / "kanban.db")
        _state_db(tmp_path / "state.db", "sess-12345678", [("user", "hi")], time.time() - 3600)
        first = vf.file_conversation("sess-12345678", tmp_path / "state.db", tmp_path / "kanban.db")
        assert first.parent.parent.name == "general"
        assert vf.file_conversation("sess-12345678", tmp_path / "state.db", tmp_path / "kanban.db") == first

        roster.set_session_project("sess-12345678", "Tax 2026")
        moved = vf.file_conversation("sess-12345678", tmp_path / "state.db", tmp_path / "kanban.db")
        assert moved.parent.parent.name == "tax-2026" and not first.exists()

    def test_idle_sessions_selection(self, tmp_path):
        now = time.time()
        _state_db(tmp_path / "state.db", "idle", [("user", "a")], now - 3600)
        _state_db(tmp_path / "state.db", "active", [("user", "b")], now - 10)
        _state_db(tmp_path / "state.db", "ancient", [("user", "c")], now - 999999)
        _kanban(tmp_path / "kanban.db")

        due = vf.idle_sessions(tmp_path / "state.db", idle_minutes=10, since=now - 86400)
        assert due == ["idle"]
        vf.file_conversation("idle", tmp_path / "state.db", tmp_path / "kanban.db")
        assert vf.idle_sessions(tmp_path / "state.db", 10, now - 86400) == []


def test_readme_lists_tasks_conversations_and_attention(tmp_path):
    conn = _kanban(tmp_path / "kanban.db")
    vf.file_task_events(tmp_path / "kanban.db")
    _add_task(conn, "t_1", "Write planting plan", tenant="Garden App")
    _event(conn, "t_1", "completed", {"summary": "done"})
    _add_task(conn, "t_2", "Order seeds", tenant="Garden App", status="blocked")
    _event(conn, "t_2", "blocked", {"reason": "Which supplier?"})
    roster.set_session_project("sess-1", "Garden App")
    _state_db(tmp_path / "state.db", "sess-1", [("user", "Plan my garden")], time.time() - 3600)

    result = vf.run_once(tmp_path / "kanban.db", tmp_path / "state.db", idle_minutes=10)
    # First run only sets the conversation start point; file the chat explicitly.
    vf.file_conversation("sess-1", tmp_path / "state.db", tmp_path / "kanban.db")
    readme = vf.build_readme(get_default_hermes_root() / "vault" / "garden-app")

    text = readme.read_text(encoding="utf-8")
    assert result["projects"] == ["garden-app"]
    assert "# Garden App" in text
    assert "## Needs attention" in text and "Order seeds (blocked)" in text
    assert "Write planting plan (done)" in text
    assert "Planning-the-garden-beds".lower()[:8] in text.lower()


class TestProjectTools:
    def test_set_project_tool(self):
        from tools.agent_switch_tool import set_project_tool

        out = json.loads(set_project_tool("  Garden   App ", session_id="s1"))
        assert out == {"success": True, "project": "Garden App"}
        assert roster.get_session_project("s1") == "Garden App"
        assert json.loads(set_project_tool("x", session_id=""))["success"] is False

    def test_kanban_task_inherits_session_project(self, monkeypatch):
        from tools import kanban_tools

        monkeypatch.delenv("HERMES_KANBAN_TASK", raising=False)
        monkeypatch.delenv("HERMES_TENANT", raising=False)
        roster.set_session_project("sess-9", "Garden App")
        out = json.loads(kanban_tools._handle_create(
            {"title": "Plant tomatoes", "assignee": "worker"}, task_id="sess-9",
        ))
        assert out.get("ok") or out.get("task_id"), out
        from hermes_cli import kanban_db

        conn = sqlite3.connect(kanban_db.kanban_db_path())
        row = conn.execute("SELECT tenant, session_id FROM tasks WHERE title = 'Plant tomatoes'").fetchone()
        assert row == ("Garden App", "sess-9")
