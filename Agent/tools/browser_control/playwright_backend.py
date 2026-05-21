"""Playwright-backed browser automation for browser_control.

Cross-platform: Linux (Xvfb for headed mode), macOS, Windows.
Includes an optional MJPEG streaming server for live monitoring.
"""

from __future__ import annotations

import base64
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any

from .backend import (
    AppLaunchResult,
    ActionResult,
    BrowserControlBackend,
    BrowserInstance,
    ScreenshotResult,
)

logger = logging.getLogger(__name__)

_DEFAULT_VIEWPORT = {"width": 1280, "height": 720}
_MJPEG_BOUNDARY = b"--hermes-mjpeg\r\n"


class _MJPEGHandler(BaseHTTPRequestHandler):
    """Serves an MJPEG stream from a shared frame buffer."""

    def log_message(self, *args):
        pass  # silence access logs

    def do_GET(self):
        if self.path != "/stream":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=hermes-mjpeg")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        backend: PlaywrightBackend = self.server.backend  # type: ignore[attr-defined]
        last_frame = b""
        try:
            while backend._mjpeg_running:
                with backend._frame_lock:
                    frame = backend._last_frame
                if frame and frame != last_frame:
                    self.wfile.write(_MJPEG_BOUNDARY)
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode())
                    self.wfile.write(frame)
                    self.wfile.write(b"\r\n")
                    last_frame = frame
                    self.wfile.flush()
                time.sleep(0.066)  # ~15fps
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass


