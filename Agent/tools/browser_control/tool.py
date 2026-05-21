"""Tool dispatch and safety for browser_control.

Single entry-point ``handle_browser_control`` that dispatches by action
to the active backend. Includes safety guards for browser actions.
"""

from __future__ import annotations

import logging
from typing import Any

from .backend import BrowserControlBackend
from .playwright_backend import PlaywrightBackend

logger = logging.getLogger(__name__)

_backend: BrowserControlBackend | None = None
_approval_callback: Any = None  # set by CLI / TUI at startup


def _get_backend() -> BrowserControlBackend:
    global _backend
    if _backend is None:
        backend_env = None  # env override for future backends
        if backend_env == "noop":
            _backend = _NoopBackend()
        else:
            _backend = PlaywrightBackend()
        _backend.start()
    return _backend


def set_approval_callback(cb: Any) -> None:
    """Register a 3-arg callback (action, args, summary) -> verdict string.

    Verdict: 'approve_once' | 'approve_session' | 'always_approve' | 'deny'.
    Set this before the agent begins a conversation.
    """
    global _approval_callback
    _approval_callback = cb


def reset_backend_for_tests(backend: BrowserControlBackend | None = None) -> None:
    global _backend
    if _backend is not None:
        _backend.stop()
    _backend = backend


def check_browser_control_requirements() -> bool:
    """Check whether Playwright is installed. Always True on all platforms
    because Playwright is pip-installable everywhere."""
    try:
        import playwright  # noqa: F401
        return True
    except ImportError:
        return False


# ── action dispatch ────────────────────────────────────────────────────

def handle_browser_control(args: dict, **kwargs: Any) -> str | dict:
    """Main entry point. Returns a JSON string or multimodal dict."""
    action = args.get("action")

    if not action:
        return _error("Missing required parameter: 'action'")

    valid_actions = {
        "launch", "close", "navigate", "screenshot",
        "click", "type", "scroll", "launch_app",
    }
    if action not in valid_actions:
        return _error(f"Unknown action: {action!r}")

    backend = _get_backend()

    # Actions that don't need approval: read-only, no state change
    safe_actions = {"screenshot"}

    if action not in safe_actions:
        summary = _action_summary(action, args)
        verdict = _request_approval(action, args, summary)
        if verdict == "deny":
            return _error(f"User denied the {action} action.")

    try:
        if action == "launch":
            result = backend.launch(
                browser=args.get("browser", "chromium"),
                url=args.get("url", ""),
                headless=args.get("headless", True),
                width=args.get("width", 1280),
                height=args.get("height", 720),
            )
        elif action == "close":
            result = backend.close()
        elif action == "navigate":
            url = args.get("url", "")
            if not url:
                return _error("Missing required parameter: 'url'")
            result = backend.navigate(url)
        elif action == "screenshot":
            result = backend.screenshot()
        elif action == "click":
            selector = args.get("selector", "")
            if not selector:
                return _error("Missing required parameter: 'selector'")
            result = backend.click(selector)
        elif action == "type":
            selector = args.get("selector", "")
            text = args.get("text", "")
            if not selector:
                return _error("Missing required parameter: 'selector'")
            result = backend.type_text(selector, text)
        elif action == "scroll":
            result = backend.scroll(
                direction=args.get("direction", "down"),
                amount=args.get("amount", 300),
            )
        elif action == "launch_app":
            app = args.get("app", "")
            if not app:
                return _error("Missing required parameter: 'app'")
            app_result = backend.launch_app(app, args.get("app_args"))
            return _launch_app_response(app_result)
        else:
            return _error(f"Unhandled action: {action!r}")
    except Exception as exc:
        logger.exception("browser_control action %s failed", action)
        return _error(str(exc))

    return _action_response(result)


# ── response helpers ───────────────────────────────────────────────────

