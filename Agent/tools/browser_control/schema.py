"""OpenAI function-calling schema for the browser_control tool.

A single consolidated tool with an ``action`` discriminator to keep
per-turn token cost low. Each action maps to a subset of the parameters.
"""

from __future__ import annotations

BROWSER_CONTROL_SCHEMA: dict = {
    "name": "browser_control",
    "description": (
        "Cross-platform browser automation and app launching. "
        "Launch a real browser (Chromium/Firefox), navigate to URLs, "
        "click elements, type text, scroll pages, capture screenshots, "
        "and launch system applications. Works on Linux, macOS, and Windows."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "launch",
                    "close",
                    "navigate",
                    "screenshot",
                    "click",
                    "type",
                    "scroll",
                    "launch_app",
                ],
                "description": "The action to perform.",
            },
            "browser": {
                "type": "string",
                "enum": ["chromium", "firefox", "webkit"],
                "description": "Browser to launch (default: chromium). Used by: launch.",
            },
            "url": {
                "type": "string",
                "description": "URL to navigate to. Used by: launch, navigate.",
            },
            "headless": {
                "type": "boolean",
                "description": "Run browser without a visible window (default: true). Used by: launch.",
            },
            "width": {
                "type": "integer",
                "description": "Viewport width in pixels (default: 1280). Used by: launch.",
            },
            "height": {
                "type": "integer",
                "description": "Viewport height in pixels (default: 720). Used by: launch.",
            },
            "selector": {
                "type": "string",
                "description": (
                    "CSS selector, XPath, or text selector for the target element. "
                    "Examples: '#login', 'button.submit', '//div[@class=\"menu\"]', "
                    "'text=Sign In'. Used by: click, type."
                ),
            },
            "text": {
                "type": "string",
                "description": "Text to type into the element. Used by: type.",
            },
            "direction": {
                "type": "string",
                "enum": ["up", "down", "left", "right"],
                "description": "Scroll direction. Used by: scroll.",
            },
            "amount": {
                "type": "integer",
                "description": "Scroll amount in pixels (default: 300). Used by: scroll.",
            },
            "app": {
                "type": "string",
                "description": (
                    "Application name or path to launch. "
                    "Examples: 'firefox', 'gedit', '/usr/bin/code', 'notepad'. "
                    "Used by: launch_app."
                ),
            },
            "app_args": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Command-line arguments for the app. Used by: launch_app.",
            },
        },
        "required": ["action"],
    },
}
