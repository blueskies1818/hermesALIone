import { useState, useCallback, useEffect } from "react";
import Chat, { ChatMessage } from "../Chat/Chat";
import Agents from "../Agents/Agents";
import Soul from "../Soul/Soul";
import Memory from "../Memory/Memory";
import Tools from "../Tools/Tools";
import Assistant from "../Assistant/Assistant";
import Gateway from "../Gateway/Gateway";
import Office from "../Office/Office";
import Kanban from "../Kanban/Kanban";
import Sessions from "../Sessions/Sessions";
import Schedules from "../Schedules/Schedules";
import Vault from "../Vault/Vault";
import Config from "../Config/Config";
import Plugins from "../Plugins/Plugins";
import { useTheme } from "../../components/ThemeProvider";
import hermeslogo from "../../assets/hermes.png";
import {
  ChatBubble,
  Clock,
  Users,
  Sparkles,
  Wrench,
  Signal,
  Kanban as KanbanIcon,
  Download,
  Sun,
  Moon,
  Monitor,
  ExternalLink,
  Timer,
  Headphones,
  KeyRound,
  Settings,
  Puzzle,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../../components/useI18n";

type View =
  | "chat"
  | "agents"
  | "soul"
  | "memory"
  | "tools"
  | "kanban"
  | "gateway"
  | "office"
  | "sessions"
  | "schedules"
  | "vault"
  | "config"
  | "plugins"
  | "assistant";

type ConnectMode = "local" | "remote" | "ssh";

const NAV_GENERAL: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "chat", icon: ChatBubble, labelKey: "navigation.chat" },
  { view: "sessions", icon: Clock, labelKey: "navigation.sessions" },
  { view: "soul", icon: Sparkles, labelKey: "navigation.soul" },
  { view: "agents", icon: Users, labelKey: "navigation.agents" },
  { view: "vault", icon: KeyRound, labelKey: "navigation.vault" },
  { view: "kanban", icon: KanbanIcon, labelKey: "navigation.kanban" },
  { view: "schedules", icon: Timer, labelKey: "navigation.schedules" },
  { view: "assistant", icon: Headphones, labelKey: "navigation.assistant" },
];

const NAV_SETTINGS: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "tools", icon: Wrench, labelKey: "navigation.tools" },
  { view: "plugins", icon: Puzzle, labelKey: "navigation.plugins" },
  { view: "gateway", icon: Signal, labelKey: "navigation.gateway" },
  { view: "config", icon: Settings, labelKey: "navigation.config" },
];

interface LayoutProps {
  onDisconnect: () => void;
}

