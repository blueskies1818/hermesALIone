"""Tests for web_api_extended.py — memory, soul, tools, kanban, chat, gateway endpoints."""

import asyncio
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from fastapi.testclient import TestClient
from fastapi import FastAPI


# ---------------------------------------------------------------------------
# Test app setup
# ---------------------------------------------------------------------------


@pytest.fixture
def temp_hermes_home():
    """Create a temp HERMES_HOME with minimal structure."""
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        (home / "memories").mkdir(parents=True, exist_ok=True)
        (home / "config.yaml").write_text("{}", encoding="utf-8")
        yield home


@pytest.fixture
def client(temp_hermes_home):
    """Create a FastAPI test client with the extended router mounted.

    Overrides get_hermes_home and _profile_home to point at the temp dir,
    so memory/soul/tools endpoint tests work against isolated files.
    """
    from hermes_cli.web_api_extended import router

    app = FastAPI()

    def _mock_home():
        return temp_hermes_home

    with patch("hermes_cli.web_api_extended.get_hermes_home", _mock_home):
        with patch("hermes_cli.web_api_extended._profile_home") as mock_ph:
            mock_ph.return_value = temp_hermes_home
            app.include_router(router)
            yield TestClient(app)


# =========================================================================
# Memory endpoints
# =========================================================================


