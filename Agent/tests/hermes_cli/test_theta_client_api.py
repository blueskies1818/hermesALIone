"""Theta client API: credential masking, attachment uploads."""

import asyncio
import base64

import pytest

from hermes_cli import theta_client_api as api


class TestCredentialMasking:
    def test_mask_keeps_last_four_only(self):
        pool = {"deepseek": [{"id": "1", "access_token": "sk-abcdefghijkl1234", "label": "main"}]}
        masked = api.mask_pool(pool)["deepseek"][0]
        assert masked["access_token"] == api.MASK_PREFIX + "1234"
        assert masked["label"] == "main"
        assert "abcdefgh" not in str(api.mask_pool(pool))

    def test_short_secret_fully_masked(self):
        assert api.mask_secret("abc123") == api.MASK_PREFIX

    def test_masked_value_on_save_keeps_stored_secret(self):
        existing = [{"id": "1", "access_token": "sk-abcdefghijkl1234", "label": "main"}]
        incoming = [{"id": "1", "access_token": api.MASK_PREFIX + "1234", "label": "renamed"}]
        out = api.unmask_entries(incoming, existing)
        assert out == [{"id": "1", "access_token": "sk-abcdefghijkl1234", "label": "renamed"}]

    def test_masked_key_matched_by_suffix_without_id(self):
        existing = [{"access_token": "sk-zzzzzzzzzzzz9876"}]
        out = api.unmask_entries([{"key": api.MASK_PREFIX + "9876", "label": "x"}], existing)
        assert out[0]["key"] == "sk-zzzzzzzzzzzz9876"

    def test_new_plain_key_is_saved_as_given(self):
        out = api.unmask_entries([{"key": "sk-new-key-value-0000"}], [])
        assert out[0]["key"] == "sk-new-key-value-0000"

    def test_unknown_mask_is_dropped_not_saved(self):
        out = api.unmask_entries([{"key": api.MASK_PREFIX + "5555", "label": "x"}], [])
        assert "key" not in out[0]


class TestAttachments:
    def _upload(self, **body):
        return asyncio.run(api.upload_attachment(body))

    def test_upload_lands_in_workspace_with_safe_name(self):
        out = self._upload(session_id="s/../1", filename="../my report?.pdf",
                           data=base64.b64encode(b"%PDF").decode())
        from hermes_constants import get_default_hermes_root

        uploads = get_default_hermes_root() / "workspace" / "uploads"
        path = api.Path(out["path"])
        assert path.read_bytes() == b"%PDF"
        assert uploads in path.parents
        assert ".." not in path.relative_to(uploads).as_posix()

    def test_same_name_gets_unique_path(self):
        data = base64.b64encode(b"x").decode()
        a = self._upload(session_id="s", filename="a.txt", data=data)["path"]
        b = self._upload(session_id="s", filename="a.txt", data=data)["path"]
        assert a != b and b.endswith("a-1.txt")

    def test_rejects_bad_base64(self):
        with pytest.raises(api.HTTPException) as exc:
            self._upload(session_id="s", filename="a", data="not base64!!")
        assert exc.value.status_code == 400

    def test_rejects_oversized(self, monkeypatch):
        monkeypatch.setattr(api, "MAX_ATTACHMENT_BYTES", 3)
        with pytest.raises(api.HTTPException) as exc:
            self._upload(session_id="s", filename="a", data=base64.b64encode(b"abcd").decode())
        assert exc.value.status_code == 413


class TestRewind:
    def test_cut_index_skips_worker_updates(self):
        msgs = [
            {"role": "user", "content": "first"},
            {"role": "assistant", "content": "a1"},
            {"role": "user", "content": "[Updates from the work agent]\n- done"},
            {"role": "assistant", "content": "it's done"},
            {"role": "user", "content": "[Updates from the work agent]\n- x\n\n[User message]\nsecond"},
            {"role": "assistant", "content": "a2"},
        ]
        assert api.rewind_cut_index(msgs, 0) == 0
        assert api.rewind_cut_index(msgs, 1) == 4
        assert api.rewind_cut_index(msgs, 2) is None

    def test_rewind_endpoint_truncates_session(self):
        from hermes_state import SessionDB

        db = SessionDB()
        db.create_session("rw-1", source="api_server")
        for role, text in [("user", "q1"), ("assistant", "a1"), ("user", "q2"), ("assistant", "a2")]:
            db.append_message("rw-1", role, text)
        db.close()

        out = asyncio.run(api.rewind_session("rw-1", {"user_turn": 1}))

        db = SessionDB()
        try:
            assert out["removed"] == 2
            assert [m["content"] for m in db.get_messages("rw-1")] == ["q1", "a1"]
        finally:
            db.close()


