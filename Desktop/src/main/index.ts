import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  dialog,
  session,
} from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { AppUpdater } from "electron-updater";
import icon from "../../resources/icon.png?asset";
import type { Attachment } from "../shared/attachments";
import {
  checkInstallStatus,
  verifyInstall,
  getHermesVersion,
  clearVersionCache,
} from "./installer";
import {
  isRemoteMode,
  isRemoteOnlyMode,
  sendMessage,
  transcribeAudio,
  startGateway,
  stopGateway,
  isGatewayRunning,
  testRemoteConnection,
  stopHealthPolling,
  restartGateway,
  ensureSshTunnelIfNeeded,
  setSshRemoteApiKey,
  apiFetch,
} from "./hermes";
import {
  subscribeSessionEvents,
  unsubscribeSessionEvents,
} from "./session-events";
import { readFile, writeFile } from "fs/promises";
import { exportConversation } from "./exportConversation";
import * as thetaAgents from "./agents";
import {
  uploadAttachment,
  discoverProviderModelsViaServer,
} from "./server-client";
import {
  startSshTunnel,
  stopSshTunnel,
  testSshConnection,
  isSshTunnelActive,
  isSshTunnelHealthy,
} from "./ssh-tunnel";
import {
  readEnv,
  setEnvValue,
  getConfigValue,
  setConfigValue,
  getHermesHome,
  getModelConfig,
  setModelConfig,
  getConnectionConfig,
  getPublicConnectionConfig,
  resolveConnectionApiKeyUpdate,
  setConnectionConfig,
  getPlatformEnabled,
  setPlatformEnabled,
} from "./config";
import {
  listSessions,
  getSessionMessages,
  searchSessions,
  deleteSession,
  updateSession,
} from "./sessions";
import {
  syncSessionCache,
  listCachedSessions,
} from "./session-cache";
import { listModels, addModel, removeModel, updateModel } from "./models";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
  getDefaultAgent,
} from "./profiles";
import {
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
} from "./memory";
import { readSoul, writeSoul, resetSoul } from "./soul";
import { getToolsets, setToolsetEnabled } from "./tools";
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
} from "./skills";
import {
  listCronJobs,
  createCronJob,
  removeCronJob,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
} from "./cronjobs";
import {
  listBoards as kanbanListBoards,
  currentBoard as kanbanCurrentBoard,
  switchBoard as kanbanSwitchBoard,
  createBoard as kanbanCreateBoard,
  removeBoard as kanbanRemoveBoard,
  listTasks as kanbanListTasks,
  getTask as kanbanGetTask,
  createTask as kanbanCreateTask,
  assignTask as kanbanAssignTask,
  completeTask as kanbanCompleteTask,
  blockTask as kanbanBlockTask,
  unblockTask as kanbanUnblockTask,
  archiveTask as kanbanArchiveTask,
  specifyTask as kanbanSpecifyTask,
  reclaimTask as kanbanReclaimTask,
  commentTask as kanbanCommentTask,
  dispatchOnce as kanbanDispatchOnce,
  CreateTaskInput,
} from "./kanban";
import { getAppLocale, setAppLocale } from "./locale";
import {
  getVaultStatus,
  listVaultBuckets,
  browseVaultBucket,
  searchVault,
  createVaultBucket,
  deleteVaultBucket,
  updateVaultBucket,
  reindexVault,
  treeVaultBucket,
  readVaultFile,
  writeVaultFile,
  moveVaultItem,
  createVaultFile,
  createVaultFolder,
  deleteVaultItem,
  getBucketLinks,
} from "./vault";
import {
  getFullConfig,
  saveFullConfig,
  getConfigSchema,
  getConfigDefaults,
  getConfigRaw,
  saveConfigRaw,
  restartGatewayForConfig,
} from "./config-page";
import {
  getPluginsHub,
  installPlugin,
  enablePlugin,
  disablePlugin,
  updatePlugin,
  removePlugin,
  savePluginProviders,
  setPluginVisibility,
} from "./plugins-page";
import {
  hardenAttachedWebContents,
  hardenWebviewPreferences,
  isAllowedAppNavigationUrl,
  isAllowedExternalUrl,
  isAllowedWebviewUrl,
} from "./security";
import type { AppLocale } from "../shared/i18n/types";
import {
  sshListInstalledSkills,
  sshGetSkillContent,
  sshInstallSkill,
  sshUninstallSkill,
  sshListBundledSkills,
  sshReadMemory,
  sshAddMemoryEntry,
  sshUpdateMemoryEntry,
  sshRemoveMemoryEntry,
  sshWriteUserProfile,
  sshReadSoul,
  sshWriteSoul,
  sshResetSoul,
  sshGetToolsets,
  sshSetToolsetEnabled,
  sshReadEnv,
  sshSetEnvValue,
  sshGetConfigValue,
  sshSetConfigValue,
  sshGetHermesHome,
  sshGetModelConfig,
  sshSetModelConfig,
  sshListSessions,
  sshGetSessionMessages,
  sshDeleteSession,
  sshSearchSessions,
  sshListProfiles,
  sshCreateProfile,
  sshDeleteProfile,
  sshGatewayStatus,
  sshStartGateway,
  sshStopGateway,
  sshReadRemoteApiKey,
  sshGetHermesVersion,
  sshReadLogs,
  sshGetPlatformEnabled,
  sshSetPlatformEnabled,
  sshListCachedSessions,
  sshRunDoctor,
  sshListModels,
  sshAddModel,
  sshRemoveModel,
  sshUpdateModel,
  sshRunUpdate,
  sshRunDump,
  sshDiscoverMemoryProviders,
} from "./ssh-remote";

// Allow AudioContext and media autoplay in the desktop app without requiring
// a user gesture — the assistant screen creates AudioContext from IPC callbacks.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

process.on("uncaughtException", (err) => {
  console.error("[MAIN UNCAUGHT]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[MAIN UNHANDLED REJECTION]", reason);
});

let mainWindow: BrowserWindow | null = null;
let currentChatAbort: (() => void) | null = null;

