"""Theta: follow-up suggestions after a reply."""

from types import SimpleNamespace
from unittest.mock import patch

from agent import followups


def _resp(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


class TestParseSuggestions:
    def test_json_array(self):
        assert followups.parse_suggestions('["Show an example", "What about pots?"]') == [
            "Show an example",
            "What about pots?",
        ]

    def test_json_inside_prose_and_limits(self):
        text = 'Sure: ["a", "b", "c", "d", "' + "x" * 200 + '"]'
        assert followups.parse_suggestions(text) == ["a", "b", "c"]

    def test_bullet_list_fallback(self):
        assert followups.parse_suggestions("1. First one\n- Second one\n") == ["First one", "Second one"]

    def test_empty_array_means_none(self):
        assert followups.parse_suggestions("[]") == []


class TestGenerate:
    def test_uses_auxiliary_llm(self):
        with patch.object(followups, "call_llm", return_value=_resp('["Tell me more"]')) as llm:
            assert followups.generate_followups("hi", "Hello! Here is a plan.") == ["Tell me more"]
        assert llm.call_args.kwargs["task"] == "follow_up_suggestions"

    def test_failure_returns_empty(self):
        with patch.object(followups, "call_llm", side_effect=RuntimeError("no provider")):
            assert followups.generate_followups("hi", "Hello") == []

    def test_empty_reply_skips_call(self):
        with patch.object(followups, "call_llm") as llm:
            assert followups.generate_followups("hi", "  ") == []
        llm.assert_not_called()
