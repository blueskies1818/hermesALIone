---
name: browser-control
description: >
  Cross-platform browser automation and app launching. Launch Chromium or
  Firefox in a headless (or headed with Xvfb) environment, navigate to URLs,
  click elements by CSS selector, type text into fields, scroll pages, and
  capture screenshots. Also launch system applications like Firefox, VS Code,
  or a terminal. Works on Linux, macOS, and Windows.
version: "1.0.0"
author: Hermes
license: MIT
platforms: [linux, macos, windows]
tags: [browser, automation, app-launch, playwright, cross-platform]
metadata:
  hermes:
    tags: [browser, automation]
---

# Browser Control

You have a `browser_control` tool that drives a real web browser and can
launch system applications. It works on Linux, macOS, and Windows.

## Browser actions

### launch
Start a new browser session. Specify `browser` (chromium, firefox, webkit),
optional `url`, and viewport `width`/`height`. Headless by default — set
`headless=false` for a visible window (uses Xvfb on Linux).

Example: `action="launch", browser="firefox", url="https://github.com"`

### navigate
Go to a URL in the current browser session.
Example: `action="navigate", url="https://example.com/login"`

### click
Click an element on the page by CSS selector, XPath, or text selector.
Examples:
- `action="click", selector="#submit-btn"`
- `action="click", selector="text=Sign In"`
- `action="click", selector="//button[contains(text(),'OK')]"`

### type
Type text into a form field identified by a selector.
Example: `action="type", selector="#username", text="admin"`

### scroll
Scroll the page. Default direction is "down" by 300px.
Example: `action="scroll", direction="down", amount=500`

### screenshot
Capture a PNG screenshot of the current page. Returns base64 image content
that vision-capable models can inspect.

### close
Close the current browser session.

## System app launching

### launch_app
Start any system application by name or path. The tool automatically
uses the right method per platform:
- macOS: `open -a <app>`
- Linux: `gtk-launch <app>` or direct binary
- Windows: `start <app>`

Examples:
- `action="launch_app", app="firefox"` — open Firefox
- `action="launch_app", app="code"` — open VS Code
- `action="launch_app", app="gnome-terminal"` — open terminal

## Live monitoring

When a browser is running, a live MJPEG stream is available at
`http://127.0.0.1:<port>/stream` for monitoring by the user or frontend.

## Workflow

1. Launch a browser: `action="launch", browser="chromium", url="..."`
2. Interact: `navigate`, `click`, `type`, `scroll` as needed
3. Verify with `screenshot` after state-changing actions
4. Close when done: `action="close"`
