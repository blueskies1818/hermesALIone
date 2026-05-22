# Hermes Desktop — Architecture

The Hermes Desktop is an Electron + React application providing a graphical interface for the Hermes Agent. It supports local, remote, and SSH connection modes, with 24 screens covering chat, sessions, tools, configuration, and more.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron 33 |
| UI | React 19 + TypeScript |
| Build | Vite + electron-builder |
| CSS | Custom CSS with CSS variables (light/dark themes) |
| IPC | Electron contextBridge + ipcRenderer/ipcMain |
| I18n | Custom i18n system (8 locales) |

## Project Structure

```
Desktop/
├── src/
│   ├── main/           # Electron main process
│   ├── preload/        # Context bridge (window.hermesAPI)
│   ├── renderer/
│   │   └── src/
│   │       ├── screens/    # 24 screen components
│   │       ├── components/ # Shared UI components
│   │       ├── hooks/      # Custom React hooks
│   │       └── utils/      # Audio capture/playback utilities
│   └── shared/         # Types shared between main & renderer
├── tests/              # 34 test files (Vitest)
└── resources/          # App icons and assets
```

## Main Process (`src/main/`)

| Module | Size | Purpose |
|--------|------|---------|
| `index.ts` | 53 KB | App entry — BrowserWindow, IPC handler registration, menus, tray, auto-updater |
| `hermes.ts` | 40 KB | Chat engine — spawns Python subprocess, message sending, audio transcription, SSE streaming |
| `ssh-remote.ts` | 57 KB | SSH-proxied operations — all Hermes features execute on remote via SSH commands |
| `ssh-tunnel.ts` | 7 KB | SSH tunnel lifecycle — start, stop, test, health check, control socket |
| `config.ts` | 39 KB | Config management — ConnectionConfig, env vars, YAML, credential pool, desktop.json |
| `installer.ts` | 41 KB | Installation — Python env setup, version detection, doctor/update/backup/import/dump |
| `sessions.ts` | 5 KB | Session CRUD via Python CLI |
| `session-cache.ts` | 8 KB | Fast local session cache with AI titles |
| `claw3d.ts` | 24 KB | 3D environment management |
| `models.ts` | 3 KB | Custom model CRUD (SQLite) |
| `model-discovery.ts` | 10 KB | Provider model discovery with caching |
| `kanban.ts` | 7 KB | Kanban board/task operations |
| `cronjobs.ts` | 5 KB | Cron job CRUD |
| `vault.ts` | 9 KB | Vault operations (buckets, files, search, index) |
| `skills.ts` | 3 KB | Skill install/uninstall/list |
| `soul.ts` | 1 KB | SOUL.md read/write/reset |
| `memory.ts` | 3 KB | Memory content management |
| `tools.ts` | 1 KB | Toolset enable/disable |
| `plugins-page.ts` | 5 KB | Plugin hub management |
| `profiles.ts` | 2 KB | Profile CRUD |
| `locale.ts` | 1 KB | Locale persistence |
| `security.ts` | 2 KB | Security advisory management |
| `askpass.ts` | 7 KB | SSH askpass credential forwarding |
| `sudoCreds.ts` | 7 KB | Sudo credential caching |
| `sse-parser.ts` | 4 KB | SSE stream parser for remote API |
| `yaml-path.ts` | 4 KB | YAML dot-notation path operations |
| `attachment-staging.ts` | 3 KB | Attachment staging and cleanup |
| `default-models.ts` | 1 KB | Default model definitions |
| `utils.ts` | 7 KB | Shell quoting, ANSI stripping, file helpers |

## Preload API (`src/preload/`)

| File | Size | Purpose |
|------|------|---------|
| `index.ts` | 33 KB | Full IPC API — 100+ methods exposed via contextBridge |
| `index.d.ts` | 22 KB | TypeScript declarations for the API surface |
| `askpass.ts` | — | SSH askpass credential forwarding |

See [Desktop IPC API](desktop-ipc-api.md) for the full API reference.

## Screens (24 total)

| Screen | Size | Purpose |
|--------|------|---------|
| **Chat** | 8 KB + 7 hooks | Main chat interface with streaming, attachments, model picker |
| **Assistant** | 15 KB | Voice assistant — STT, TTS, VAD, conversation |
| **Layout** | 14 KB | Root navigation with lazy-loaded views |
| **Sessions** | 12 KB | Session history browser with search |
| **Agents** | 14 KB | Multi-agent management dashboard |
| **Soul** | 3 KB | SOUL.md editing |
| **Memory** | 21 KB | Memory editor (agent + user profile) |
| **Tools** | 11 KB | Toolset enable/disable |
| **Skills** | 11 KB | Skill browser |
| **Kanban** | 34 KB | Full kanban board |
| **Schedules** | 22 KB | Cron job management |
| **Vault** | 50 KB | Document vault — force-directed node graph, file explorer, markdown editor, FTS5 search, bucket management |
| **Config** | 22 KB | Full YAML config editor |
| **Providers** | 20 KB | LLM provider configuration |
| **Models** | 18 KB | Custom model management |
| **Connect** | 11 KB | Connection mode setup (local/remote/SSH) |
| **Gateway** | 10 KB | Gateway platform status |
| **Plugins** | 17 KB | Plugin hub |
| **Office** | 17 KB | Office productivity stack |
| **Settings** | 38 KB | App settings (theme, locale, updates, backups) |
| **Install** | 5 KB | Installation progress |
| **Setup** | 10 KB | First-run setup wizard |
| **Welcome** | 13 KB | Welcome/onboarding |
| **SplashScreen** | — | Startup splash screen |

## Shared Components

| Component | Purpose |
|-----------|---------|
| `ModelSelector` | Searchable model/provider dropdown |
| `AgentMarkdown` | Markdown rendering for agent responses |
| `ErrorBoundary` | React error boundary |
| `ThemeProvider` | Theme context (light/dark/system) |
| `I18nProvider` | Internationalization (8 locales) |
| `AttachmentChip` | File attachment display |
| `RemoteNotice` | Remote mode notification banner |
| `VerifyWarningBanner` | Verification warning |
| `Versions` | Version display |
| `BrandLogo` / `HermesLogo` | SVG branding components |

## Internationalization

The app supports 8 locales: English, Spanish, Indonesian, Japanese, Brazilian Portuguese, European Portuguese, Simplified Chinese, and Traditional Chinese. Locale files live in `src/shared/i18n/locales/`.
