# Hermes CLI — Gateway

The Gateway is a multi-platform messaging daemon that connects Hermes to external chat platforms (Telegram, Discord, Slack, WhatsApp, and more). It manages platform adapters, session context, streaming delivery, and cross-platform message routing.

## Architecture

| Module | Size | Purpose |
|--------|------|---------|
| `gateway/run.py` | 856 KB | Main gateway runner — lifecycle, adapters, sessions, agent cache, VAD voice, delivery routing |
| `gateway/config.py` | 94 KB | Gateway config — platform configs, home channels, session reset, delivery preferences |
| `gateway/session.py` | 57 KB | Session context, session store, PII redaction, session reset policy |
| `gateway/stream_consumer.py` | 64 KB | Bridges sync agent callbacks to async platform delivery — buffers, rate-limits, progressive edits |
| `gateway/platform_registry.py` | 10 KB | Plugin-based platform adapter registry |
| `gateway/delivery.py` | — | DeliveryRouter and DeliveryTarget for routing cron/output to platform channels |
| `gateway/pairing.py` | — | Device pairing for gateway platforms |
| `gateway/status.py` | 34 KB | Gateway status monitoring and reporting |
| `gateway/hooks.py` | — | Lifecycle hooks system |

### Other Gateway Modules
`socketio_server.py` (WebSocket IO), `slash_access.py` (slash command ACL), `mirror.py` (cross-platform mirroring), `shutdown_forensics.py`, `memory_monitor.py`, `runtime_footer.py`, `sticker_cache.py`, `restart.py`, `session_context.py`, `display_config.py`, `channel_directory.py`, `whatsapp_identity.py`

## Supported Platforms

| Platform | File | Size | Features |
|----------|------|------|----------|
| **Telegram** | `platforms/telegram.py` | 246 KB | Messages, commands, inline keyboards, media, reactions, streaming edits |
| **Discord** | `platforms/discord.py` | 252 KB | Messages, threads, slash commands, attachments, history backfill, reactions |
| **Slack** | `platforms/slack.py` | 129 KB | Messages, threads, slash commands, block kit |
| **WhatsApp** | `platforms/whatsapp.py` | 54 KB | WhatsApp Cloud API |
| **WeChat** | `platforms/weixin.py` | 83 KB | WeChat/Weixin |
| **WeCom** | `platforms/wecom.py` | 65 KB | WeChat Work |
| **DingTalk** | `platforms/dingtalk.py` | 61 KB | DingTalk |
| **Feishu/Lark** | `platforms/feishu.py` | 211 KB | Feishu + comment rules |
| **Signal** | `platforms/signal.py` | 63 KB | Signal messenger |
| **Matrix** | `platforms/matrix.py` | 115 KB | Matrix protocol |
| **Mattermost** | `platforms/mattermost.py` | 34 KB | Mattermost |
| **Email** | `platforms/email.py` | 29 KB | Email integration |
| **SMS** | `platforms/sms.py` | 14 KB | SMS |
| **BlueBubbles** | `platforms/bluebubbles.py` | 35 KB | iMessage via BlueBubbles |
| **Webhook** | `platforms/webhook.py` | 32 KB | Generic webhook receiver |
| **Home Assistant** | `platforms/homeassistant.py` | 16 KB | Smart home |
| **Yuanbao** | `platforms/yuanbao.py` | 192 KB | Tencent Yuanbao (AI assistant platform) |
| **QQ Bot** | `platforms/qqbot/` | — | QQ bot adapter |
| **API Server** | `platforms/api_server.py` | 160 KB | REST API for remote Hermes access (port 8642) |

## Platform Adapter Pattern

All platform adapters extend `BasePlatformAdapter` (161 KB in `platforms/base.py`) which provides:
- Message event handling (`MessageEvent`, `SendResult`)
- Media processing (images, audio, video, stickers)
- Shared message formatting and delivery logic
- Platform capability negotiation

New platforms register via `platform_registry.py` using the `PlatformEntry` dataclass (factory, check, validate, env, install_hint).

## Agent Cache

The gateway maintains an LRU agent cache (128 max agents, 1-hour idle TTL) to avoid re-initializing the agent for each message. Agents are keyed by session context.

## Continuous Voice Mode (VAD)

The gateway supports VAD-based continuous voice mode. When enabled, it:
1. Records continuously from the microphone
2. Detects speech via RMS thresholding
3. Auto-stops on sustained silence
4. Transcribes and passes to the agent
5. Auto-restarts listening after agent response

## CLI Management

Gateway lifecycle is managed via `hermes_cli/gateway.py`:
- `hermes gateway start` — start the gateway daemon
- `hermes gateway stop` — stop the gateway daemon  
- `hermes gateway status` — check gateway health
- `hermes gateway install` — install gateway as system service
