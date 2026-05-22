# Hermes Desktop — Connection Modes

The Desktop supports three connection modes for communicating with the Hermes Agent backend. Mode selection and configuration is handled in the Connect screen (`Connect.tsx`, 11 KB).

## ConnectionConfig

Stored in `desktop.json`:

```typescript
interface ConnectionConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  apiKey: string;
  ssh: {
    host: string;
    port: number;
    username: string;
    keyPath: string;
    remotePort: number;
    localPort: number;
  };
}
```

## 1. Local Mode (Default)

The Hermes Agent runs on the same machine as the Desktop app. The Desktop spawns the Python subprocess directly.

- **API Server**: `http://127.0.0.1:8642` — handles chat, transcription, and agent operations
- **REST/Dashboard**: `http://127.0.0.1:9119` — web dashboard and extended API
- **Gateway**: Spawned as needed for platform integrations

The Desktop manages the full lifecycle: start, monitor, and stop the Python process. No external configuration needed.

## 2. Remote Mode

Connects to a remote Hermes API server over HTTP.

- **URL**: User-provided remote API URL (e.g., `https://hermes.example.com:8642`)
- **Auth**: Optional API key (`API_SERVER_KEY` in the remote's `.env`)
- **Transport**: HTTP POST for requests, SSE (Server-Sent Events) for streaming responses
- **URL Normalization**: Handles trailing `/v1`, double slashes, and missing protocol

The remote machine must be running the Hermes gateway with the API server platform enabled and the port reachable over the network.

### SSE Parser (`sse-parser.ts`)
A custom parser handles Server-Sent Events from the remote API, extracting chat chunks, tool progress, usage info, errors, and TTS audio events from the stream.

## 3. SSH Mode

Connects via SSH tunnel to a remote Hermes installation. All operations execute on the remote host through the tunnel.

### SSH Tunnel (`ssh-tunnel.ts`, 7 KB)

- **Authentication**: Key-based only (BatchMode=yes, no password prompts)
- **Control Socket**: Shared SSH control socket for connection multiplexing
- **Health Check**: Polling with backoff to detect tunnel failure
- **Lifecycle**: `startSshTunnel()`, `stopSshTunnel()`, `testSshConnection()`, `isSshTunnelActive()`

SSH options:
- `BatchMode=yes` — never prompt for passwords
- `StrictHostKeyChecking=accept-new` — auto-accept new host keys
- `ServerAliveInterval=30` — keepalive every 30 seconds

### SSH Remote Proxy (`ssh-remote.ts`, 57 KB)

When in SSH mode, every Hermes operation is proxied through `sshExec()`:
- Skills, memory, sessions, tools, models — all run on the remote via `hermes <command>`
- Config read/write — YAML operations on the remote filesystem
- Chat — API calls tunneled through SSH port forwarding
- Gateway management — start/stop/status on remote

### SSH Askpass (`askpass.ts`, 7 KB)

Handles sudo/SSH credential prompts during remote operations. Uses a helper binary (`hermes-askpass`) for secure credential forwarding without exposing passwords in command lines.

## Connection Testing

The Connect screen provides real-time connection testing:
- **Remote**: HTTP health check to the remote API URL
- **SSH**: SSH connection test to verify key auth and tunnel establishment
- **Local**: Gateway status check

Test results show success/failure with detailed error messages.

## IPC API

The connection mode is exposed via these preload methods:

```typescript
window.hermesAPI.isRemoteMode(): Promise<boolean>
window.hermesAPI.isRemoteOnlyMode(): Promise<boolean>
window.hermesAPI.getConnectionConfig(): Promise<ConnectionConfig>
window.hermesAPI.setConnectionConfig(config: ConnectionConfig): Promise<void>
window.hermesAPI.setSshConfig(ssh: SshConfig): Promise<void>
window.hermesAPI.testRemoteConnection(): Promise<{ success: boolean; error?: string }>
window.hermesAPI.testSshConnection(): Promise<{ success: boolean; error?: string }>
window.hermesAPI.isSshTunnelActive(): Promise<boolean>
window.hermesAPI.startSshTunnel(): Promise<void>
window.hermesAPI.stopSshTunnel(): Promise<void>
```

## Known Gaps

1. **Tunnel status feedback** — no visual indicator when SSH tunnel goes down; need health events + sidebar status dot
2. **Auto-reconnect** — SSH tunnel death requires manual reconnect; need health polling with exponential backoff
3. **Model discovery routing** — `discoverProviderModels` reads local env; needs SSH/remote dispatch in IPC handler
