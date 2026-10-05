"""Theta: provider keys live only in the root .env; profiles inherit them."""

import os

from hermes_cli.env_loader import load_hermes_dotenv
from hermes_cli.profiles import write_env_without_secrets


def test_profile_inherits_root_env_and_can_override(tmp_path, monkeypatch):
    root = tmp_path / "theta"
    profile = root / "profiles" / "worker"
    profile.mkdir(parents=True)
    (root / ".env").write_text("DEEPSEEK_API_KEY=root-key-123456\nTERMINAL_TIMEOUT=60\n", encoding="utf-8")
    (profile / ".env").write_text("TERMINAL_TIMEOUT=90\n", encoding="utf-8")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("TERMINAL_TIMEOUT", raising=False)

    loaded = load_hermes_dotenv(hermes_home=profile)

    assert os.environ["DEEPSEEK_API_KEY"] == "root-key-123456"
    assert os.environ["TERMINAL_TIMEOUT"] == "90"
    assert loaded[0] == root / ".env"


def test_non_profile_home_does_not_read_parent_env(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("THETA_PARENT_ONLY=1\n", encoding="utf-8")
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.delenv("THETA_PARENT_ONLY", raising=False)

    load_hermes_dotenv(hermes_home=home)

    assert "THETA_PARENT_ONLY" not in os.environ


def test_clone_env_drops_secrets(tmp_path):
    src = tmp_path / "src.env"
    src.write_text(
        "# comment\nDEEPSEEK_API_KEY=abcdefgh1234\nAPI_SERVER_KEY=feedfacecafe\n"
        "TERMINAL_TIMEOUT=60\nTERMINAL_SSH_KEY_PATH=/x\n",
        encoding="utf-8",
    )
    dst = tmp_path / "dst.env"

    assert write_env_without_secrets(src, dst) == 2
    text = dst.read_text(encoding="utf-8")
    assert "DEEPSEEK_API_KEY" not in text and "API_SERVER_KEY" not in text
    assert "TERMINAL_TIMEOUT=60" in text and "TERMINAL_SSH_KEY_PATH=/x" in text and "# comment" in text
