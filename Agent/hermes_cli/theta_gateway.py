"""Theta: run / stop the gateway (chat API server) as a plain process.

Upstream ``hermes gateway restart`` restarts a system service (systemd /
launchd / Windows service). Theta runs the gateway as a normal process
(started by start.ps1), so the upstream path stopped it and then waited
on an "install the service?" prompt — leaving chat offline. These helpers
manage the process directly; ``gateway run --replace`` hands over cleanly
from a running gateway.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path


def _port() -> int:
    try:
        return int(os.getenv("API_SERVER_PORT", "8642"))
    except ValueError:
        return 8642


def is_running(timeout: float = 0.5) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex(("127.0.0.1", _port())) == 0


def _log_file() -> Path:
    from hermes_constants import get_default_hermes_root

    path = get_default_hermes_root() / "logs" / "gateway.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def start(replace: bool = False, wait_seconds: float = 30.0) -> bool:
    """Launch ``gateway run`` detached; True once it is listening."""
    if is_running() and not replace:
        return True
    env = {**os.environ, "API_SERVER_ENABLED": "true", "HERMES_NONINTERACTIVE": "1"}
    cmd = [sys.executable, "-m", "hermes_cli.main", "gateway", "run"]
    if replace:
        cmd.append("--replace")
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = (
            subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            | subprocess.CREATE_NO_WINDOW
        )
    else:
        kwargs["start_new_session"] = True
    log = open(_log_file(), "ab", buffering=0)
    subprocess.Popen(cmd, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                     cwd=str(Path(__file__).resolve().parents[1]), **kwargs)

    deadline = time.time() + wait_seconds
    # With --replace the old gateway may still be listening for a moment.
    if replace:
        time.sleep(2.0)
    while time.time() < deadline:
        if is_running():
            return True
        time.sleep(0.5)
    return False


def restart() -> bool:
    return start(replace=True)


def stop(wait_seconds: float = 15.0) -> bool:
    """Stop the gateway listening on our port (only hermes processes)."""
    import psutil

    stopped = False
    for conn in psutil.net_connections(kind="tcp"):
        if conn.status != psutil.CONN_LISTEN or not conn.laddr or conn.laddr.port != _port():
            continue
        try:
            proc = psutil.Process(conn.pid)
            if "hermes_cli.main" not in " ".join(proc.cmdline()):
                continue
            targets = [proc]
            parent = proc.parent()
            if parent and "hermes_cli.main" in " ".join(parent.cmdline()):
                targets.append(parent)  # venv launcher
            for p in targets:
                p.terminate()
            stopped = True
        except (psutil.Error, OSError):
            continue
    deadline = time.time() + wait_seconds
    while stopped and time.time() < deadline and is_running():
        time.sleep(0.3)
    return not is_running()
