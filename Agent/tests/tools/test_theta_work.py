"""Theta: task worktrees and independent verification."""

import subprocess
import sys
from pathlib import Path

import pytest

from tools import theta_work


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "proj"
    root.mkdir()
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "t@example.com")
    _git(root, "config", "user.name", "Test")
    (root / "a.txt").write_text("hello\n", encoding="utf-8")
    _git(root, "add", "-A")
    _git(root, "commit", "-qm", "init")
    return root


def test_plan_requires_a_repo(tmp_path):
    with pytest.raises(ValueError):
        theta_work.plan_worktree(str(tmp_path), "x")
    with pytest.raises(ValueError):
        theta_work.plan_worktree("relative/path", "x")


def test_worktree_lifecycle(repo):
    path, branch = theta_work.plan_worktree(str(repo), "Add Feature X!")
    assert Path(path).parent == (repo / ".worktrees").resolve()
    assert branch.startswith("theta/") and branch.endswith("add-feature-x")

    wt = theta_work.ensure_worktree(Path(path), branch)
    assert (wt / "a.txt").exists()
    # Idempotent, and the user's checkout stays on main and clean.
    assert theta_work.ensure_worktree(Path(path), branch) == wt
    head = subprocess.run(["git", "branch", "--show-current"], cwd=repo, capture_output=True, text=True)
    assert head.stdout.strip() == "main"
    status = subprocess.run(["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True)
    assert status.stdout.strip() == ""

    # Uncommitted work keeps the worktree; once committed it is removed, branch kept.
    (wt / "b.txt").write_text("new\n", encoding="utf-8")
    assert theta_work.remove_worktree_if_clean(wt) is False
    _git(wt, "add", "-A")
    _git(wt, "commit", "-qm", "feature")
    assert theta_work.remove_worktree_if_clean(wt) is True
    assert not wt.exists()
    branches = subprocess.run(["git", "branch", "--list", branch], cwd=repo, capture_output=True, text=True)
    assert branch in branches.stdout


def test_verify_passes_and_records(tmp_path):
    cmd = f'"{sys.executable}" -c "print(1)"'
    err, meta = theta_work.verify_completion(str(tmp_path), {"verify_command": cmd})
    assert err is None and meta["verified"]["exit_code"] == 0


def test_verify_failure_blocks_with_output(tmp_path):
    cmd = f'"{sys.executable}" -c "import sys; print(\'boom\'); sys.exit(3)"'
    err, _ = theta_work.verify_completion(str(tmp_path), {"verify_command": cmd})
    assert err and "exit 3" in err and "boom" in err


def test_verify_refuses_dangerous_commands(tmp_path):
    err, _ = theta_work.verify_completion(str(tmp_path), {"verify_command": "rm -rf /"})
    assert err and "refused" in err


def test_no_verify_command_is_a_no_op(tmp_path):
    assert theta_work.verify_completion(str(tmp_path), {"tests_run": 3}) == (None, {"tests_run": 3})
    assert theta_work.verify_completion(None, {"verify_command": "x"}) == (None, {"verify_command": "x"})
