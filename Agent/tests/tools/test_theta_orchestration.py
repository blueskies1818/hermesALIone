"""Theta orchestration: persistent task workspaces and per-profile tool checks."""

from pathlib import Path

import yaml

from hermes_constants import (
    get_default_hermes_root,
    reset_hermes_home_override,
    set_hermes_home_override,
)


def _write_root_config(data: dict) -> None:
    (get_default_hermes_root() / "config.yaml").write_text(
        yaml.safe_dump(data), encoding="utf-8"
    )


class TestDefaultWorkspace:
    def test_scratch_when_root_not_configured(self):
        from tools.kanban_tools import _default_workspace

        assert _default_workspace("Build thing", None) == ("scratch", None)

    def test_dir_under_configured_root(self, tmp_path):
        from tools.kanban_tools import _default_workspace

        root = tmp_path / "tasks"
        _write_root_config({"kanban": {"default_workspace_root": str(root)}})

        kind, path = _default_workspace("Write and run primes.py!", None)

        assert kind == "dir"
        assert Path(path).parent == root
        assert Path(path).name.endswith("-write-and-run-primes-py")

    def test_explicit_path_keeps_upstream_default(self, tmp_path):
        from tools.kanban_tools import _default_workspace

        _write_root_config({"kanban": {"default_workspace_root": str(tmp_path)}})
        assert _default_workspace("x", "/some/path") == ("scratch", "/some/path")

    def test_relative_root_is_ignored(self):
        from tools.kanban_tools import _default_workspace

        _write_root_config({"kanban": {"default_workspace_root": "relative/tasks"}})
        assert _default_workspace("x", None) == ("scratch", None)

    def test_profile_setting_wins_over_root(self, tmp_path):
        from tools.kanban_tools import _default_workspace

        _write_root_config({"kanban": {"default_workspace_root": str(tmp_path / "root")}})
        profile = tmp_path / "profile"
        profile.mkdir()
        (profile / "config.yaml").write_text(
            yaml.safe_dump({"kanban": {"default_workspace_root": str(tmp_path / "mine")}}),
            encoding="utf-8",
        )
        token = set_hermes_home_override(profile)
        try:
            kind, path = _default_workspace("x", None)
        finally:
            reset_hermes_home_override(token)

        assert kind == "dir"
        assert Path(path).parent == tmp_path / "mine"


class TestCheckFnCachePerProfile:
    def test_cached_result_is_scoped_to_profile_override(self, tmp_path):
        from tools.registry import _check_fn_cached, invalidate_check_fn_cache
        from hermes_constants import get_hermes_home_override

        invalidate_check_fn_cache()
        calls = []

        def check():
            calls.append(get_hermes_home_override())
            return get_hermes_home_override() is not None

        assert _check_fn_cached(check) is False
        token = set_hermes_home_override(tmp_path)
        try:
            assert _check_fn_cached(check) is True
            assert _check_fn_cached(check) is True
        finally:
            reset_hermes_home_override(token)
        assert _check_fn_cached(check) is False

        # One real call per profile; repeats within the TTL hit the cache.
        assert calls == [None, str(tmp_path)]