def test_deepseek_flash_is_a_thinking_model():
    import importlib.util, pathlib
    spec = importlib.util.spec_from_file_location(
        "ds_plugin", pathlib.Path(__file__).resolve().parents[2] / "plugins/model-providers/deepseek/__init__.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    assert mod._model_supports_thinking("deepseek-flash")
    assert not mod._model_supports_thinking("deepseek-chat")


class TestSharedFiles:
    def _root(self):
        from hermes_constants import get_default_hermes_root

        return get_default_hermes_root()

    def test_only_workspace_and_vault_files_are_served(self, tmp_path):
        ws = self._root() / "workspace" / "tasks"
        ws.mkdir(parents=True)
        (ws / "plan.md").write_text("# Plan", encoding="utf-8")
        outside = tmp_path / "secret.txt"
        outside.write_text("nope", encoding="utf-8")
        (self._root() / ".env").write_text("X_API_KEY=abc", encoding="utf-8")

        info = asyncio.run(api.files_info({"paths": [str(ws / "plan.md"), str(outside),
                                                      str(self._root() / ".env"), str(ws / "missing.md")]}))
        assert [f["name"] for f in info["files"]] == ["plan.md"]
        assert info["files"][0]["mime"] == "text/markdown"

        content = asyncio.run(api.file_content(str(ws / "plan.md")))
        assert base64.b64decode(content["data"]) == b"# Plan"
        with pytest.raises(api.HTTPException):
            asyncio.run(api.file_content(str(outside)))

    def test_path_traversal_out_of_workspace_is_refused(self):
        ws = self._root() / "workspace"
        ws.mkdir(parents=True, exist_ok=True)
        (self._root() / "config.yaml").write_text("model: x", encoding="utf-8")
        assert api.resolve_shared_file(str(ws / ".." / "config.yaml")) is None


class TestConversationManagement:
    def _make(self, sid):
        from hermes_state import SessionDB

        db = SessionDB()
        db.create_session(sid, source="api_server")
        db.append_message(sid, "user", "hello")
        db.close()

    def test_rename_pin_archive(self):
        from gateway import agent_roster

        self._make("cm-1")
        out = asyncio.run(api.update_session("cm-1", {"title": "  Garden   plan ", "pinned": True}))
        assert out["title"] == "Garden plan" and out["pinned"] is True and out["archived"] is False
        out = asyncio.run(api.update_session("cm-1", {"archived": True}))
        assert out["pinned"] is True and out["archived"] is True
        info = agent_roster.session_info_many(["cm-1", "unknown"])
        assert info["cm-1"]["pinned"] and info["cm-1"]["archived"]
        assert info["unknown"] == {"pinned": False, "archived": False, "project": None, "agent": "default"}

    def test_update_validation(self):
        self._make("cm-2")
        with pytest.raises(api.HTTPException):
            asyncio.run(api.update_session("cm-2", {}))
        with pytest.raises(api.HTTPException):
            asyncio.run(api.update_session("cm-2", {"title": "   "}))
        with pytest.raises(api.HTTPException) as exc:
            asyncio.run(api.update_session("missing", {"pinned": True}))
        assert exc.value.status_code == 404

    def test_list_hides_archived_unless_asked(self):
        from hermes_cli import web_server

        self._make("cm-3")
        self._make("cm-4")
        asyncio.run(api.update_session("cm-4", {"archived": True}))
        active = {s["id"] for s in asyncio.run(web_server.get_sessions(limit=50))["sessions"]}
        archived = {s["id"] for s in asyncio.run(web_server.get_sessions(limit=50, archived=True))["sessions"]}
        assert "cm-3" in active and "cm-4" not in active
        assert archived == {"cm-4"}
