<p align="center">
  <img src="Agent/assets/banner.png" alt="Hermes Agent" width="100%">
</p>

# Hermes ALIone

**The self-improving AI agent built by [Nous Research](https://nousresearch.com),**
with a native desktop GUI.

This is a monorepo — a desktop app for installing, configuring, and chatting
with Hermes Agent, paired with the agent runtime itself.

| Directory | Purpose |
|-----------|---------|
| [`Desktop/`](Desktop/) | Electron + React desktop app — GUI for chat, sessions, profiles, skills, tools, gateways, and more |
| [`Agent/`](Agent/) | Python agent runtime — tool-calling AI with learning loop, TUI, cron, and multi-platform messaging |

## Credits

Desktop app based on [fathah/hermes-desktop](https://github.com/fathah/hermes-desktop)
— the original Hermes Desktop GUI. Agent runtime from
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent).
Both licensed under MIT.

## Improvements in This Fork

### Cross-Platform & Headless Ready
- Removed Apple/macOS-exclusive skills (Apple Notes, Reminders, Find My, iMessage, macOS Computer Use) — all skills now work on Linux, Windows, and macOS
- Removed Computer Use tool dependency — the agent runs fully headless without GUI automation requirements
- Web-based dashboard and app interface for headless server deployments

### New Screens & Features
- **Voice Assistant** — push-to-talk voice mode with VAD, STT transcription, and streaming TTS responses directly in the Assistant tab
- **Model APIs (Config)** — full provider API key management, custom base URLs, model CRUD, local model setup (Ollama, LM Studio), and provider model discovery — all auto-saved
- **Model Selector** — searchable dropdown model picker in Chat and Assistant tabs, synced across the app
- **Vault UI** — encrypted secrets store with browse and management
- **Plugins UI** — plugin management and configuration
- **Connect Screen** — local/remote/SSH connection setup with validation

### UI/UX Improvements
- Toast-style save confirmation popups (centered, animated) instead of subtle banners
- Button press feedback (`:active` scale + brightness) across all buttons
- Centered model selector bar at all window sizes
- Auto-save indicator on Model APIs tab to prevent confusion with form-based Save
- User-friendly error messages ("Configure an agentic provider first" instead of raw `ECONNREFUSED`)

### Bug Fixes
- Models deleted in Config now correctly disappear from Chat and Assistant selectors
- Default models no longer reappear after deletion (empty API response returns `[]` not defaults)
- `removeModel()` now throws on API failure instead of silently returning `false`
- Fixed duplicate React keys from default models sharing empty IDs
- Save button properly shows disabled state when nothing has changed

## Documentation

Detailed documentation for each subsystem lives in [`Docs/`](Docs/):

### CLI
| File | Description |
|------|-------------|
| [CLI Overview](Docs/cli-overview.md) | Entry points, slash commands, REPL, tool library, architecture |
| [CLI Gateway](Docs/cli-gateway.md) | Multi-platform messaging daemon, 19 platform adapters, agent cache |
| [CLI Voice](Docs/cli-voice.md) | Voice mode pipeline, STT/TTS providers, push-to-talk and continuous VAD |
| [CLI Config](Docs/cli-config.md) | YAML configuration system, profiles, provider/model settings |

### Desktop
| File | Description |
|------|-------------|
| [Desktop Overview](Docs/desktop-overview.md) | Electron + React architecture, 24 screens, main process modules |
| [Connection Modes](Docs/desktop-connection-modes.md) | Local/remote/SSH connection setup, SSH tunnel lifecycle |
| [Voice Assistant](Docs/desktop-voice-assistant.md) | VAD state machine, TTS pipeline, pre-roll buffer, audio visualizer |
| [IPC API Reference](Docs/desktop-ipc-api.md) | Full `window.hermesAPI` surface — 100+ methods across all categories |

## Quick Links

- [Desktop README](Desktop/README.md) — install, screenshots, features, development
- [Agent README](Agent/README.md) — quick install, architecture, configuration
- [Documentation](https://hermes-agent.nousresearch.com/docs/)
- [Discord](https://discord.gg/NousResearch)

## License

MIT — see [LICENSE].
