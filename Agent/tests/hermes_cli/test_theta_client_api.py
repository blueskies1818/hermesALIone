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
