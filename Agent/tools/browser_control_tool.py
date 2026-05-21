"""Registration shim for browser_control tool auto-discovery.

The tool registry in tools/registry.py imports every tools/*.py module
that calls registry.register() at module level. This file provides that
single registration point.
"""

from __future__ import annotations

from tools.registry import registry
from tools.browser_control.schema import BROWSER_CONTROL_SCHEMA
from tools.browser_control.tool import (
    check_browser_control_requirements,
    handle_browser_control,
)

registry.register(
    name="browser_control",
    toolset="browser_control",
    schema=BROWSER_CONTROL_SCHEMA,
    handler=lambda args, **kw: handle_browser_control(args, **kw),
    check_fn=check_browser_control_requirements,
    requires_env=[],
    description=(
        "Cross-platform browser automation and app launching. "
        "Launch Chromium/Firefox, navigate, click, type, scroll, "
        "screenshot, and start system applications. "
        "Uses Playwright under the hood. Works on Linux, macOS, and Windows."
    ),
)
