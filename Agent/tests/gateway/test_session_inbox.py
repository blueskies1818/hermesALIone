"""Tests for the Theta session inbox (worker updates back to the chat)."""

import asyncio
import json
import sqlite3

import pytest

from gateway import session_inbox as inbox
from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter


def _kanban_db(path):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, session_id TEXT, workspace_path TEXT)")
    conn.execute(
        "CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " task_id TEXT, run_id INTEGER, kind TEXT, payload TEXT, created_at INTEGER)"
    )
    conn.commit()
    return conn


def _event(conn, task_id, kind, payload=None):
    conn.execute(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?, ?, ?, 0)",
        (task_id, kind, json.dumps(payload or {})),
    )
    conn.commit()


class TestFormat:
    def test_completed_includes_summary(self):
        text = inbox.format_update("completed", "t_1", "Build it", {"summary": "All good."})
        assert "done" in text and "All good." in text and "t_1" in text

    def test_blocked_includes_question_and_how_to_answer(self):
        text = inbox.format_update("blocked", "t_1", "Build it", {"reason": "Which port?"})
        assert "Which port?" in text and "kanban_unblock" in text

    def test_failures(self):
        assert "ran out of time" in inbox.format_update("timed_out", "t_1", "x", {})
        assert "Last error: boom" in inbox.format_update("gave_up", "t_1", "x", {"error": "boom"})


class TestPollKanban:
    def test_first_poll_skips_history_then_queues_new_outcomes(self, tmp_path):
        path = tmp_path / "kanban.db"
        conn = _kanban_db(path)
        conn.execute("INSERT INTO tasks (id, title, session_id) VALUES ('t_1', 'Write primes', 'sess-1')")
        conn.execute("INSERT INTO tasks (id, title, session_id) VALUES ('t_2', 'Orphan', NULL)")
        conn.commit()
        _event(conn, "t_1", "completed", {"summary": "old"})

        assert inbox.poll_kanban(path) == []  # history is not replayed
        assert inbox.pending("sess-1") == []

        _event(conn, "t_1", "spawned")
        _event(conn, "t_1", "blocked", {"reason": "Need a name"})
        _event(conn, "t_2", "completed", {"summary": "no session"})
        _event(conn, "t_1", "completed", {"summary": "Printed primes"})

        assert inbox.poll_kanban(path) == ["sess-1"]
        items = inbox.pending("sess-1")
        assert [i.kind for i in items] == ["blocked", "completed"]
        assert "Need a name" in items[0].text
        assert "Printed primes" in items[1].text
        assert inbox.poll_kanban(path) == []  # cursor advanced

    def test_missing_db_is_ignored(self, tmp_path):
        assert inbox.poll_kanban(tmp_path / "nope.db") == []

    def test_mark_delivered(self, tmp_path):
        path = tmp_path / "kanban.db"
        conn = _kanban_db(path)
        conn.execute("INSERT INTO tasks (id, title, session_id) VALUES ('t_1', 'x', 'sess-1')")
        conn.commit()
        inbox.poll_kanban(path)
        _event(conn, "t_1", "completed", {"summary": "ok"})
        inbox.poll_kanban(path)

        assert inbox.sessions_with_pending() == ["sess-1"]
        inbox.mark_delivered([i.id for i in inbox.pending("sess-1")])
        assert inbox.pending("sess-1") == []
        assert inbox.sessions_with_pending() == []


def _queue_item(tmp_path, session_id="sess-1", summary="Printed primes"):
    path = tmp_path / "kanban.db"
    conn = _kanban_db(path)
    conn.execute("INSERT INTO tasks (id, title, session_id) VALUES ('t_1', 'Write primes', ?)", (session_id,))
    conn.commit()
    inbox.poll_kanban(path)
    _event(conn, "t_1", "completed", {"summary": summary})
    inbox.poll_kanban(path)


class _FakeAgent:
    def __init__(self, reply):
        self.reply = reply
        self.session_id = "sess-1"
        self.messages = []

    def run_conversation(self, user_message, conversation_history, task_id):
        self.messages.append(user_message)
        return {"final_response": self.reply}


