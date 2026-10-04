"""Theta approvals: unattended workers ask the user via the task, audit log."""

import json

import pytest

from hermes_constants import get_default_hermes_root
from tools import theta_approvals as ta
from tools.approval import check_all_command_guards


@pytest.fixture
def worker_env(monkeypatch):
    monkeypatch.setenv("HERMES_KANBAN_TASK", "t_1")
    monkeypatch.delenv("HERMES_YOLO_MODE", raising=False)
    monkeypatch.delenv("HERMES_INTERACTIVE", raising=False)
    monkeypatch.delenv("HERMES_EXEC_ASK", raising=False)
    monkeypatch.setattr("tools.approval._get_approval_mode", lambda: "manual")


def _audit_lines():
    path = get_default_hermes_root() / "logs" / "audit.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


class TestWorkerApprovals:
    def test_dangerous_command_asks_user_via_task(self, worker_env):
        result = check_all_command_guards("rm -rf build", "local")

        assert result["approved"] is False
        assert ta.APPROVAL_PREFIX in result["message"]
        assert "kanban_block" in result["message"]
        requests = ta.pending_requests("t_1")
        assert requests and requests[0]["command"] == "rm -rf build"

    def test_approval_lets_the_worker_run_it(self, worker_env):
        check_all_command_guards("rm -rf build", "local")
        ta.decide("t_1", approve=True)

        result = check_all_command_guards("rm -rf build", "local")
        assert result["approved"] is True
        assert result.get("user_approved") is True

    def test_approval_is_scoped_to_the_task(self, worker_env, monkeypatch):
        check_all_command_guards("rm -rf build", "local")
        ta.decide("t_1", approve=True)

        monkeypatch.setenv("HERMES_KANBAN_TASK", "t_2")
        assert check_all_command_guards("rm -rf build", "local")["approved"] is False

    def test_denied_stays_blocked(self, worker_env):
        check_all_command_guards("rm -rf build", "local")
        ta.decide("t_1", approve=False)
        assert check_all_command_guards("rm -rf build", "local")["approved"] is False

    def test_hardline_blocked_even_if_approved(self, worker_env):
        with ta._db() as conn:
            ta._ensure_tables(conn)
        ta.request_approval("t_1", "rm -rf /", "x", ["recursive delete"])
        ta.decide("t_1", approve=True)
        assert check_all_command_guards("rm -rf /", "local")["approved"] is False

    def test_safe_command_runs(self, worker_env):
        assert check_all_command_guards("python test_fib.py", "local")["approved"] is True

    def test_every_check_is_audited(self, worker_env):
        check_all_command_guards("python test_fib.py", "local")
        check_all_command_guards("rm -rf build", "local")

        lines = [l for l in _audit_lines() if l["event"] == "command_check"]
        assert [l["approved"] for l in lines[-2:]] == [True, False]
        assert lines[-1]["command"] == "rm -rf build"
        assert lines[-1]["task"] == "t_1"


class TestNonWorkerUnchanged:
    def test_plain_non_interactive_context_still_allows(self, monkeypatch):
        for var in ("HERMES_KANBAN_TASK", "HERMES_INTERACTIVE", "HERMES_EXEC_ASK",
                    "HERMES_GATEWAY_SESSION", "HERMES_CRON_SESSION", "HERMES_YOLO_MODE"):
            monkeypatch.delenv(var, raising=False)
        monkeypatch.setattr("tools.approval._is_gateway_approval_context", lambda: False)
        assert check_all_command_guards("rm -rf build", "local")["approved"] is True


class TestKanbanApproveTool:
    def test_approve_comments_unblocks_and_audits(self, monkeypatch):
        calls = []
        monkeypatch.setattr("tools.kanban_tools._handle_comment",
                            lambda args, **kw: calls.append(("comment", args)) or '{"ok": true}')
        monkeypatch.setattr("tools.kanban_tools._handle_unblock",
                            lambda args, **kw: calls.append(("unblock", args)) or '{"ok": true}')
        ta.request_approval("t_9", "rm -rf build", "recursive delete", ["recursive delete"])

        out = json.loads(ta.kanban_approve_tool("t_9", True, note="only the build folder"))

        assert out["success"] is True and out["decision"] == "approved"
        assert ta.is_approved_for_task("t_9", ["recursive delete"])
        assert calls[0][0] == "comment" and "APPROVED" in calls[0][1]["body"]
        assert "only the build folder" in calls[0][1]["body"]
        assert calls[1] == ("unblock", {"task_id": "t_9"})
        assert _audit_lines()[-1]["event"] == "approval_decision"

    def test_decline_tells_worker_not_to_run_it(self, monkeypatch):
        bodies = []
        monkeypatch.setattr("tools.kanban_tools._handle_comment",
                            lambda args, **kw: bodies.append(args["body"]) or '{"ok": true}')
        monkeypatch.setattr("tools.kanban_tools._handle_unblock", lambda args, **kw: '{"ok": true}')
        ta.request_approval("t_9", "rm -rf build", "recursive delete", ["recursive delete"])

        out = json.loads(ta.kanban_approve_tool("t_9", False))

        assert out["decision"] == "declined"
        assert "DECLINED" in bodies[0] and "Do not run it" in bodies[0]
        assert not ta.is_approved_for_task("t_9", ["recursive delete"])

    def test_no_pending_request_is_an_error(self):
        out = json.loads(ta.kanban_approve_tool("t_none", True))
        assert out.get("success") is not True


class TestInboxPhrasing:
    def test_approval_block_becomes_yes_no_question(self):
        from gateway.session_inbox import format_update

        text = format_update("blocked", "t_1", "Clean build", {
            "reason": "Approval needed: recursive delete. Command: rm -rf build",
        })
        assert "permission" in text and "kanban_approve" in text and "rm -rf build" in text