function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl)) {
    console.warn("[SECURITY] Blocked unsafe external URL");
    return;
  }

  shell.openExternal(rawUrl).catch((err) => {
    console.error("[SECURITY] Failed to open external URL:", err);
  });
}

function createWindow(): void {
  const rendererHtmlPath = join(__dirname, "../renderer/index.html");

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 900,
    minHeight: 820,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow!.show();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      "[CRASH] Renderer process gone:",
      details.reason,
      details.exitCode,
    );
  });

  mainWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        console.error(`[RENDERER ERROR] ${message} (${sourceId}:${line})`);
      }
    },
  );

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      console.error("[LOAD FAIL]", errorCode, errorDescription);
    },
  );

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalUrl(details.url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (
      isAllowedAppNavigationUrl(
        url,
        rendererHtmlPath,
        is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined,
      )
    ) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url);
  });

  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      if (!isAllowedWebviewUrl(params.src)) {
        event.preventDefault();
        console.warn("[SECURITY] Blocked webview attachment for untrusted URL");
        return;
      }

      hardenWebviewPreferences(webPreferences);
    },
  );

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(rendererHtmlPath);
  }
}

function setupIPC(): void {
  // Installation
  ipcMain.handle("check-install", () => {
    return checkInstallStatus();
  });

  ipcMain.handle("verify-install", () => verifyInstall());

  // Hermes engine info
  ipcMain.handle("get-hermes-version", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshGetHermesVersion(conn.ssh);
    if (isRemoteMode()) {
      const { ok, data } = await apiFetch("/api/version");
      if (!ok) return null;
      return String((data as Record<string, unknown>)?.version || "");
    }
    return getHermesVersion();
  });
  ipcMain.handle("refresh-hermes-version", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshGetHermesVersion(conn.ssh);
    if (isRemoteMode()) {
      const { ok, data } = await apiFetch("/api/version");
      if (!ok) return null;
      return String((data as Record<string, unknown>)?.version || "");
    }
    clearVersionCache();
    return getHermesVersion();
  });
  ipcMain.handle("run-hermes-doctor", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshRunDoctor(conn.ssh);
    // Theta: the app never runs backend tools on its own machine.
    return "This runs on the server. Use the terminal there (e.g. `hermes doctor`).";
  });
  ipcMain.handle("run-hermes-update", async (event) => {
    try {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        event.sender.send("install-progress", {
          step: 1,
          totalSteps: 1,
          title: "Updating remote Theta Agent",
          detail: "Running hermes update over SSH...",
          log: "Running hermes update over SSH...\n",
        });
        await sshRunUpdate(conn.ssh);
        await sshStartGateway(conn.ssh);
        await startSshTunnel(conn.ssh);
        const key = await sshReadRemoteApiKey(conn.ssh);
        setSshRemoteApiKey(key);
        return { success: true };
      }
      // Theta: the server is updated on the server (git pull + install).
      return {
        success: false,
        error: "Update the server on the server machine (git pull, then install.ps1).",
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // OpenClaw migration
  // Theta: OpenClaw migration reads files on this machine; not offered.
  ipcMain.handle("check-openclaw", () => ({ found: false, path: null }));
  ipcMain.handle("run-claw-migrate", async () => ({
    success: false,
    error: "Migration runs on the server, not from the app.",
  }));

  // Configuration (profile-aware)
  ipcMain.handle("get-locale", () => getAppLocale());
  ipcMain.handle("set-locale", (_event, locale: AppLocale) =>
    setAppLocale(locale),
  );

  ipcMain.handle("get-env", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshReadEnv(conn.ssh, profile);
    if (isRemoteMode()) {
      const { ok, data } = await apiFetch("/api/env");
      if (!ok) return {};
      const items = data as Record<string, { is_set?: boolean; redacted_value?: string | null }>;
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(items)) {
        if (v.is_set && v.redacted_value) result[k] = v.redacted_value;
      }
      return result;
    }
    return readEnv(profile);
  });

  ipcMain.handle(
    "set-env",
    async (_event, key: string, value: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetEnvValue(conn.ssh, key, value, profile);
        return true;
      }
      if (isRemoteMode()) {
        await apiFetch("/api/env", { method: "PUT", body: { key, value } });
        return true;
      }
      setEnvValue(key, value, profile);
      // Restart gateway so it picks up the new API key.
      // The earlier condition had a precedence bug —
      //   `(isGatewayRunning() && _API_KEY) || _TOKEN || HF_TOKEN`
      // — that triggered a restart for `_TOKEN`/`HF_TOKEN` writes even
      // when no local gateway was running, which in remote mode hit the
      // `startGateway` path with no local install (issue #266).
      // restartGateway() now also self-gates on isRemoteMode(), so this
      // is belt-and-braces, but the condition is fixed too for clarity.
      const looksLikeCredential =
        key.endsWith("_API_KEY") ||
        key.endsWith("_TOKEN") ||
        key === "HF_TOKEN";
      if ((await isGatewayRunning()) && looksLikeCredential) {
        await restartGateway(profile);
      }
      return true;
    },
  );

  ipcMain.handle("get-config", async (_event, key: string, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetConfigValue(conn.ssh, key, profile);
    if (isRemoteMode()) {
      const { ok, data } = await apiFetch("/api/config");
      if (!ok) return null;
      const parts = key.split(".");
      let val: unknown = data;
      for (const p of parts) {
        if (val == null || typeof val !== "object") return null;
        val = (val as Record<string, unknown>)[p];
      }
      return val != null ? String(val) : null;
    }
    return getConfigValue(key, profile);
  });

  ipcMain.handle(
    "set-config",
    async (_event, key: string, value: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetConfigValue(conn.ssh, key, value, profile);
        return true;
      }
      if (isRemoteMode()) {
        const { ok, data } = await apiFetch("/api/config");
        if (!ok) return false;
        const cfg = (data as Record<string, unknown>) || {};
        const parts = key.split(".");
        let node: Record<string, unknown> = cfg;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!node[parts[i]] || typeof node[parts[i]] !== "object") {
            node[parts[i]] = {};
          }
          node = node[parts[i]] as Record<string, unknown>;
        }
        node[parts[parts.length - 1]] = value;
        await apiFetch("/api/config", { method: "PUT", body: { config: cfg } });
        return true;
      }
      setConfigValue(key, value, profile);
      return true;
    },
  );

  ipcMain.handle("get-hermes-home", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetHermesHome(conn.ssh, profile);
    if (isRemoteMode()) {
      const { ok, data } = await apiFetch("/api/status");
      if (!ok) return "";
      return String((data as Record<string, unknown>)?.hermes_home || "");
    }
    return getHermesHome(profile);
  });

  ipcMain.handle("get-model-config", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetModelConfig(conn.ssh, profile);
    if (isRemoteMode()) {
      // Theta: the agent's own model, from the server.
      const r = await thetaAgents.getAgentSettings(profile || "default");
      if (!r.ok) return { provider: "", model: "", baseUrl: "" };
      return {
        provider: r.data.model.provider,
        model: r.data.model.model,
        baseUrl: r.data.model.base_url,
      };
    }
    return getModelConfig(profile);
  });

  ipcMain.handle(
    "set-model-config",
    async (
      _event,
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        const prev = await sshGetModelConfig(conn.ssh, profile);
        await sshSetModelConfig(conn.ssh, provider, model, baseUrl, profile);
        if (
          (await sshGatewayStatus(conn.ssh)) &&
          (prev.provider !== provider ||
            prev.model !== model ||
            prev.baseUrl !== baseUrl)
        ) {
          await sshStopGateway(conn.ssh);
          await sshStartGateway(conn.ssh);
        }
        return true;
      }
      if (isRemoteMode()) {
        // Theta: write the chosen agent's model (not always the default's).
        const r = await thetaAgents.updateAgentSettings(profile || "default", {
          model: { provider, model, base_url: baseUrl },
        });
        return r.ok;
      }
      const prev = getModelConfig(profile);
      setModelConfig(provider, model, baseUrl, profile);

      // Restart gateway when provider, model, or endpoint changes so it picks up new config
      if (
        (await isGatewayRunning()) &&
        (prev.provider !== provider ||
          prev.model !== model ||
          prev.baseUrl !== baseUrl)
      ) {
        await restartGateway(profile);
      }

      return true;
    },
  );

  // Connection mode (local / remote / ssh)
  ipcMain.handle("is-remote-mode", () => isRemoteMode());
  ipcMain.handle("is-remote-only-mode", () => isRemoteOnlyMode());
  ipcMain.handle("get-connection-config", () => getPublicConnectionConfig());
  ipcMain.handle("is-ssh-tunnel-active", () => isSshTunnelActive());

  ipcMain.handle(
    "set-connection-config",
    (
      _event,
      mode: "local" | "remote" | "ssh",
      remoteUrl: string,
      apiKey?: string,
    ) => {
      const existing = getConnectionConfig();
      setConnectionConfig({
        ...existing,
        mode,
        remoteUrl,
        apiKey: resolveConnectionApiKeyUpdate(
          existing,
          mode,
          remoteUrl,
          apiKey,
        ),
      });
      return true;
    },
  );

  ipcMain.handle(
    "set-ssh-config",
    (
      _event,
      host: string,
      port: number,
      username: string,
      keyPath: string,
      remotePort: number,
      localPort: number,
    ) => {
      const current = getConnectionConfig();
      setConnectionConfig({
        ...current,
        mode: "ssh",
        ssh: { host, port, username, keyPath, remotePort, localPort },
      });
      return true;
    },
  );

  ipcMain.handle(
    "test-remote-connection",
    (_event, url: string, apiKey?: string) => testRemoteConnection(url, apiKey),
  );

  ipcMain.handle(
    "test-ssh-connection",
    (
      _event,
      host: string,
      port: number,
      username: string,
      keyPath: string,
      remotePort: number,
    ) =>
      testSshConnection({
        host,
        port,
        username,
        keyPath,
        remotePort,
        localPort: 19642,
      }),
  );

  ipcMain.handle("start-ssh-tunnel", async () => {
    const conn = getConnectionConfig();
    if (conn.mode !== "ssh") return false;
    if (conn.ssh && !(await sshGatewayStatus(conn.ssh))) {
      await sshStartGateway(conn.ssh);
    }
    await startSshTunnel(conn.ssh);
    // Cache the remote API key so chat auth works through the tunnel
    if (conn.ssh) {
      const key = await sshReadRemoteApiKey(conn.ssh);
      setSshRemoteApiKey(key);
    }
    return true;
  });

  ipcMain.handle("stop-ssh-tunnel", () => {
    stopSshTunnel();
    return true;
  });

  // Chat — lazy-start gateway on first message
  ipcMain.handle(
    "send-message",
    async (
      event,
      message: string,
      profile?: string,
      resumeSessionId?: string,
      history?: Array<{ role: string; content: string }>,
      attachments?: Attachment[],
      voiceMode?: boolean,
    ) => {
      console.log("[send-message] voiceMode=", voiceMode, "msg=", message?.slice(0, 40));
      if (!isRemoteMode() && !(await isGatewayRunning())) {
        await startGateway(profile);
      }

      await ensureSshTunnelIfNeeded();
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        const gatewayRunning = await sshGatewayStatus(conn.ssh);
        const tunnelHealthy = await isSshTunnelHealthy();
        if (!gatewayRunning || !tunnelHealthy) {
          await sshStartGateway(conn.ssh);
          await startSshTunnel(conn.ssh);
          const key = await sshReadRemoteApiKey(conn.ssh);
          setSshRemoteApiKey(key);
        }
      }

      if (currentChatAbort) {
        currentChatAbort();
      }

      let fullResponse = "";
      const chatStartTime = Date.now();
      let resolveChat: (v: { response: string; sessionId?: string }) => void;
      let rejectChat: (reason?: unknown) => void;
      const promise = new Promise<{ response: string; sessionId?: string }>(
        (res, rej) => {
          resolveChat = res;
          rejectChat = rej;
        },
      );

      const handle = await sendMessage(
        message,
        {
          onChunk: (chunk) => {
            fullResponse += chunk;
            event.sender.send("chat-chunk", chunk);
          },
          onDone: (sessionId) => {
            currentChatAbort = null;
            event.sender.send("chat-done", sessionId || "");
            resolveChat({ response: fullResponse, sessionId });
            // Desktop notification when window is not focused and response took >10s
            if (
              mainWindow &&
              !mainWindow.isFocused() &&
              Date.now() - chatStartTime > 10000
            ) {
              const preview = fullResponse
                .replace(/[#*_`~\n]+/g, " ")
                .trim()
                .slice(0, 80);
              new Notification({
                title: "Theta Agent",
                body: preview || "Response ready",
              }).show();
            }
          },
          onError: (error) => {
            currentChatAbort = null;
            // Sanitize API key fragments that providers may embed in error
            // messages (e.g. "api key: ****47f9 is invalid"). Replace
            // asterisk-prefixed hex/alphanumeric runs with [redacted]
            // and scrub known "key: value" patterns.
            const sanitized = error
              .replace(/[*]{2,}[a-zA-Z0-9]{4,}/g, "[redacted]")
              .replace(/\b(api[_\s]?key[:\s]*)\S+/gi, "$1[redacted]");
            event.sender.send("chat-error", sanitized);
            rejectChat(new Error(sanitized));
            // Notify on error too if window not focused
            if (mainWindow && !mainWindow.isFocused()) {
              new Notification({
                title: "Theta Agent — Error",
                body: sanitized.slice(0, 100),
              }).show();
            }
          },
          onToolProgress: (tool) => {
            event.sender.send("chat-tool-progress", tool);
          },
          onToolEvent: (toolEvent) => {
            event.sender.send("chat-tool-event", toolEvent);
          },
          onReasoning: (text) => {
            event.sender.send("chat-reasoning", text);
          },
          onUsage: (usage) => {
            event.sender.send("chat-usage", usage);
          },
          ...(voiceMode
            ? {
                onTtsAudio: (base64Chunk: string) => {
                  console.log("[TTS] audio chunk received in main, bytes:", base64Chunk.length);
                  event.sender.send("chat-tts-audio", base64Chunk);
                },
              }
            : {}),
        },
        profile,
        resumeSessionId,
        history,
        attachments,
      );

      currentChatAbort = handle.abort;
      return promise;
    },
  );

  ipcMain.handle("abort-chat", () => {
    if (currentChatAbort) {
      currentChatAbort();
      currentChatAbort = null;
    }
  });

  // Theta: live session events (agent speaking up on its own)
  ipcMain.handle(
    "subscribe-session-events",
    (event, sessionId: string, voice: boolean) => {
      if (typeof sessionId !== "string" || !sessionId) return false;
      subscribeSessionEvents(event.sender, sessionId, Boolean(voice));
      return true;
    },
  );
  ipcMain.handle("unsubscribe-session-events", () => {
    unsubscribeSessionEvents();
  });

  ipcMain.handle("send-audio", async (_event, base64Audio: string) => {
    return transcribeAudio(base64Audio);
  });

  // Theta: follow-up suggestions after a reply (auxiliary model on the server)
  ipcMain.handle("follow-up-suggestions", async (_event, user: string, assistant: string) => {
    try {
      const { ok, data } = await apiFetch("/api/suggestions", {
        method: "POST",
        body: { user: String(user || ""), assistant: String(assistant || "") },
        timeoutMs: 30000,
      });
      const list = (data as { suggestions?: unknown } | null)?.suggestions;
      return ok && Array.isArray(list) ? list.filter((s) => typeof s === "string") : [];
    } catch {
      return [];
    }
  });

  // Theta: read a message aloud — synthesised on the server
  ipcMain.handle("speak-text", async (_event, text: string) => {
    if (typeof text !== "string" || !text.trim()) {
      return { success: false, error: "Nothing to read" };
    }
    try {
      const { ok, data } = await apiFetch("/v1/tts", {
        method: "POST",
        body: { text },
        timeoutMs: 120000,
      });
      const d = (data || {}) as { chunks?: string[]; error?: string; detail?: string };
      return ok
        ? { success: true, chunks: d.chunks || [] }
        : { success: false, error: d.error || d.detail || "Read aloud failed" };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Attachment staging — for pasted blobs that have no filesystem origin.
  ipcMain.handle(
    "stage-attachment",
    (_event, sessionId: string, filename: string, base64Bytes: string) => {
      // Theta: upload to the server; the agent gets a server-side path.
      return uploadAttachment(sessionId, filename, base64Bytes);
    },
  );
  // Uploads live in the server workspace (filed with the session there).
  ipcMain.handle("clear-staged-attachments", () => undefined);

  // Model discovery — fetch the provider's /v1/models for autocomplete.
  ipcMain.handle(
    "discover-provider-models",
    (
      _event,
      provider: string,
      baseUrl: string | undefined,
      apiKey: string | undefined,
      profile?: string,
    ) => {
      // Theta: discovered on the server, with the server's own keys.
      return discoverProviderModelsViaServer(provider, baseUrl, apiKey, profile);
    },
  );

  // Gateway
  ipcMain.handle("start-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStartGateway(conn.ssh);
      return true;
    }
    return startGateway();
  });
  ipcMain.handle("stop-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStopGateway(conn.ssh);
      return true;
    }
    await stopGateway(true);
    return true;
  });
  ipcMain.handle("gateway-status", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshGatewayStatus(conn.ssh);
    return await isGatewayRunning();
  });

  // Platform toggles (config.yaml platforms section)
  ipcMain.handle("get-platform-enabled", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetPlatformEnabled(conn.ssh, profile);
    if (isRemoteMode()) {
      const { ok, data } = await apiFetch("/api/config");
      if (!ok) return {};
      const platforms = (data as Record<string, unknown>)?.platforms;
      if (platforms && typeof platforms === "object") {
        const result: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(platforms as Record<string, unknown>)) {
          result[k] = v === true || v === "true" || v === "True";
        }
        return result;
      }
      return {};
    }
    return getPlatformEnabled(profile);
  });
  ipcMain.handle(
    "set-platform-enabled",
    async (_event, platform: string, enabled: boolean, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetPlatformEnabled(conn.ssh, platform, enabled, profile);
        return true;
      }
      if (isRemoteMode()) {
        const { ok, data } = await apiFetch("/api/config");
        if (!ok) return false;
        const cfg = (data as Record<string, unknown>) || {};
        if (!cfg.platforms || typeof cfg.platforms !== "object") {
          cfg.platforms = {};
        }
        (cfg.platforms as Record<string, unknown>)[platform] = enabled;
        await apiFetch("/api/config", { method: "PUT", body: { config: cfg } });
        return true;
      }
      setPlatformEnabled(platform, enabled, profile);
      // Restart gateway so it picks up the new platform config
      if (await isGatewayRunning()) {
        await restartGateway(profile);
      }
      return true;
    },
  );

  // Sessions
  ipcMain.handle("list-sessions", (_event, limit?: number, offset?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshListSessions(conn.ssh, limit, offset);
    return listSessions(limit, offset);
  });

  // Theta: files the agent produced (served from the server's workspace/vault)
  ipcMain.handle("files-info", async (_event, paths: string[]) => {
    if (!Array.isArray(paths) || paths.length === 0) return [];
    const { ok, data } = await apiFetch("/api/files/info", { method: "POST", body: { paths } });
    return ok ? ((data as { files?: unknown[] })?.files ?? []) : [];
  });
  ipcMain.handle("file-content", async (_event, path: string) => {
    const { ok, data } = await apiFetch("/api/files/content", { params: { path }, timeoutMs: 120000 });
    return ok ? data : null;
  });
  // Canvas: save edited text back to the server file.
  ipcMain.handle("save-file-content", async (_event, path: string, text: string) => {
    const { ok, data } = await apiFetch("/api/files/content", {
      method: "PUT",
      body: { path, text },
    });
    return ok ? { ok: true } : { ok: false, error: String((data as { detail?: string })?.detail || "Save failed") };
  });
  // Download: the user picks where to save it on this device.
  ipcMain.handle("save-file", async (event, path: string) => {
    const { ok, data } = await apiFetch("/api/files/content", { params: { path }, timeoutMs: 120000 });
    const file = data as { name?: string; data?: string } | null;
    if (!ok || !file?.data) return { ok: false, error: "Could not fetch the file from the server" };
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { defaultPath: file.name || "download" };
    const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    await writeFile(choice.filePath, Buffer.from(file.data, "base64"));
    return { ok: true, savedTo: choice.filePath };
  });

  // Theta: agent settings, conversation policy, model catalog, MCP servers
  ipcMain.handle("agent-settings", (_e, name: string) => thetaAgents.getAgentSettings(name));
  ipcMain.handle("update-agent-settings", (_e, name: string, patch) =>
    thetaAgents.updateAgentSettings(name, patch),
  );
  ipcMain.handle("agent-skills", (_e, name: string) => thetaAgents.getAgentSkills(name));
  ipcMain.handle("set-agent-skills", (_e, name: string, skills: Record<string, boolean>) =>
    thetaAgents.setAgentSkills(name, skills),
  );
  ipcMain.handle("install-skill-for", (_e, identifier: string, agents?: string[]) =>
    thetaAgents.installSkillFor(identifier, agents),
  );
  ipcMain.handle("session-policy", (_e, id: string) => thetaAgents.getSessionPolicy(id));
  ipcMain.handle("set-session-tool", (_e, id: string, toolset: string, enabled: boolean | null) =>
    thetaAgents.setSessionTool(id, toolset, enabled),
  );
  ipcMain.handle("set-session-project", (_e, id: string, project: string) =>
    thetaAgents.setSessionProject(id, project),
  );
  ipcMain.handle("list-projects", () => thetaAgents.listProjects());
  ipcMain.handle("list-model-options", () => thetaAgents.listModelOptions());
  ipcMain.handle("theta-list-mcp", () => thetaAgents.listMcp());
  ipcMain.handle("theta-add-mcp", (_e, server) => thetaAgents.addMcp(server));
  ipcMain.handle("theta-toggle-mcp", (_e, name: string, enabled: boolean) =>
    thetaAgents.toggleMcp(name, enabled),
  );
  ipcMain.handle("theta-delete-mcp", (_e, name: string) => thetaAgents.deleteMcp(name));

  // Theta: export a conversation as Markdown or PDF (save dialog)
  ipcMain.handle(
    "export-conversation",
    (event, kind: "md" | "pdf", fileName: string, markdown: string) => {
      if ((kind !== "md" && kind !== "pdf") || typeof markdown !== "string") {
        return { ok: false, error: "Invalid export request" };
      }
      return exportConversation(
        BrowserWindow.fromWebContents(event.sender),
        kind,
        String(fileName || `conversation.${kind}`),
        markdown,
      );
    },
  );

  // Theta: conversation list with management flags
  ipcMain.handle("list-conversations", (_event, limit?: number, archived?: boolean) =>
    listSessions(limit ?? 100, 0, Boolean(archived)),
  );
  ipcMain.handle(
    "update-session",
    (_event, sessionId: string, changes: { title?: string; pinned?: boolean; archived?: boolean }) =>
      updateSession(sessionId, changes),
  );

  // Theta: drop a user message and everything after it (edit / regenerate)
  ipcMain.handle("rewind-session", async (_event, sessionId: string, userTurn: number) => {
    if (typeof sessionId !== "string" || !sessionId) return false;
    const { ok } = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/rewind`, {
      method: "POST",
      body: { user_turn: userTurn },
    });
    return ok;
  });

  // Theta: current agent (and project) of a conversation, for the chat header
  ipcMain.handle("get-session-agent", async (_event, sessionId: string) => {
    if (typeof sessionId !== "string" || !sessionId) return null;
    try {
      const { ok, data } = await apiFetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/agent`,
      );
      return ok ? data : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle("get-session-messages", (_event, sessionId: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetSessionMessages(conn.ssh, sessionId);
    return getSessionMessages(sessionId);
  });

  ipcMain.handle("delete-session", async (_event, sessionId: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      return sshDeleteSession(conn.ssh, sessionId);
    }
    await deleteSession(sessionId);
  });

  // Profiles
  ipcMain.handle("list-profiles", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshListProfiles(conn.ssh);
    return listProfiles();
  });
  ipcMain.handle("create-profile", (_event, name: string, clone: boolean) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshCreateProfile(conn.ssh, name, clone);
    return createProfile(name, clone);
  });
  ipcMain.handle("delete-profile", (_event, name: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshDeleteProfile(conn.ssh, name);
    return deleteProfile(name);
  });
  ipcMain.handle("get-default-agent", () => getDefaultAgent());
  ipcMain.handle("set-active-profile", (_event, name: string) => {
    if (getConnectionConfig().mode !== "ssh") setActiveProfile(name);
    return true;
  });

  // Memory
  ipcMain.handle("read-memory", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshReadMemory(conn.ssh, profile);
    return readMemory(profile);
  });
  ipcMain.handle(
    "add-memory-entry",
    (_event, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshAddMemoryEntry(conn.ssh, content, profile);
      return addMemoryEntry(content, profile);
    },
  );
  ipcMain.handle(
    "update-memory-entry",
    (_event, index: number, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshUpdateMemoryEntry(conn.ssh, index, content, profile);
      return updateMemoryEntry(index, content, profile);
    },
  );
  ipcMain.handle(
    "remove-memory-entry",
    (_event, index: number, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshRemoveMemoryEntry(conn.ssh, index, profile);
      return removeMemoryEntry(index, profile);
    },
  );
  ipcMain.handle(
    "write-user-profile",
    (_event, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshWriteUserProfile(conn.ssh, content, profile);
      return writeUserProfile(content, profile);
    },
  );

  // Soul
  ipcMain.handle("read-soul", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshReadSoul(conn.ssh, profile);
    return readSoul(profile);
  });
  ipcMain.handle("write-soul", (_event, content: string, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshWriteSoul(conn.ssh, content, profile);
    return writeSoul(content, profile);
  });
  ipcMain.handle("reset-soul", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshResetSoul(conn.ssh, profile);
    return resetSoul(profile);
  });

  // Tools
  ipcMain.handle("get-toolsets", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetToolsets(conn.ssh, profile);
    return getToolsets(profile);
  });
  ipcMain.handle(
    "set-toolset-enabled",
    (_event, key: string, enabled: boolean, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshSetToolsetEnabled(conn.ssh, key, enabled, profile);
      return setToolsetEnabled(key, enabled, profile);
    },
  );

  // Skills
  ipcMain.handle("list-installed-skills", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshListInstalledSkills(conn.ssh, profile);
    return listInstalledSkills(profile);
  });
  ipcMain.handle("list-bundled-skills", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshListBundledSkills(conn.ssh);
    return listBundledSkills();
  });
  ipcMain.handle("get-skill-content", (_event, skillPath: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetSkillContent(conn.ssh, skillPath);
    return getSkillContent(skillPath);
  });
  ipcMain.handle(
    "install-skill",
    (_event, identifier: string, _profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshInstallSkill(conn.ssh, identifier);
      return installSkill(identifier, _profile);
    },
  );
  ipcMain.handle(
    "uninstall-skill",
    (_event, name: string, _profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshUninstallSkill(conn.ssh, name);
      return uninstallSkill(name, _profile);
    },
  );

  // Session cache (fast local cache with generated titles)
  ipcMain.handle(
    "list-cached-sessions",
    async (_event, limit?: number, offset?: number) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshListCachedSessions(conn.ssh, limit, offset);
      if (isRemoteMode()) return listSessions(limit, offset);
      return listCachedSessions(limit, offset);
    },
  );
  ipcMain.handle("sync-session-cache", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshListCachedSessions(conn.ssh, 50);
    if (isRemoteMode()) return listSessions(50, 0);
    return syncSessionCache();
  });
  ipcMain.handle(
    "update-session-title",
    async (_event, sessionId: string, title: string) => {
      const { ok } = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        body: { title },
      });
      return ok;
    },
  );

  // Session search
  ipcMain.handle("search-sessions", (_event, query: string, limit?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshSearchSessions(conn.ssh, query, limit);
    return searchSessions(query, limit);
  });

  // Credential Pool — profile-aware. When `profile` is omitted, the
  // credential pool helpers default to the currently active profile's
  // auth.json (see config.ts:authFilePath), so the renderer can pass an
  // explicit profile or rely on the active-profile fallback.
  ipcMain.handle("get-credential-pool", async (_event, profile?: string) => {
    const { ok, data } = await apiFetch("/api/credential-pool", {
      params: profile ? { profile } : undefined,
    });
    return ok ? ((data as { pool?: unknown })?.pool ?? {}) : {};
  });
  ipcMain.handle(
    "set-credential-pool",
    async (
      _event,
      provider: string,
      entries: Array<{ key: string; label: string }>,
      profile?: string,
    ) => {
      const { ok } = await apiFetch("/api/credential-pool", {
        method: "PUT",
        body: { provider, entries },
        params: profile ? { profile } : undefined,
      });
      return ok;
    },
  );

  // Models
  ipcMain.handle("list-models", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshListModels(conn.ssh);
    return listModels();
  });
  ipcMain.handle(
    "add-model",
    (
      _event,
      name: string,
      provider: string,
      model: string,
      baseUrl: string,
    ) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        return sshAddModel(conn.ssh, name, provider, model, baseUrl);
      }
      return addModel(name, provider, model, baseUrl);
    },
  );
  ipcMain.handle("remove-model", (_event, id: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshRemoveModel(conn.ssh, id);
    return removeModel(id);
  });
  ipcMain.handle(
    "update-model",
    (_event, id: string, fields: Record<string, string>) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshUpdateModel(conn.ssh, id, fields);
      return updateModel(id, fields);
    },
  );

  // Cron Jobs
  ipcMain.handle(
    "list-cron-jobs",
    (_event, includeDisabled?: boolean, profile?: string) =>
      listCronJobs(includeDisabled, profile),
  );
  ipcMain.handle(
    "create-cron-job",
    (
      _event,
      schedule: string,
      prompt?: string,
      name?: string,
      deliver?: string,
      profile?: string,
    ) => createCronJob(schedule, prompt, name, deliver, profile),
  );
  ipcMain.handle("remove-cron-job", (_event, jobId: string, profile?: string) =>
    removeCronJob(jobId, profile),
  );
  ipcMain.handle("pause-cron-job", (_event, jobId: string, profile?: string) =>
    pauseCronJob(jobId, profile),
  );
  ipcMain.handle("resume-cron-job", (_event, jobId: string, profile?: string) =>
    resumeCronJob(jobId, profile),
  );
  ipcMain.handle(
    "trigger-cron-job",
    (_event, jobId: string, profile?: string) => triggerCronJob(jobId, profile),
  );

  // Kanban
  ipcMain.handle(
    "kanban-list-boards",
    (_event, includeArchived?: boolean, profile?: string) =>
      kanbanListBoards(includeArchived, profile),
  );
  ipcMain.handle("kanban-current-board", (_event, profile?: string) =>
    kanbanCurrentBoard(profile),
  );
  ipcMain.handle(
    "kanban-switch-board",
    (_event, slug: string, profile?: string) =>
      kanbanSwitchBoard(slug, profile),
  );
  ipcMain.handle(
    "kanban-create-board",
    (
      _event,
      slug: string,
      name?: string,
      switchAfter?: boolean,
      profile?: string,
    ) => kanbanCreateBoard(slug, name, switchAfter, profile),
  );
  ipcMain.handle(
    "kanban-remove-board",
    (_event, slug: string, hardDelete?: boolean, profile?: string) =>
      kanbanRemoveBoard(slug, hardDelete, profile),
  );
  ipcMain.handle(
    "kanban-list-tasks",
    (
      _event,
      filters?: {
        status?: string;
        assignee?: string;
        tenant?: string;
        includeArchived?: boolean;
        profile?: string;
      },
    ) => kanbanListTasks(filters || {}),
  );
  ipcMain.handle(
    "kanban-get-task",
    (_event, taskId: string, profile?: string) =>
      kanbanGetTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-create-task",
    (_event, input: CreateTaskInput, profile?: string) =>
      kanbanCreateTask(input, profile),
  );
  ipcMain.handle("select-folder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle(
    "kanban-assign-task",
    (_event, taskId: string, assignee: string | null, profile?: string) =>
      kanbanAssignTask(taskId, assignee, profile),
  );
  ipcMain.handle(
    "kanban-complete-task",
    (_event, taskId: string, result?: string, profile?: string) =>
      kanbanCompleteTask(taskId, result, profile),
  );
  ipcMain.handle(
    "kanban-block-task",
    (_event, taskId: string, reason?: string, profile?: string) =>
      kanbanBlockTask(taskId, reason, profile),
  );
  ipcMain.handle(
    "kanban-unblock-task",
    (_event, taskId: string, profile?: string) =>
      kanbanUnblockTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-archive-task",
    (_event, taskId: string, profile?: string) =>
      kanbanArchiveTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-specify-task",
    (_event, taskId: string, profile?: string) =>
      kanbanSpecifyTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-reclaim-task",
    (_event, taskId: string, reason?: string, profile?: string) =>
      kanbanReclaimTask(taskId, reason, profile),
  );
  ipcMain.handle(
    "kanban-comment-task",
    (_event, taskId: string, body: string, profile?: string) =>
      kanbanCommentTask(taskId, body, profile),
  );
  ipcMain.handle(
    "kanban-dispatch-once",
    (_event, dryRun?: boolean, profile?: string) =>
      kanbanDispatchOnce(dryRun, profile),
  );

  // Config
  ipcMain.handle("get-full-config", () => getFullConfig());
  ipcMain.handle("save-full-config", (_event, config: Record<string, unknown>) =>
    saveFullConfig(config),
  );
  ipcMain.handle("get-config-schema", () => getConfigSchema());
  ipcMain.handle("get-config-defaults", () => getConfigDefaults());
  ipcMain.handle("get-config-raw", () => getConfigRaw());
  ipcMain.handle("save-config-raw", (_event, yamlText: string) =>
    saveConfigRaw(yamlText),
  );
  ipcMain.handle("restart-gateway-for-config", () => restartGatewayForConfig());

  // Plugins
  ipcMain.handle("get-plugins-hub", () => getPluginsHub());
  ipcMain.handle(
    "install-plugin",
    (_event, identifier: string, force?: boolean, enable?: boolean) =>
      installPlugin(identifier, force, enable),
  );
  ipcMain.handle("enable-plugin", (_event, name: string) => enablePlugin(name));
  ipcMain.handle("disable-plugin", (_event, name: string) =>
    disablePlugin(name),
  );
  ipcMain.handle("update-plugin", (_event, name: string) => updatePlugin(name));
  ipcMain.handle("remove-plugin", (_event, name: string) => removePlugin(name));
  ipcMain.handle(
    "save-plugin-providers",
    (_event, memoryProvider: string, contextEngine: string) =>
      savePluginProviders(memoryProvider, contextEngine),
  );
  ipcMain.handle(
    "set-plugin-visibility",
    (_event, name: string, hidden: boolean) =>
      setPluginVisibility(name, hidden),
  );

  // Shell
  ipcMain.handle("open-external", (_event, url: string) => {
    openExternalUrl(url);
  });

  // Backup / Import
  // Theta: backups are made on (and stay on) the server.
  ipcMain.handle("run-hermes-backup", async (_event, profile?: string) => {
    const { ok, data } = await apiFetch("/api/backup", {
      method: "POST",
      params: { profile: profile || "default" },
    });
    const d = (data as { path?: string; detail?: string }) || {};
    return ok
      ? { success: true, path: `server: ${d.path ?? ""}` }
      : { success: false, error: d.detail || "Backup failed on the server" };
  });
  // Import: the archive picked on this device is uploaded, then imported
  // by the server.
  ipcMain.handle(
    "run-hermes-import",
    async (_event, archivePath: string, profile?: string) => {
      try {
        const bytes = await readFile(archivePath);
        const name = archivePath.split(/[\\/]/).pop() || "import.zip";
        const serverPath = await uploadAttachment("imports", name, bytes.toString("base64"));
        const { ok, data } = await apiFetch("/api/import", {
          method: "POST",
          body: { archivePath: serverPath, profile: profile || "default" },
        });
        return ok
          ? { success: true }
          : { success: false, error: String((data as { detail?: string })?.detail || "Import failed") };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // Debug dump
  ipcMain.handle("run-hermes-dump", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshRunDump(conn.ssh);
    return "This runs on the server. Use the terminal there (e.g. `hermes dump`).";
  });

  // MCP servers
  ipcMain.handle("list-mcp-servers", async (_event, profile?: string) => {
    const { ok, data } = await apiFetch("/api/mcp/servers", {
      params: { profile: profile || "default" },
    });
    return ok ? ((data as { servers?: unknown[] })?.servers ?? []) : [];
  });

  // Memory providers
  ipcMain.handle("discover-memory-providers", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshDiscoverMemoryProviders(conn.ssh, profile);
    const { ok, data } = await apiFetch("/api/memory/providers", {
      params: { profile: profile || "default" },
    });
    return ok ? ((data as { providers?: unknown[] })?.providers ?? []) : [];
  });

  // Vault
  ipcMain.handle("vault:status", () => getVaultStatus());
  ipcMain.handle("vault:list-buckets", () => listVaultBuckets());
  ipcMain.handle("vault:browse", (_event, bucketId: string, path?: string) =>
    browseVaultBucket(bucketId, path),
  );
  ipcMain.handle(
    "vault:search",
    (
      _event,
      query: string,
      bucketId?: string,
      limit?: number,
      tokenBudget?: number,
      resultDepth?: "snippet" | "summary" | "full",
    ) => searchVault(query, bucketId, limit, tokenBudget, resultDepth),
  );
  ipcMain.handle(
    "vault:create-bucket",
    (_event, name: string, description?: string, customPath?: string) =>
      createVaultBucket(name, description, customPath),
  );
  ipcMain.handle("vault:delete-bucket", (_event, bucketId: string) =>
    deleteVaultBucket(bucketId),
  );
  ipcMain.handle(
    "vault:update-bucket",
    (_event, bucketId: string, name: string, description: string) =>
      updateVaultBucket(bucketId, name, description),
  );
  ipcMain.handle("vault:reindex", (_event, bucketId?: string, force?: boolean) =>
    reindexVault(bucketId, force),
  );
  ipcMain.handle("vault:tree", (_event, bucketId: string) => treeVaultBucket(bucketId));
  ipcMain.handle("vault:read-file", (_event, fullPath: string) => readVaultFile(fullPath));
  ipcMain.handle("vault:write-file", (_event, fullPath: string, content: string) =>
    writeVaultFile(fullPath, content),
  );
  ipcMain.handle("vault:move-item", (_event, fromPath: string, toDir: string) =>
    moveVaultItem(fromPath, toDir),
  );
  ipcMain.handle("vault:create-file", (_event, fullPath: string) => createVaultFile(fullPath));
  ipcMain.handle("vault:create-folder", (_event, fullPath: string) =>
    createVaultFolder(fullPath),
  );
  ipcMain.handle("vault:delete-item", (_event, fullPath: string, isDir: boolean) =>
    deleteVaultItem(fullPath, isDir),
  );
  ipcMain.handle("vault:get-links", (_event, bucketId: string) => getBucketLinks(bucketId));

  // Log viewer
  ipcMain.handle("read-logs", async (_event, logFile?: string, lines?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshReadLogs(conn.ssh, logFile, lines);
    const file = (logFile || "agent.log").replace(/\.log$/i, "");
    const { ok, data } = await apiFetch("/api/logs", {
      params: { file, lines: String(lines ?? 200) },
    });
    const logLines = ok ? ((data as { lines?: string[] })?.lines ?? []) : [];
    return { content: logLines.join("\n"), path: `server: logs/${file}.log` };
  });
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Chat",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: (): void => {
            mainWindow?.webContents.send("menu-new-chat");
          },
        },
        { type: "separator" },
        {
          label: "Search Sessions",
          accelerator: "CmdOrCtrl+K",
          click: (): void => {
            mainWindow?.webContents.send("menu-search-sessions");
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(is.dev
          ? [
              { type: "separator" as const },
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setupUpdater(): void {
  // IPC handlers must always be registered to avoid invoke errors
  ipcMain.handle("get-app-version", () => app.getVersion());

  if (!app.isPackaged) {
    // Skip auto-update in dev mode
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {});
    return;
  }

  // Dynamic import to avoid electron-updater issues in dev mode
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as {
    autoUpdater: AppUpdater;
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("update-download-progress", {
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-downloaded");
  });

  autoUpdater.on("error", (err) => {
    mainWindow?.webContents.send("update-error", err.message);
  });

  ipcMain.handle("check-for-updates", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo?.version || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle("download-update", async () => {
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mainWindow?.webContents.send("update-error", message);
      return false;
    }
  });

  ipcMain.handle("install-update", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

app.whenReady().then(() => {
  app.name = "Theta";
  electronApp.setAppUserModelId("com.nousresearch.hermes");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      hardenAttachedWebContents(contents);
    }
  });

  // Grant microphone permission for the Assistant voice visualizer
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (permission === "media") {
        callback(true);
      } else {
        callback(false);
      }
    },
  );

  buildMenu();
  setupIPC();
  createWindow();
  setupUpdater();

  // Auto-start SSH tunnel if configured
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh.host) {
    (async () => {
      if (!(await sshGatewayStatus(conn.ssh))) {
        await sshStartGateway(conn.ssh);
      }
      await startSshTunnel(conn.ssh);
      const key = await sshReadRemoteApiKey(conn.ssh);
      setSshRemoteApiKey(key);
    })().catch((err) => {
      console.error("[SSH TUNNEL] Failed to start on launch:", err);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Theta: the app is a client; closing it never stops the server.
    stopSshTunnel();
    app.quit();
  }
});

app.on("before-quit", () => {
  stopHealthPolling();
  if (currentChatAbort) {
    currentChatAbort();
    currentChatAbort = null;
  }
  stopSshTunnel();
});
