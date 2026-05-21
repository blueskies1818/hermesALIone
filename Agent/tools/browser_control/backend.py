"""Abstract backend interface for browser_control.

Backends implement browser automation + app launching. The default
PlaywrightBackend works on Linux, macOS, and Windows.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class BrowserInstance:
    """Handle to a running browser session."""
    id: str
    url: str = ""
    title: str = ""


@dataclass
class ScreenshotResult:
    """A screenshot captured from the browser."""
    png_b64: str
    width: int
    height: int
    page_url: str = ""
    page_title: str = ""


@dataclass
class ActionResult:
    """Result from a browser control action."""
    ok: bool
    action: str
    message: str = ""
    screenshot: ScreenshotResult | None = None
    instance: BrowserInstance | None = None


@dataclass
class AppLaunchResult:
    """Result from launching a system application."""
    ok: bool
    app: str
    message: str = ""
    pid: int = 0


class BrowserControlBackend(ABC):
    """Abstract backend for cross-platform browser automation.

    Implementations provide browser lifecycle management and user-input
    simulation via a real browser engine (Playwright, Puppeteer, etc.).
    """

    @abstractmethod
    def is_available(self) -> bool:
        """Check whether the backend can run (dependencies installed)."""
        ...

    @abstractmethod
    def start(self) -> None:
        """One-time setup: install browser dependencies, start Xvfb if needed."""
        ...

    @abstractmethod
    def stop(self) -> None:
        """Tear down: close all browsers, stop Xvfb, release resources."""
        ...

    @abstractmethod
    def launch(
        self,
        browser: str = "chromium",
        url: str = "",
        headless: bool = True,
        width: int = 1280,
        height: int = 720,
    ) -> ActionResult:
        """Launch a new browser instance and return its handle.

        Args:
            browser: 'chromium', 'firefox', or 'webkit'
            url: Optional URL to navigate to after launch
            headless: Run without visible window
            width: Viewport width in pixels
            height: Viewport height in pixels
        """
        ...

    @abstractmethod
    def close(self, instance_id: str | None = None) -> ActionResult:
        """Close a browser instance (or all if instance_id is None)."""
        ...

    @abstractmethod
    def navigate(self, url: str, instance_id: str | None = None) -> ActionResult:
        """Navigate the active browser instance to a URL."""
        ...

    @abstractmethod
    def screenshot(self, instance_id: str | None = None) -> ActionResult:
        """Capture a screenshot of the active page."""
        ...

    @abstractmethod
    def click(
        self,
        selector: str,
        instance_id: str | None = None,
    ) -> ActionResult:
        """Click an element on the page by CSS/XPath selector."""
        ...

    @abstractmethod
    def type_text(
        self,
        selector: str,
        text: str,
        instance_id: str | None = None,
    ) -> ActionResult:
        """Type text into an element on the page."""
        ...

    @abstractmethod
    def scroll(
        self,
        direction: str = "down",
        amount: int = 300,
        instance_id: str | None = None,
    ) -> ActionResult:
        """Scroll the page."""
        ...

    @abstractmethod
    def launch_app(self, app: str, args: list[str] | None = None) -> AppLaunchResult:
        """Launch a system application (cross-platform).

        Args:
            app: Application name or path (e.g. 'firefox', 'code', '/usr/bin/gedit')
            args: Optional command-line arguments
        """
        ...

    @abstractmethod
    def get_mjpeg_port(self) -> int:
        """Return the port the MJPEG stream is listening on (0 if disabled)."""
        ...