def _action_response(result) -> str | dict:
    """Build a response from an ActionResult. Multimodal when screenshot present."""
    if not result.ok:
        return _error(result.message)

    if result.screenshot and result.screenshot.png_b64:
        return {
            "_multimodal": True,
            "content": [
                {
                    "type": "text",
                    "text": _format_text_output(result),
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{result.screenshot.png_b64}",
                        "detail": "auto",
                    },
                },
            ],
            "text_summary": result.message,
        }

    return _ok(_format_text_output(result))


def _format_text_output(result) -> str:
    parts = [result.message]
    if result.instance:
        parts.append(f"Current URL: {result.instance.url}")
    if result.screenshot:
        s = result.screenshot
        parts.append(f"Page: {s.page_url} — {s.page_title}")
        parts.append(f"Viewport: {s.width}x{s.height}")
        mjpeg_port = _get_backend().get_mjpeg_port()
        if mjpeg_port:
            parts.append(f"Live view: http://127.0.0.1:{mjpeg_port}/stream")
    return "\n".join(parts)


def _launch_app_response(result) -> str:
    if result.ok:
        msg = f"Launched {result.app}"
        if result.pid:
            msg += f" (pid={result.pid})"
        return _ok(msg)
    return _error(result.message)


def _ok(message: str) -> str:
    import json
    return json.dumps({"ok": True, "message": message})


def _error(message: str) -> str:
    import json
    return json.dumps({"ok": False, "error": message})


def _action_summary(action: str, args: dict) -> str:
    if action == "launch":
        return f"Launch {args.get('browser', 'chromium')} browser (headless={args.get('headless', True)})"
    if action == "close":
        return "Close browser"
    if action == "navigate":
        return f"Navigate to {args.get('url', '?')}"
    if action == "click":
        return f"Click '{args.get('selector', '?')}'"
    if action == "type":
        return f"Type into '{args.get('selector', '?')}'"
    if action == "scroll":
        return f"Scroll {args.get('direction', 'down')} by {args.get('amount', 300)}px"
    if action == "launch_app":
        return f"Launch app: {args.get('app', '?')}"
    return f"browser_control: {action}"


# ── approval gate ──────────────────────────────────────────────────────

def _request_approval(action: str, args: dict, summary: str) -> str:
    """Ask the user for permission. Falls back to session-approve if no
    callback is registered (headless/gateway mode)."""
    if _approval_callback is None:
        return "approve_once"
    try:
        return _approval_callback(action, args, summary)
    except Exception:
        return "approve_once"


# ── noop backend for testing ───────────────────────────────────────────

class _NoopBackend(BrowserControlBackend):
    def is_available(self) -> bool: return True
    def start(self) -> None: pass
    def stop(self) -> None: pass
    def launch(self, **kw) -> Any:
        from .backend import BrowserInstance as BI
        return ActionResult(ok=True, action="launch", message="noop launch", instance=BI(id="t", url="about:blank"))
    def close(self, instance_id=None) -> Any:
        return ActionResult(ok=True, action="close", message="noop close")
    def navigate(self, url, instance_id=None) -> Any:
        return ActionResult(ok=True, action="navigate", message=f"noop navigate to {url}")
    def screenshot(self, instance_id=None) -> Any:
        return ActionResult(ok=True, action="screenshot", message="noop screenshot")
    def click(self, selector, instance_id=None) -> Any:
        return ActionResult(ok=True, action="click", message=f"noop click {selector}")
    def type_text(self, selector, text, instance_id=None) -> Any:
        return ActionResult(ok=True, action="type", message=f"noop type into {selector}")
    def scroll(self, direction="down", amount=300, instance_id=None) -> Any:
        return ActionResult(ok=True, action="scroll", message=f"noop scroll {direction} {amount}")
    def launch_app(self, app, args=None) -> Any:
        return AppLaunchResult(ok=True, app=app, message="noop launch")
    def get_mjpeg_port(self) -> int: return 0
