"""Theta: isolated git worktrees and independent verification for tasks.

Coding tasks given a ``repo`` run in their own git worktree on their own
branch, so the user's checkout is never touched:

    <repo>/.worktrees/<stamp>-<slug>   on branch  theta/<stamp>-<slug>

The dispatcher creates the worktree before the worker starts
(``ensure_worktree``) and ``.worktrees/`` is added to the repo's local
``.git/info/exclude`` so it never shows up in ``git status``.

A worker can name a ``verify_command`` (e.g. ``python -m pytest -q``) when it
completes a task. The command is run again here, in the task's workspace,
and the task only completes if it passes (``verify_completion``).
"""

from __future__ import annotations

import logging
import re
import subprocess
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

WORKTREE_DIR = ".worktrees"
BRANCH_PREFIX = "theta/"
VERIFY_TIMEOUT_SECONDS = 900
_OUTPUT_TAIL = 2000


def _git(args: list[str], cwd: Path, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True,
        timeout=timeout, encoding="utf-8", errors="replace",
    )


def repo_root(path: str) -> Optional[Path]:
    """Top level of the git repo containing ``path`` (None if not a repo)."""
    p = Path(str(path or "")).expanduser()
    if not p.is_absolute() or not p.is_dir():
        return None
    try:
        out = _git(["rev-parse", "--show-toplevel"], p)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0 or not out.stdout.strip():
        return None
    return Path(out.stdout.strip()).resolve()


def plan_worktree(repo: str, title: str) -> tuple[str, str]:
    """``(worktree_path, branch)`` for a new task in ``repo``.

    Raises ValueError if ``repo`` isn't an absolute path inside a git repo.
    """
    root = repo_root(repo)
    if root is None:
        raise ValueError(f"repo must be an absolute path to a git repository: {repo!r}")
    slug = re.sub(r"[^a-z0-9]+", "-", str(title).lower()).strip("-")[:40] or "task"
    name = f"{time.strftime('%Y%m%d-%H%M%S')}-{slug}"
    return str(root / WORKTREE_DIR / name), BRANCH_PREFIX + name


def _exclude_worktrees(root: Path) -> None:
    exclude = root / ".git" / "info" / "exclude"
    if not (root / ".git").is_dir():
        return  # the repo itself is a worktree/submodule; leave it alone
    exclude.parent.mkdir(parents=True, exist_ok=True)
    existing = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
    if f"/{WORKTREE_DIR}/" not in existing.split():
        with open(exclude, "a", encoding="utf-8") as f:
            f.write(("" if existing.endswith("\n") or not existing else "\n") + f"/{WORKTREE_DIR}/\n")


def ensure_worktree(path: Path, branch: Optional[str]) -> Path:
    """Create the task's worktree if it doesn't exist yet."""
    path = Path(path)
    if (path / ".git").exists():
        return path
    if path.parent.name != WORKTREE_DIR:
        raise ValueError(f"worktree path must be <repo>/{WORKTREE_DIR}/<name>: {path}")
    root = repo_root(str(path.parent.parent))
    if root is None:
        raise ValueError(f"no git repository at {path.parent.parent}")
    _exclude_worktrees(root)
    branch = branch or BRANCH_PREFIX + path.name
    exists = _git(["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"], root).returncode == 0
    args = ["worktree", "add", str(path), branch] if exists else ["worktree", "add", "-b", branch, str(path)]
    out = _git(args, root, timeout=120)
    if out.returncode != 0:
        raise ValueError(f"git worktree add failed: {(out.stderr or out.stdout).strip()[:400]}")
    logger.info("theta: created worktree %s on %s", path, branch)
    return path


def remove_worktree_if_clean(path: Path) -> bool:
    """Remove a finished task's worktree (its branch stays) if nothing is uncommitted."""
    path = Path(path)
    if path.parent.name != WORKTREE_DIR or not (path / ".git").exists():
        return False
    status = _git(["status", "--porcelain"], path)
    if status.returncode != 0 or status.stdout.strip():
        return False
    root = path.parent.parent
    return _git(["worktree", "remove", str(path)], root, timeout=120).returncode == 0


def _command_problem(command: str) -> Optional[str]:
    try:
        from tools.approval import detect_dangerous_command, detect_hardline_command
    except Exception:
        return None
    hard, why = detect_hardline_command(command)
    if hard:
        return why or "blocked command"
    dangerous, _key, why = detect_dangerous_command(command)
    if dangerous:
        return why or "dangerous command"
    return None


def run_verification(command: str, workspace: Path, timeout: int = VERIFY_TIMEOUT_SECONDS) -> dict:
    """Run ``command`` in ``workspace``; returns ``{ok, exit_code, seconds, output}``."""
    problem = _command_problem(command)
    if problem:
        return {"ok": False, "exit_code": None, "seconds": 0,
                "output": f"verify_command refused ({problem}); use a plain test/build command."}
    start = time.monotonic()
    try:
        proc = subprocess.run(
            command, shell=True, cwd=str(workspace), capture_output=True, text=True,
            timeout=timeout, encoding="utf-8", errors="replace",
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "exit_code": None, "seconds": timeout,
                "output": f"verify_command timed out after {timeout}s"}
    output = (proc.stdout or "") + (proc.stderr or "")
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "seconds": round(time.monotonic() - start, 1),
        "output": output[-_OUTPUT_TAIL:],
    }


def verify_completion(workspace: Optional[str], metadata: Optional[dict]) -> tuple[Optional[str], Optional[dict]]:
    """Check a completion's ``verify_command``.

    Returns ``(error, metadata)``: ``error`` is a message for the worker when
    the check fails; otherwise ``metadata`` carries the verification record.
    """
    if not isinstance(metadata, dict):
        return None, metadata
    command = str(metadata.get("verify_command") or "").strip()
    if not command:
        return None, metadata
    if not workspace or not Path(workspace).is_dir():
        return None, metadata
    result = run_verification(command, Path(workspace))
    if not result["ok"]:
        return (
            "kanban_complete blocked: verify_command failed "
            f"(exit {result['exit_code']}). Your task is still in-flight. "
            "Fix the problem and call kanban_complete again.\n\n"
            f"$ {command}\n{result['output']}"
        ), metadata
    metadata = dict(metadata)
    metadata["verified"] = {
        "command": command, "exit_code": 0, "seconds": result["seconds"],
        "verified_at": int(time.time()),
    }
    return None, metadata
