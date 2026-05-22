# Hermes CLI — Overview

The Hermes CLI (`hermes`) is the primary interface to the Hermes Agent runtime. It provides an interactive REPL, one-shot queries, and a large command suite for managing sessions, tools, configuration, and the multi-platform gateway.

## Entry Points

| Entry | Description |
|-------|-------------|
| `hermes` | Interactive REPL session with ASCII branding, tool selection, and rich terminal UI |
| `hermes -z/--oneshot "query"` | Single-turn query — runs one interaction and exits |
| `hermes chat` | Explicit chat subcommand with full flag set (query, image, resume, continue, worktree, checkpoints, max-turns, TUI) |
| `hermes --tui` | Curses-based terminal UI for the REPL |

### Key Flags

| Flag | Description |
|------|-------------|
| `--model/-m` | Model name to use |
| `--provider` | Provider name (e.g., openai, anthropic) |
| `--toolsets/-t` | Comma-separated toolset selection |
| `--resume/-r` | Resume a prior session by ID |
| `--continue/-c` | Continue the most recent session |
| `--worktree/-w` | Create a git worktree for the session |
| `--skills/-s` | Comma-separated skill selection |
| `--yolo` | Skip all approval prompts |
| `--accept-hooks` | Enable hook auto-approval |
| `--pass-session-id` | Pass session ID through to spawned processes |
| `--ignore-user-config` | Skip loading user config files |
| `--ignore-rules` | Skip loading project rules |
| `--dev` | Developer mode |

## Slash Command Categories

### Session Commands
`/new`, `/clear`, `/redraw`, `/history`, `/save`, `/retry`, `/undo`, `/title`, `/handoff`, `/branch`, `/compress`, `/rollback`, `/snapshot`, `/stop`, `/approve`, `/deny`, `/background`, `/agents`, `/queue`, `/steer`, `/goal`, `/subgoal`, `/status`, `/whoami`, `/profile`, `/sethome`, `/resume`, `/sessions`

### Configuration Commands
`/config`, `/model` (alias: `/provider`), `/codex-runtime`, `/personality`, `/statusbar`, `/verbose`, `/footer`, `/yolo`, `/reasoning`, `/fast`, `/skin`, `/indicator`, `/voice` (on/off/tts/status), `/busy`

### Tools & Skills
`/tools`, `/toolsets`, `/skills`, `/bundles`, `/cron`, `/curator`, `/kanban`, `/reload`, `/reload-mcp`, `/reload-skills`, `/browser`, `/plugins`

### Info & Exit
`/commands`, `/help`, `/usage`, `/insights`, `/platforms`, `/platform`, `/copy`, `/paste`, `/image`, `/update`, `/debug`, `/quit` (alias: `/exit`)

## Architecture

| Module | Size | Purpose |
|--------|------|---------|
| `hermes_cli/main.py` | 514 KB | Command dispatch engine, all subparser construction |
| `hermes_cli/commands.py` | — | Central slash command registry and handler dispatch |
| `hermes_cli/_parser.py` | — | Top-level argparse definition |
| `hermes_cli/config.py` | 240 KB | YAML config loading, env var resolution, profiles, schema validation |
| `hermes_cli/profiles.py` | 53 KB | Profile management (create, delete, switch, list) |
| `hermes_cli/runtime_provider.py` | 69 KB | Runtime model/provider resolution |
| `hermes_cli/voice.py` | 33 KB | Process-wide voice recording + TTS |
| `hermes_cli/gateway.py` | 226 KB | Gateway management (start, stop, install, status) |
| `hermes_cli/web_server.py` | 183 KB | Web dashboard server (port 9119) |
| `hermes_cli/curses_ui.py` | — | Curses-based TUI |

## Tool Library

The Agent ships with ~85 tool files in `Agent/tools/`, including:
- Terminal execution, file operations, web browsing (CDP + Camofox)
- Vision, image/video generation
- Delegation, MCP, skills hub
- Memory, kanban, cron jobs
- Session search, mixture of agents
- GitHub, Discord, Home Assistant integrations
- Code execution sandbox, process registry
- Approval flow, checkpoint manager

## Config File

Configuration lives at `config.yaml` and covers every subsystem: models, providers, agent settings, terminal backend, web tools, browser, checkpoints, compression, prompt caching, TTS/STT providers, voice settings, memory, delegation, goals, skills, cron, kanban, code execution, logging, platform-specific settings, approvals, and security. Schema version: 23.
