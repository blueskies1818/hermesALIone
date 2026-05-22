# Hermes CLI — Configuration

Hermes uses a comprehensive YAML configuration system with profile support, environment variable resolution, and schema validation.

## Config File

The main configuration file is `config.yaml` in the Hermes home directory. It covers every subsystem:

### Model & Provider Configuration
- `model` — default model name
- `providers` — provider configurations with API keys, base URLs, and model lists
- `fallback_providers` — fallback chains when a primary provider fails
- `credential_pool_strategies` — API key rotation strategies
- `auxiliary` — separate model assignments for vision, web extract, compression, skills hub, approval, MCP, title generation, triage, kanban, curator, and profile description

### Agent Settings
- `max_turns` — maximum conversation turns per session
- `timeouts` — tool execution and response timeouts
- `retries` — retry count and strategy
- `service_tier` — service tier selection (flex, priority)
- `image_input_mode` — how images are passed to the model

### Terminal & Environment
- `terminal.backend` — execution backend (local, docker, singularity, modal, daytona, vercel)
- `terminal.*` — per-backend configuration (image, mounts, resources)

### Web & Browser
- `web.search` — web search backend configuration
- `web.extract` — web content extraction settings
- `browser` — CDP settings, Camofox integration, dialog policy

### Tooling
- `checkpoints` — filesystem snapshots before destructive operations
- `tool_output` — output capture and display settings
- `tool_loop_guardrails` — loop detection and prevention
- `compression` — context compression settings
- `prompt_caching` — prompt caching configuration

### Voice & Audio
- `stt` — speech-to-text provider, model, language
- `tts` — text-to-speech provider, voice, model
- `voice` — recording key, max duration, auto-TTS, silence thresholds

### Platforms & Gateway
- `platforms` — per-platform configuration (API server host/port, Telegram token, Discord token, etc.)
- `platform_toolsets` — which tools are available on which platforms

### Memory, Delegation & Goals
- `memory` — memory backend and configuration
- `delegation` — subagent orchestration settings
- `goals` — goal tracking and persistence

### Skills, Cron & Kanban
- `skills` — skill hub and configuration
- `curator` — curator configuration
- `cron` — cron job settings
- `kanban` — kanban board settings

### Security
- `approvals` — approval policy configuration
- `security` — Tirith security layer, website blocklist, advisory acknowledgments

### Display
- `display` — compact mode, personality, skin, streaming, timestamps

### Advanced
- `openrouter` — OpenRouter API configuration
- `bedrock` — AWS Bedrock IAM configuration
- `code_execution` — sandbox configuration
- `logging` — log levels and destinations
- `model_catalog` — custom model definitions

## Profiles

The `hermes profile` command manages named configuration profiles:

```bash
hermes profile create <name>   # Create a new profile
hermes profile switch <name>   # Switch active profile
hermes profile delete <name>   # Delete a profile
hermes profile list            # List all profiles
```

Profiles enable multiple independent configurations on the same machine — different providers, models, tool preferences, and voice settings per profile.

## Configuration API

| Module | Size | Purpose |
|--------|------|---------|
| `hermes_cli/config.py` | 240 KB | YAML loading, env var resolution, schema validation, get/set operations |
| `hermes_cli/profiles.py` | 53 KB | Profile CRUD and switching |
| `hermes_cli/runtime_provider.py` | 69 KB | Runtime model/provider resolution |

### Slash Commands
- `/config` — view or set config values
- `/model` — change model mid-session
- `/profile` — view/switch profiles
- `/voice` — toggle voice mode, TTS, or check voice status

## Environment Variables

Config values support `${ENV_VAR}` interpolation and can be overridden at runtime. Provider API keys are typically set via environment variables rather than stored in config files.
