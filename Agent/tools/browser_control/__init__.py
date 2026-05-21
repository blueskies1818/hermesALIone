"""Cross-platform browser automation toolset.

Provides browser_control — a unified tool for launching and controlling
real web browsers (Chromium/Firefox/WebKit) via Playwright, plus launching
system applications. Works on Linux, macOS, and Windows.
"""

from .tool import (
    check_browser_control_requirements,
    handle_browser_control,
    reset_backend_for_tests,
    set_approval_callback,
)

__all__ = [
    "handle_browser_control",
    "check_browser_control_requirements",
    "set_approval_callback",
    "reset_backend_for_tests",
]
