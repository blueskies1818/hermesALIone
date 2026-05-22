# Cross-Platform & Headless Architecture

Hermes ALIone runs on **Linux, Windows, and macOS** without requiring GUI automation or platform-specific APIs. All tools are available on all platforms.

## What Was Removed

### Apple/macOS-Exclusive Skills
The following skills were removed because they required proprietary Apple APIs, apps, or CLIs with no cross-platform fallback:

- **Apple Notes** — required `Notes.app` and AppleScript
- **Apple Reminders** — required `Reminders.app` and AppleScript
- **Find My** — required iCloud Private API access
- **iMessage** — required `Messages.app` and AppleScript
- **macOS Computer Use** — required SkyLight private SPIs and `cua-driver`

These live on as an empty shell at `Agent/skills/apple/DESCRIPTION.md` with a note that cross-platform replacements are welcome.

### Computer Use Tool
The `computer_use_tool.py` was removed entirely. This tool relied on macOS-specific GUI automation — taking screenshots via `screencapture` and synthesizing mouse/keyboard events via SkyLight — capabilities that cannot work on headless Linux or Windows without a display server.

## Cross-Platform Tool Compatibility

All ~85 tools in `Agent/tools/` run on all platforms. There is **no OS-based gating** — the tool registry (`registry.py`) supports `check_fn` callables for availability checks, but no tool uses them for platform blocking.

Where platform differences exist, they are handled through compatibility code:

| Module | Platform Handling |
|--------|------------------|
| `terminal_tool.py` | Windows vs Unix shell detection |
| `browser_control/playwright_backend.py` | Xvfb for headless Linux, per-OS browser launch args |
| `environments/docker.py` | macOS Docker Desktop path detection |
| `mcp_oauth.py` | Display availability check for OAuth browser |
| `process_registry.py` | Windows process management differences |
| `approval.py` | macOS `/private/etc/var/tmp` symlink normalization |
| `tirith_security.py` | Apple Silicon vs Intel binary paths |

## Skill Platform Filtering

Skills can declare platform compatibility via YAML frontmatter:

```yaml
---
platforms: [linux, macos, windows]
---
```

The `skill_matches_platform()` function in `Agent/tools/skills_tool.py` and `Agent/agent/skill_utils.py` checks this field against `sys.platform` using a map:

| Frontmatter Value | Python `sys.platform` |
|-------------------|----------------------|
| `linux` | `linux` |
| `macos` | `darwin` |
| `windows` | `win32` |

Skills **without** a `platforms` field (the majority) load on all platforms. If `platforms` is present, it must contain the current OS to install.

## Headless Operation

The agent runs fully headless — no display server, GUI, or window manager required:

- **Terminal backend**: Local shell execution (default), with Docker/Singularity/Modal/Daytona/Vercel options for sandboxing
- **Browser tools**: Playwright with Chromium, supports headless mode via Xvfb on Linux
- **Web dashboard**: Browser-based UI served from port 9119 for headless server deployments
- **CLI/TUI**: Full-featured terminal REPL with curses-based TUI option

## Design Philosophy

The core principle: every feature must work on a headless Linux server, a Windows laptop, and a macOS desktop. No tool or skill should require proprietary APIs, paid third-party services, or GUI frameworks to function. Platform-specific optimizations are allowed but must have graceful fallbacks.