function Layout({ onDisconnect }: LayoutProps): React.JSX.Element {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState("default");
  // Tabs lazy-mount on first visit, then stay mounted (display:none toggle).
  // Keeps IPC refetch / DOM rebuild off the tab-switch hot path.
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["chat"]),
  );
  const [connectMode, setConnectMode] = useState<ConnectMode>("local");

  const paneStyle = (target: View): React.CSSProperties => ({
    display: view === target ? "flex" : "none",
    flex: 1,
    flexDirection: "column",
    overflow: "hidden",
  });

  const goTo = useCallback((v: View) => {
    setVisitedViews((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
    setView(v);
  }, []);

  // Re-check connection mode on tab switch (picks up Settings changes)
  useEffect(() => {
    window.hermesAPI
      .getConnectionConfig()
      .then((cfg) => setConnectMode(cfg.mode))
      .catch(() => {});
  }, [view]);

  // Auto-update state
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<
    "available" | "downloading" | "ready" | "error" | null
  >(null);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setUpdateVersion(info.version);
      setUpdateState("available");
      setUpdateError(null);
      setDownloadPercent(0);
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress(
      (info) => {
        setDownloadPercent(info.percent);
      },
    );
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setUpdateState("ready");
      setUpdateError(null);
    });
    const cleanupError = window.hermesAPI.onUpdateError((message) => {
      setUpdateState("error");
      setUpdateError(message);
      setDownloadPercent(0);
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  async function handleUpdate(): Promise<void> {
    if (updateState === "available" || updateState === "error") {
      setUpdateError(null);
      setDownloadPercent(0);
      setUpdateState("downloading");
      try {
        const ok = await window.hermesAPI.downloadUpdate();
        if (!ok) setUpdateState("error");
      } catch (err) {
        setUpdateError(err instanceof Error ? err.message : String(err));
        setUpdateState("error");
      }
    } else if (updateState === "ready") {
      await window.hermesAPI.installUpdate();
    }
  }

  const handleNewChat = useCallback(() => {
    // Abort any in-flight chat before clearing
    window.hermesAPI.abortChat();
    setMessages([]);
    setCurrentSessionId(null);
    goTo("chat");
  }, [goTo]);

  const handleSelectProfile = useCallback((name: string) => {
    setActiveProfile(name);
    setMessages([]);
    setCurrentSessionId(null);
  }, []);

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    },
    [currentSessionId],
  );

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      setCurrentSessionId(sessionId);
      setMessages([]);
      goTo("chat");
      const raw = await window.hermesAPI.getSessionMessages(sessionId);
      setMessages(
        raw
          .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
          .map((m) => ({
            id: String(m.id),
            role: (m.role === "assistant" ? "agent" : "user") as "agent" | "user",
            content: m.content,
            ...(m.attachments ? { attachments: m.attachments } : {}),
          })),
      );
    },
    [goTo, setMessages],
  );

  // Listen for menu IPC events (Cmd+N, Cmd+K from app menu)
  useEffect(() => {
    const cleanupNewChat = window.hermesAPI.onMenuNewChat(() => {
      handleNewChat();
    });
    return () => {
      cleanupNewChat();
    };
  }, [handleNewChat, goTo]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={hermeslogo} height={30} alt="" />
        </div>

        <nav className="sidebar-nav">
          {NAV_GENERAL.map(({ view: v, icon: Icon, labelKey }) => (
            <button
              key={v}
              className={`sidebar-nav-item ${view === v ? "active" : ""}`}
              onClick={() => goTo(v)}
            >
              <Icon size={16} />
              {t(labelKey)}
            </button>
          ))}
          <div className="sidebar-divider" />
          {NAV_SETTINGS.map(({ view: v, icon: Icon, labelKey }) => (
            <button
              key={v}
              className={`sidebar-nav-item ${view === v ? "active" : ""}`}
              onClick={() => goTo(v)}
            >
              <Icon size={16} />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className="connection-indicator"
            onClick={onDisconnect}
            title={t("connect.tabLocal")}
          >
            <span className={`connection-dot connection-dot-${connectMode}`} />
            <span className="connection-label">
              {connectMode === "local"
                ? t("connect.tabLocal")
                : connectMode === "remote"
                  ? t("connect.tabRemote")
                  : t("connect.tabSsh")}
            </span>
          </button>

          <button
            className="sidebar-nav-item dashboard-link"
            onClick={() => window.hermesAPI.openExternal("http://127.0.0.1:9119")}
            title="Open Dashboard"
          >
            <ExternalLink size={16} />
            Dashboard
          </button>
          {updateState && (
            <button
              className={`sidebar-update-btn ${
                updateState === "error" ? "error" : ""
              }`}
              onClick={handleUpdate}
              disabled={updateState === "downloading"}
              title={updateError ?? undefined}
            >
              <Download size={13} />
              {updateState === "available" && (
                <span>
                  {t("common.updateAvailable", { version: updateVersion })}
                </span>
              )}
              {updateState === "downloading" && (
                <span>
                  {t("common.downloading", { percent: downloadPercent })}
                </span>
              )}
              {updateState === "ready" && (
                <span>{t("common.restartToUpdate")}</span>
              )}
              {updateState === "error" && (
                <span>{t("common.updateFailed")}</span>
              )}
            </button>
          )}
          <div className="theme-switcher">
            <button
              className={`theme-switcher-btn ${theme === "light" ? "active" : ""}`}
              onClick={() => setTheme("light")}
              title="Light"
            >
              <Sun size={14} />
            </button>
            <button
              className={`theme-switcher-btn ${theme === "dark" ? "active" : ""}`}
              onClick={() => setTheme("dark")}
              title="Dark"
            >
              <Moon size={14} />
            </button>
            <button
              className={`theme-switcher-btn ${theme === "system" ? "active" : ""}`}
              onClick={() => setTheme("system")}
              title="System"
            >
              <Monitor size={14} />
            </button>
          </div>
          <div className="sidebar-footer-text">
            {activeProfile === "default" ? t("common.appName") : activeProfile}
          </div>
        </div>
      </aside>

      <main className="content">
        <div style={paneStyle("chat")}>
          <Chat
            messages={messages}
            setMessages={setMessages}
            sessionId={currentSessionId}
            profile={activeProfile}
            onNewChat={handleNewChat}
          />
        </div>

        {visitedViews.has("agents") && (
          <div style={paneStyle("agents")}>
            <Agents
              activeProfile={activeProfile}
              onSelectProfile={handleSelectProfile}
              onChatWith={(name: string) => {
                handleSelectProfile(name);
                goTo("chat");
              }}
            />
          </div>
        )}

        {visitedViews.has("soul") && (
          <div style={paneStyle("soul")}>
            <Soul profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("memory") && (
          <div style={paneStyle("memory")}>
            <Memory profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("tools") && (
          <div style={paneStyle("tools")}>
            <Tools profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("kanban") && (
          <div style={paneStyle("kanban")}>
            <Kanban profile={activeProfile} visible={view === "kanban"} />
          </div>
        )}

        {visitedViews.has("gateway") && (
          <div style={paneStyle("gateway")}>
            <Gateway profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("office") && (
          <div style={paneStyle("office")}>
            <Office profile={activeProfile} visible={view === "office"} />
          </div>
        )}

        {visitedViews.has("sessions") && (
          <div style={paneStyle("sessions")}>
            <Sessions
              onResumeSession={handleResumeSession}
              onNewChat={handleNewChat}
              onDeleteSession={handleDeleteSession}
              currentSessionId={currentSessionId}
              visible={view === "sessions"}
            />
          </div>
        )}

        {visitedViews.has("schedules") && (
          <div style={paneStyle("schedules")}>
            <Schedules profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("vault") && (
          <div style={paneStyle("vault")}>
            <Vault profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("config") && (
          <div style={paneStyle("config")}>
            <Config profile={activeProfile} visible={view === "config"} />
          </div>
        )}

        {visitedViews.has("plugins") && (
          <div style={paneStyle("plugins")}>
            <Plugins profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("assistant") && (
          <div style={paneStyle("assistant")}>
            <Assistant profile={activeProfile} />
          </div>
        )}
      </main>
    </div>
  );
}

export default Layout;