class TestMemoryEndpoints:
    def test_get_memory_empty(self, client, temp_hermes_home):
        resp = client.get("/api/memory?profile=default")
        assert resp.status_code == 200
        data = resp.json()
        assert data["memory"]["exists"] is False
        assert data["memory"]["entries"] == []
        assert data["memory"]["charCount"] == 0
        assert data["memory"]["charLimit"] == 2200
        assert data["user"]["exists"] is False

    def test_get_memory_with_content(self, client, temp_hermes_home):
        (temp_hermes_home / "memories" / "MEMORY.md").write_text(
            "First memory\n§\nSecond memory\n§\nThird memory",
            encoding="utf-8",
        )
        resp = client.get("/api/memory?profile=default")
        assert resp.status_code == 200
        data = resp.json()
        assert data["memory"]["exists"] is True
        assert len(data["memory"]["entries"]) == 3
        assert data["memory"]["entries"][0]["content"] == "First memory"
        assert data["memory"]["entries"][1]["index"] == 1

    def test_add_memory_entry(self, client, temp_hermes_home):
        resp = client.post("/api/memory", json={
            "content": "New memory entry", "profile": "default",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        content = (temp_hermes_home / "memories" / "MEMORY.md").read_text()
        assert "New memory entry" in content

    def test_add_memory_exceeds_limit(self, client):
        resp = client.post("/api/memory", json={
            "content": "x" * 2300, "profile": "default",
        })
        assert resp.status_code == 400
        assert "exceed memory limit" in resp.json()["detail"]

    def test_update_memory_entry(self, client, temp_hermes_home):
        (temp_hermes_home / "memories" / "MEMORY.md").write_text(
            "Entry A\n§\nEntry B", encoding="utf-8",
        )
        resp = client.put("/api/memory", json={
            "index": 0, "content": "Updated Entry A", "profile": "default",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        content = (temp_hermes_home / "memories" / "MEMORY.md").read_text()
        assert "Updated Entry A" in content
        assert "Entry B" in content

    def test_update_memory_entry_not_found(self, client):
        resp = client.put("/api/memory", json={
            "index": 99, "content": "test", "profile": "default",
        })
        assert resp.status_code == 404

    def test_remove_memory_entry(self, client, temp_hermes_home):
        (temp_hermes_home / "memories" / "MEMORY.md").write_text(
            "Entry A\n§\nEntry B\n§\nEntry C", encoding="utf-8",
        )
        resp = client.request("DELETE", "/api/memory", json={
            "index": 1, "profile": "default",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        content = (temp_hermes_home / "memories" / "MEMORY.md").read_text()
        assert "Entry B" not in content
        assert "Entry A" in content
        assert "Entry C" in content

    def test_remove_memory_entry_not_found(self, client):
        resp = client.request("DELETE", "/api/memory", json={
            "index": 99, "profile": "default",
        })
        assert resp.status_code == 404

    def test_write_user_profile(self, client, temp_hermes_home):
        resp = client.put("/api/memory/user", json={
            "content": "User profile info", "profile": "default",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        content = (temp_hermes_home / "memories" / "USER.md").read_text()
        assert content == "User profile info"

    def test_write_user_profile_exceeds_limit(self, client):
        resp = client.put("/api/memory/user", json={
            "content": "x" * 2000, "profile": "default",
        })
        assert resp.status_code == 400
        assert "Exceeds limit" in resp.json()["detail"]


# =========================================================================
# Soul endpoints
# =========================================================================


class TestSoulEndpoints:
    def test_get_soul_empty(self, client, temp_hermes_home):
        resp = client.get("/api/soul?profile=default")
        assert resp.status_code == 200
        data = resp.json()
        assert data["exists"] is False
        assert data["content"] == ""

    def test_get_soul_with_content(self, client, temp_hermes_home):
        (temp_hermes_home / "SOUL.md").write_text("Custom persona", encoding="utf-8")
        resp = client.get("/api/soul?profile=default")
        assert resp.status_code == 200
        data = resp.json()
        assert data["content"] == "Custom persona"
        assert data["exists"] is True

    def test_set_soul(self, client, temp_hermes_home):
        resp = client.put("/api/soul", json={
            "content": "New persona", "profile": "default",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        content = (temp_hermes_home / "SOUL.md").read_text()
        assert content == "New persona"

    def test_reset_soul(self, client, temp_hermes_home):
        (temp_hermes_home / "SOUL.md").write_text("Custom", encoding="utf-8")
        resp = client.post("/api/soul/reset?profile=default")
        assert resp.status_code == 200
        data = resp.json()
        assert "content" in data
        assert "Hermes" in data["content"]


# =========================================================================
# Tools endpoints
# =========================================================================


class TestToolsEndpoints:
    def test_set_toolset_enabled(self, client, temp_hermes_home):
        # load_config/save_config must be mocked because they use the real
        # get_hermes_home, not our patched version.
        state = {}
        with patch("hermes_cli.web_api_extended.load_config", return_value=state):
            with patch("hermes_cli.web_api_extended.save_config") as mock_save:
                resp = client.put("/api/tools/toolset", json={
                    "key": "web", "enabled": True, "profile": "default",
                })
                assert resp.status_code == 200
                assert resp.json()["success"] is True
                assert "platform_toolsets" in state
                assert "web" in state["platform_toolsets"]["cli"]
                mock_save.assert_called()

    def test_set_toolset_disabled(self, client, temp_hermes_home):
        state = {"platform_toolsets": {"cli": ["browser", "web"]}}
        with patch("hermes_cli.web_api_extended.load_config", return_value=state):
            with patch("hermes_cli.web_api_extended.save_config"):
                resp = client.put("/api/tools/toolset", json={
                    "key": "browser", "enabled": False, "profile": "default",
                })
                assert resp.status_code == 200
                assert resp.json()["success"] is True
                assert "browser" not in state["platform_toolsets"]["cli"]


# =========================================================================
# Gateway endpoints (mock the source module imports)
# =========================================================================


class TestGatewayEndpoints:
    def test_start_gateway(self, client):
        with patch("hermes_cli.gateway.run_gateway") as mock_start:
            mock_start.return_value = {}  # non-None means success
            resp = client.post("/api/gateway/start?profile=default")
            assert resp.status_code == 200
            assert resp.json()["success"] is True

    def test_start_gateway_error(self, client):
        with patch("hermes_cli.gateway.run_gateway") as mock_start:
            mock_start.side_effect = RuntimeError("Port in use")
            resp = client.post("/api/gateway/start?profile=default")
            assert resp.status_code == 500

    def test_stop_gateway(self, client):
        with patch("hermes_cli.gateway.stop_profile_gateway") as mock_stop:
            mock_stop.return_value = True
            resp = client.post("/api/gateway/stop?profile=default")
            assert resp.status_code == 200
            assert resp.json()["success"] is True


# =========================================================================
# Chat endpoints
# =========================================================================


class TestChatEndpoints:
    def test_chat_send_returns_stream_id(self, client):
        resp = client.post("/api/chat/send", json={
            "message": "Hello", "profile": "default",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "stream_id" in data
        assert len(data["stream_id"]) > 0

    def test_chat_send_with_history(self, client):
        resp = client.post("/api/chat/send", json={
            "message": "Continue",
            "profile": "default",
            "history": [
                {"role": "user", "content": "Previous message"},
                {"role": "agent", "content": "Previous response"},
            ],
        })
        assert resp.status_code == 200
        assert "stream_id" in resp.json()

    def test_chat_send_with_session_id(self, client):
        resp = client.post("/api/chat/send", json={
            "message": "Resume", "session_id": "abc123", "profile": "default",
        })
        assert resp.status_code == 200
        assert "stream_id" in resp.json()

    def test_chat_stream_not_found(self, client):
        resp = client.get("/api/chat/stream/nonexistent")
        assert resp.status_code == 404

    def test_chat_stream_sse_format(self, client):
        from hermes_cli.web_api_extended import _active_streams

        stream_id = "test-stream-sse"
        event = asyncio.Event()
        _active_streams[stream_id] = {
            "chunks": ["Hello"],
            "done": True,
            "error": None,
            "session_id": None,
            "usage": None,
            "tool_progress": [],
            "event": event,
        }

        resp = client.get(f"/api/chat/stream/{stream_id}")
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")


# =========================================================================
# Kanban endpoints
# =========================================================================


class TestKanbanEndpoints:
    @pytest.fixture(autouse=True)
    def _mock_kanban_connect(self):
        """All kanban tests get a mock DB connection so they don't hit SQLite."""
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=None)
        with patch("hermes_cli.web_api_extended._kanban_connect") as mock_kc:
            mock_kc.return_value = mock_conn
            yield

    def test_list_boards(self, client):
        with patch("hermes_cli.kanban_db.list_boards") as mock_lb:
            mock_lb.return_value = [
                {"slug": "default", "name": "Default", "is_current": True,
                 "total": 5, "counts": {}, "archived": False},
            ]
            resp = client.get("/api/kanban/boards?profile=default")
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["data"][0]["slug"] == "default"

    def test_boards_error(self, client):
        with patch("hermes_cli.kanban_db.list_boards") as mock_lb:
            mock_lb.side_effect = RuntimeError("DB locked")
            resp = client.get("/api/kanban/boards?profile=default")
            assert resp.status_code == 500

    def test_current_board(self, client):
        with patch("hermes_cli.kanban_db.get_current_board") as mock_cb:
            mock_cb.return_value = "my-board"
            resp = client.get("/api/kanban/boards/current?profile=default")
            assert resp.status_code == 200
            assert resp.json()["data"] == "my-board"

    def test_create_board(self, client):
        with patch("hermes_cli.kanban_db.create_board") as mock_cb:
            mock_cb.return_value = Path("/tmp/test-board")
            resp = client.post("/api/kanban/boards", json={
                "slug": "new-board", "name": "New Board",
                "switchAfter": False, "profile": "default",
            })
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["data"]["slug"] == "new-board"

    def test_remove_board(self, client):
        with patch("hermes_cli.kanban_db.remove_board") as mock_rm:
            mock_rm.return_value = {"slug": "old-board", "archived": True}
            resp = client.delete("/api/kanban/boards/old-board?profile=default")
            assert resp.status_code == 200
            assert resp.json()["success"] is True

    def test_switch_board(self, client):
        with patch("hermes_cli.kanban_db.set_current_board") as mock_sw:
            resp = client.post("/api/kanban/boards/my-board/switch?profile=default")
            assert resp.status_code == 200
            mock_sw.assert_called_once_with("my-board")

    def test_list_tasks(self, client):
        from hermes_cli.kanban_db import Task
        mock_task = Task(
            id="t1", title="Test task", body=None, assignee=None,
            status="ready", priority=3, tenant=None,
            workspace_kind="scratch", workspace_path=None,
            created_by=None, created_at=1000, started_at=None,
            completed_at=None, claim_lock=None, claim_expires=None,
            result=None, skills=[], max_retries=3,
        )
        with patch("hermes_cli.kanban_db.list_tasks") as mock_lt:
            mock_lt.return_value = [mock_task]
            resp = client.get("/api/kanban/tasks?profile=default&status=ready")
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["data"][0]["id"] == "t1"
            assert data["data"][0]["status"] == "ready"

    def test_get_task(self, client):
        from hermes_cli.kanban_db import Task
        mock_task = Task(
            id="t1", title="Test", body="Body", assignee="agent",
            status="running", priority=5, tenant=None,
            workspace_kind="scratch", workspace_path=None,
            created_by="user", created_at=1000, started_at=1100,
            completed_at=None, claim_lock=None, claim_expires=None,
            result=None, skills=["web"], max_retries=3,
        )
        with patch("hermes_cli.kanban_db.get_task") as mock_gt:
            mock_gt.return_value = mock_task
            with patch("hermes_cli.kanban_db.list_comments", return_value=[]):
                with patch("hermes_cli.kanban_db.list_events", return_value=[]):
                    with patch("hermes_cli.kanban_db.parent_ids", return_value=[]):
                        with patch("hermes_cli.kanban_db.child_ids", return_value=[]):
                            resp = client.get("/api/kanban/tasks/t1?profile=default")
                            assert resp.status_code == 200
                            assert resp.json()["data"]["task"]["id"] == "t1"

    def test_get_task_not_found(self, client):
        with patch("hermes_cli.kanban_db.get_task", return_value=None):
            resp = client.get("/api/kanban/tasks/nonexistent?profile=default")
            assert resp.status_code == 404

    def test_create_task(self, client):
        with patch("hermes_cli.kanban_db.create_task") as mock_ct:
            mock_ct.return_value = "t-new"
            resp = client.post("/api/kanban/tasks", json={
                "title": "New Task", "body": "Description",
                "assignee": "agent", "priority": 4, "profile": "default",
            })
            assert resp.status_code == 200
            assert resp.json()["data"]["id"] == "t-new"

    def test_create_task_empty_title(self, client):
        resp = client.post("/api/kanban/tasks", json={
            "title": "  ", "profile": "default",
        })
        assert resp.status_code == 400

    def test_assign_task(self, client):
        with patch("hermes_cli.kanban_db.assign_task") as mock_at:
            mock_at.return_value = True
            resp = client.post("/api/kanban/tasks/t1/assign", json={
                "taskId": "t1", "assignee": "agent", "profile": "default",
            })
            assert resp.status_code == 200
            assert resp.json()["success"] is True

    def test_complete_task(self, client):
        from hermes_cli.kanban_db import Task
        mock_task = Task(
            id="t1", title="Done", body=None, assignee="agent",
            status="running", priority=3, tenant=None,
            workspace_kind="scratch", workspace_path=None,
            created_by=None, created_at=1000, started_at=1100,
            completed_at=None, claim_lock=None, claim_expires=None,
            result=None, skills=[], max_retries=3,
        )
        with patch("hermes_cli.kanban_db.get_task", return_value=mock_task):
            with patch("hermes_cli.kanban_db._end_run"):
                with patch("hermes_cli.kanban_db._append_event"):
                    resp = client.post("/api/kanban/tasks/t1/complete", json={
                        "taskId": "t1", "result": "All done", "profile": "default",
                    })
                    assert resp.status_code == 200
                    assert resp.json()["success"] is True

    def test_block_task(self, client):
        with patch("hermes_cli.kanban_db._append_event"):
            resp = client.post("/api/kanban/tasks/t1/block", json={
                "taskId": "t1", "reason": "Waiting", "profile": "default",
            })
            assert resp.status_code == 200
            assert resp.json()["success"] is True

    def test_unblock_task(self, client):
        with patch("hermes_cli.kanban_db._append_event"):
            resp = client.post("/api/kanban/tasks/t1/unblock", json={
                "taskId": "t1", "profile": "default",
            })
            assert resp.status_code == 200
            assert resp.json()["success"] is True

    def test_archive_task(self, client):
        resp = client.post("/api/kanban/tasks/t1/archive", json={
            "taskId": "t1", "profile": "default",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_specify_task(self, client):
        resp = client.post("/api/kanban/tasks/t1/specify", json={
            "taskId": "t1", "profile": "default",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_reclaim_task(self, client):
        with patch("hermes_cli.kanban_db.reclaim_task") as mock_rc:
            resp = client.post("/api/kanban/tasks/t1/reclaim", json={
                "taskId": "t1", "reason": "Abandoned", "profile": "default",
            })
            assert resp.status_code == 200
            assert resp.json()["success"] is True

    def test_comment_task(self, client):
        with patch("hermes_cli.kanban_db.add_comment"):
            resp = client.post("/api/kanban/tasks/t1/comment", json={
                "taskId": "t1", "body": "Nice work!", "profile": "default",
            })
            assert resp.status_code == 200
            assert resp.json()["success"] is True

    def test_comment_task_empty(self, client):
        resp = client.post("/api/kanban/tasks/t1/comment", json={
            "taskId": "t1", "body": "  ", "profile": "default",
        })
        assert resp.status_code == 400

    def test_dispatch_dry_run(self, client):
        from hermes_cli.kanban_db import Task
        tasks = [
            Task(id="t1", title="T1", body=None, assignee=None,
                 status="ready", priority=3, tenant=None,
                 workspace_kind="scratch", workspace_path=None,
                 created_by=None, created_at=1000, started_at=None,
                 completed_at=None, claim_lock=None, claim_expires=None,
                 result=None, skills=[], max_retries=3),
            Task(id="t2", title="T2", body=None, assignee=None,
                 status="ready", priority=2, tenant=None,
                 workspace_kind="scratch", workspace_path=None,
                 created_by=None, created_at=1000, started_at=None,
                 completed_at=None, claim_lock=None, claim_expires=None,
                 result=None, skills=[], max_retries=3),
        ]
        with patch("hermes_cli.kanban_db.list_tasks", return_value=tasks):
            resp = client.post("/api/kanban/dispatch?dryRun=true&profile=default")
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["data"]["ready_count"] == 2
            assert data["data"]["dry_run"] is True


# =========================================================================
# Backup / Import endpoints
# =========================================================================


class TestBackupImportEndpoints:
    def test_backup(self, client):
        with patch("hermes_cli.backup.run_backup") as mock_bk:
            mock_bk.return_value = "/tmp/backup.zip"
            resp = client.post("/api/backup?profile=default")
            assert resp.status_code == 200
            assert resp.json()["success"] is True
            assert resp.json()["path"] == "/tmp/backup.zip"

    def test_backup_error(self, client):
        with patch("hermes_cli.backup.run_backup") as mock_bk:
            mock_bk.side_effect = Exception("Disk full")
            resp = client.post("/api/backup?profile=default")
            assert resp.status_code == 500

    def test_import_backup(self, client):
        with patch("hermes_cli.backup.run_import") as mock_im:
            resp = client.post("/api/import", json={
                "archivePath": "/tmp/backup.zip", "profile": "default",
            })
            assert resp.status_code == 200
            assert resp.json()["success"] is True


# =========================================================================
# MCP Servers endpoint
# =========================================================================


class TestMcpServersEndpoint:
    def test_list_mcp_servers(self, client):
        with patch("hermes_cli.mcp_config._get_mcp_servers") as mock_mcp:
            mock_mcp.return_value = {
                "codex": {"command": "codex", "args": ["mcp-server"]},
            }
            resp = client.get("/api/mcp/servers?profile=default")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["servers"]) == 1
            assert data["servers"][0]["name"] == "codex"

    def test_list_mcp_servers_empty(self, client):
        with patch("hermes_cli.mcp_config._get_mcp_servers", return_value={}):
            resp = client.get("/api/mcp/servers?profile=default")
            assert resp.status_code == 200
            assert resp.json()["servers"] == []


# =========================================================================
# Memory providers endpoint
# =========================================================================


class TestMemoryProvidersEndpoint:
    def test_discover_memory_providers(self, client):
        with patch("hermes_cli.plugins_cmd._discover_memory_providers") as mock_disc:
            mock_disc.return_value = [("honcho", "Honcho memory provider")]
            resp = client.get("/api/memory/providers?profile=default")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["providers"]) == 1
            assert data["providers"][0]["name"] == "honcho"

    def test_discover_memory_providers_empty(self, client):
        with patch("hermes_cli.plugins_cmd._discover_memory_providers", return_value=[]):
            resp = client.get("/api/memory/providers?profile=default")
            assert resp.status_code == 200
            assert resp.json()["providers"] == []


# =========================================================================
# Connection config endpoint
# =========================================================================


class TestConnectionConfigEndpoint:
    def test_get_connection_config(self, client, temp_hermes_home):
        resp = client.get("/api/connection")
        assert resp.status_code == 200
        data = resp.json()
        assert "mode" in data
        assert "remoteUrl" in data
        assert "ssh" in data
        assert data["mode"] == "local"