class PlaywrightBackend(BrowserControlBackend):
    """Browser automation using Playwright.

    Launches real Chromium/Firefox/WebKit browsers. Headless by default.
    On Linux, Xvfb is used for headed mode so no physical display is needed.
    An optional MJPEG stream serves live screenshots on a local port.
    """

    def __init__(self) -> None:
        self._playwright = None
        self._browser = None
        self._page = None
        self._context = None
        self._instances: dict[str, BrowserInstance] = {}
        self._active_instance: str | None = None
        self._xvfb_display: int | None = None
        self._xvfb_proc: subprocess.Popen[bytes] | None = None

        # MJPEG streaming
        self._mjpeg_server: HTTPServer | None = None
        self._mjpeg_thread: threading.Thread | None = None
        self._mjpeg_running = False
        self._mjpeg_port = 0
        self._last_frame: bytes = b""
        self._frame_lock = threading.Lock()

        # Default to headless; headed mode uses Xvfb on Linux
        self._headless = True

    # ── backend interface ──────────────────────────────────────────────

    def is_available(self) -> bool:
        try:
            import playwright  # noqa: F401
            return True
        except ImportError:
            return False

    def start(self) -> None:
        """Install Playwright browsers if needed, start Xvfb on Linux for
        headed mode, and bring up the MJPEG stream server."""
        self._ensure_playwright_browsers()
        self._start_mjpeg_server()

    def stop(self) -> None:
        self._stop_mjpeg_server()
        self._close_all()
        self._stop_xvfb()

    def launch(
        self,
        browser: str = "chromium",
        url: str = "",
        headless: bool = True,
        width: int = 1280,
        height: int = 720,
    ) -> ActionResult:
        self._headless = headless
        if self._browser is not None:
            self._close_all()

        # On Linux with headed mode, spin up Xvfb
        if not headless and sys.platform == "linux":
            self._start_xvfb()

        try:
            pw = self._get_playwright()
            browser_type = getattr(pw, browser, pw.chromium)
            launch_opts: dict[str, Any] = {"headless": headless}
            self._browser = browser_type.launch(**launch_opts)
            self._context = self._browser.new_context(
                viewport={"width": width, "height": height}
            )
            self._page = self._context.new_page()

            inst = BrowserInstance(id="default", url=url)
            self._instances["default"] = inst
            self._active_instance = "default"

            if url:
                self._page.goto(url, wait_until="domcontentloaded")
                inst.url = url
                inst.title = self._page.title()

            return ActionResult(
                ok=True,
                action="launch",
                message=f"Browser launched ({browser}, {'headless' if headless else 'headed'})",
                instance=inst,
                screenshot=self._capture_screenshot(),
            )
        except Exception as exc:
            return ActionResult(ok=False, action="launch", message=str(exc))

    def close(self, instance_id: str | None = None) -> ActionResult:
        if instance_id and instance_id != "default":
            return ActionResult(ok=False, action="close", message=f"No instance '{instance_id}'")
        self._close_all()
        return ActionResult(ok=True, action="close", message="Browser closed")

    def navigate(self, url: str, instance_id: str | None = None) -> ActionResult:
        page = self._get_page()
        if page is None:
            return ActionResult(ok=False, action="navigate", message="No browser running")
        try:
            page.goto(url, wait_until="domcontentloaded")
            if "default" in self._instances:
                self._instances["default"].url = url
                self._instances["default"].title = page.title()
            return ActionResult(
                ok=True,
                action="navigate",
                message=f"Navigated to {url}",
                screenshot=self._capture_screenshot(),
            )
        except Exception as exc:
            return ActionResult(ok=False, action="navigate", message=str(exc))

    def screenshot(self, instance_id: str | None = None) -> ActionResult:
        cap = self._capture_screenshot()
        if cap is None:
            return ActionResult(ok=False, action="screenshot", message="No browser running")
        return ActionResult(
            ok=True,
            action="screenshot",
            message=f"Screenshot captured ({cap.width}x{cap.height})",
            screenshot=cap,
        )

    def click(self, selector: str, instance_id: str | None = None) -> ActionResult:
        page = self._get_page()
        if page is None:
            return ActionResult(ok=False, action="click", message="No browser running")
        try:
            page.click(selector, timeout=10000)
            return ActionResult(
                ok=True,
                action="click",
                message=f"Clicked '{selector}'",
                screenshot=self._capture_screenshot(),
            )
        except Exception as exc:
            return ActionResult(ok=False, action="click", message=str(exc))

    def type_text(
        self, selector: str, text: str, instance_id: str | None = None
    ) -> ActionResult:
        page = self._get_page()
        if page is None:
            return ActionResult(ok=False, action="type", message="No browser running")
        try:
            page.fill(selector, text, timeout=10000)
            return ActionResult(
                ok=True,
                action="type",
                message=f"Typed {len(text)} chars into '{selector}'",
                screenshot=self._capture_screenshot(),
            )
        except Exception as exc:
            return ActionResult(ok=False, action="type", message=str(exc))

    def scroll(
        self,
        direction: str = "down",
        amount: int = 300,
        instance_id: str | None = None,
    ) -> ActionResult:
        page = self._get_page()
        if page is None:
            return ActionResult(ok=False, action="scroll", message="No browser running")
        try:
            if direction in ("up", "down"):
                sign = -1 if direction == "up" else 1
                page.evaluate(f"window.scrollBy(0, {sign * amount})")
            elif direction in ("left", "right"):
                sign = -1 if direction == "left" else 1
                page.evaluate(f"window.scrollBy({sign * amount}, 0)")
            else:
                return ActionResult(ok=False, action="scroll", message=f"Unknown direction: {direction}")
            return ActionResult(
                ok=True,
                action="scroll",
                message=f"Scrolled {direction} by {amount}px",
                screenshot=self._capture_screenshot(),
            )
        except Exception as exc:
            return ActionResult(ok=False, action="scroll", message=str(exc))

    def launch_app(self, app: str, args: list[str] | None = None) -> AppLaunchResult:
        args = args or []
        try:
            if sys.platform == "darwin":
                cmd = ["open", "-a", app] + args
            elif sys.platform == "win32":
                cmd = ["start", "", app] + args
            else:
                # Linux: try gtk-launch first, then direct binary
                if shutil.which("gtk-launch") and not args:
                    proc = subprocess.Popen(
                        ["gtk-launch", app],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    )
                    return AppLaunchResult(ok=True, app=app, pid=proc.pid)
                binary = shutil.which(app) or app
                cmd = [binary] + args

            proc = subprocess.Popen(
                cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            return AppLaunchResult(ok=True, app=app, message=f"Launched", pid=proc.pid)
        except Exception as exc:
            return AppLaunchResult(ok=False, app=app, message=str(exc))

    def get_mjpeg_port(self) -> int:
        return self._mjpeg_port

    # ── internals ──────────────────────────────────────────────────────

    def _get_playwright(self):
        if self._playwright is None:
            from playwright.sync_api import sync_playwright  # type: ignore[import-untyped]
            self._playwright = sync_playwright().start()
        return self._playwright

    def _get_page(self):
        if self._page and not self._page.is_closed():
            return self._page
        return None

    def _capture_screenshot(self) -> ScreenshotResult | None:
        page = self._get_page()
        if page is None:
            return None
        try:
            png = page.screenshot(full_page=False)
            b64 = base64.b64encode(png).decode()
            # Push frame to MJPEG stream
            with self._frame_lock:
                self._last_frame = png
            return ScreenshotResult(
                png_b64=b64,
                width=page.viewport_size.get("width", 0) if page.viewport_size else 0,
                height=page.viewport_size.get("height", 0) if page.viewport_size else 0,
                page_url=page.url,
                page_title=page.title(),
            )
        except Exception:
            return None

    def _close_all(self) -> None:
        for resource in (self._page, self._context, self._browser):
            if resource is not None:
                try:
                    resource.close()
                except Exception:
                    pass
        self._page = None
        self._context = None
        self._browser = None
        self._instances.clear()
        self._active_instance = None

    def _ensure_playwright_browsers(self) -> None:
        """Install Playwright browser binaries if the 'playwright' CLI is
        available and browsers aren't already installed."""
        if shutil.which("playwright") is None:
            return
        try:
            result = subprocess.run(
                ["playwright", "install", "chromium"],
                capture_output=True, text=True, timeout=600,
            )
            if result.returncode == 0:
                logger.info("Playwright browser(s) installed.")
        except Exception as exc:
            logger.warning("Playwright browser install skipped: %s", exc)

    # ── Xvfb (virtual framebuffer for headed mode on Linux) ────────────

    def _start_xvfb(self) -> None:
        if self._xvfb_proc is not None:
            return
        if not shutil.which("Xvfb"):
            logger.warning("Xvfb not found — headed mode unavailable")
            return
        # Find a free display number
        import socket
        display = 99
        for d in range(99, 110):
            with socket.socket(socket.AF_UNIX) as s:
                try:
                    s.connect(f"/tmp/.X11-unix/X{d}")
                except (FileNotFoundError, ConnectionRefusedError):
                    display = d
                    break
        try:
            self._xvfb_proc = subprocess.Popen(
                ["Xvfb", f":{display}", "-screen", "0", "1920x1080x24", "-ac"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            self._xvfb_display = display
            os.environ["DISPLAY"] = f":{display}"
            time.sleep(0.5)
        except Exception as exc:
            logger.warning("Xvfb failed to start: %s", exc)
            self._xvfb_proc = None

    def _stop_xvfb(self) -> None:
        if self._xvfb_proc:
            try:
                self._xvfb_proc.terminate()
                self._xvfb_proc.wait(timeout=5)
            except Exception:
                try:
                    self._xvfb_proc.kill()
                except Exception:
                    pass
            self._xvfb_proc = None
            self._xvfb_display = None

    # ── MJPEG streaming server ─────────────────────────────────────────

    def _start_mjpeg_server(self, port: int = 0) -> None:
        """Start the MJPEG HTTP streamer on the given port (0 = auto)."""
        if self._mjpeg_running:
            return
        for attempt in range(10):
            try:
                server = HTTPServer(("127.0.0.1", port), _MJPEGHandler)
                server.backend = self  # type: ignore[attr-defined]
                self._mjpeg_port = server.server_address[1]
                self._mjpeg_server = server
                self._mjpeg_running = True
                self._mjpeg_thread = threading.Thread(
                    target=server.serve_forever, daemon=True, name="hermes-mjpeg",
                )
                self._mjpeg_thread.start()
                logger.info("MJPEG stream on http://127.0.0.1:%d/stream", self._mjpeg_port)
                return
            except OSError:
                port += 1
        logger.warning("Could not find a free port for MJPEG server")

    def _stop_mjpeg_server(self) -> None:
        self._mjpeg_running = False
        if self._mjpeg_server:
            try:
                self._mjpeg_server.shutdown()
            except Exception:
                pass
            self._mjpeg_server = None
        if self._mjpeg_thread:
            self._mjpeg_thread.join(timeout=3)
            self._mjpeg_thread = None