class TestApiServerDelivery:
    def _adapter(self, monkeypatch, reply="Your primes script is done."):
        adapter = APIServerAdapter(PlatformConfig(enabled=True))
        agents = []

        def fake_create_agent(**kwargs):
            agent = _FakeAgent(reply)
            agents.append(agent)
            if kwargs.get("stream_delta_callback"):
                kwargs["stream_delta_callback"](reply)
            return agent

        monkeypatch.setattr(adapter, "_create_agent", fake_create_agent)
        monkeypatch.setattr(adapter, "_ensure_session_db", lambda: None)
        return adapter, agents

    def test_pending_updates_go_in_front_of_next_user_message(self, tmp_path, monkeypatch):
        _queue_item(tmp_path)
        adapter, agents = self._adapter(monkeypatch)

        async def run():
            return await adapter._run_agent(
                user_message="hello again", conversation_history=[], session_id="sess-1",
            )

        asyncio.run(run())
        sent = agents[0].messages[0]
        assert sent.startswith("[Updates from the work agent]")
        assert "Printed primes" in sent and sent.endswith("[User message]\nhello again")
        assert inbox.pending("sess-1") == []

    def test_listener_gets_proactive_turn(self, tmp_path, monkeypatch):
        _queue_item(tmp_path)
        adapter, agents = self._adapter(monkeypatch)

        async def run():
            queue = asyncio.Queue()
            adapter._session_listeners["sess-1"] = {queue: False}
            await adapter._deliver_inbox("sess-1")
            events = []
            while not queue.empty():
                events.append(queue.get_nowait())
            return events

        events = asyncio.run(run())
        names = [name for name, _ in events]
        assert names[0] == "theta.turn.start"
        assert names[-1] == "theta.turn.end"
        assert "theta.delta" in names
        assert events[-1][1]["text"] == "Your primes script is done."
        assert "Printed primes" in agents[0].messages[0]
        assert inbox.pending("sess-1") == []

    def test_busy_session_keeps_updates_queued(self, tmp_path, monkeypatch):
        _queue_item(tmp_path)
        adapter, agents = self._adapter(monkeypatch)
        adapter._busy_sessions.add("sess-1")

        async def run():
            adapter._session_listeners["sess-1"] = {asyncio.Queue(): False}
            await adapter._deliver_inbox("sess-1")

        asyncio.run(run())
        assert agents == []
        assert len(inbox.pending("sess-1")) == 1

    def test_no_listener_keeps_updates_queued(self, tmp_path, monkeypatch):
        _queue_item(tmp_path)
        adapter, agents = self._adapter(monkeypatch)

        asyncio.run(adapter._deliver_inbox("sess-1"))
        assert agents == []
        assert len(inbox.pending("sess-1")) == 1


class TestDeliverables:
    def test_lists_files_and_inlines_small_text(self, tmp_path):
        (tmp_path / "paragraph.txt").write_text("The Revolution began in 1775.", encoding="utf-8")
        (tmp_path / "image.png").write_bytes(b"\x89PNG")
        (tmp_path / "__pycache__").mkdir()
        (tmp_path / "__pycache__" / "x.pyc").write_bytes(b"0")

        text = inbox.describe_deliverables(str(tmp_path))

        assert "paragraph.txt" in text and "image.png" in text
        assert "x.pyc" not in text
        assert "Content of paragraph.txt:\nThe Revolution began in 1775." in text

    def test_large_text_is_listed_not_inlined(self, tmp_path):
        (tmp_path / "big.txt").write_text("x" * (inbox.MAX_INLINE_CHARS + 1), encoding="utf-8")
        text = inbox.describe_deliverables(str(tmp_path))
        assert "big.txt" in text and "Content of" not in text

    def test_missing_or_empty_workspace(self, tmp_path):
        assert inbox.describe_deliverables(None) == ""
        assert inbox.describe_deliverables(str(tmp_path / "nope")) == ""
        assert inbox.describe_deliverables(str(tmp_path)) == ""

    def test_completed_update_includes_deliverables(self, tmp_path):
        ws = tmp_path / "ws"
        ws.mkdir()
        (ws / "result.md").write_text("# Result\nAll done.", encoding="utf-8")
        path = tmp_path / "kanban.db"
        conn = _kanban_db(path)
        conn.execute(
            "INSERT INTO tasks (id, title, session_id, workspace_path) VALUES ('t_1', 'Write', 's', ?)",
            (str(ws),),
        )
        conn.commit()
        inbox.poll_kanban(path)
        _event(conn, "t_1", "completed", {"summary": "Wrote it."})
        inbox.poll_kanban(path)

        text = inbox.pending("s")[0].text
        assert "Wrote it." in text and "Content of result.md:\n# Result\nAll done." in text


def test_clean_history_hides_update_plumbing():
    msgs = [
        {"role": "user", "content": "build it"},
        {"role": "assistant", "content": "on it"},
        {"role": "user", "content": "[Updates from the work agent]\n- Task done."},
        {"role": "assistant", "content": "It's done."},
        {"role": "user", "content": "[Updates from the work agent]\n- x\n\n[User message]\nthanks!"},
    ]
    out = inbox.clean_history_for_display(msgs)
    assert [m["content"] for m in out] == ["build it", "on it", "It's done.", "thanks!"]
    assert msgs[4]["content"].startswith("[Updates")  # input not mutated
