import { memo, useEffect, useRef, useState } from "react";
import { Trash2 as Trash, Plus, Zap, Bot, Folder, Search, Download } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { UsageState } from "./types";

export interface SessionAgentInfo {
  agent: string;
  description: string;
  project: string | null;
}

interface ChatHeaderProps {
  sessionId: string | null;
  agentInfo?: SessionAgentInfo | null;
  usage: UsageState | null;
  fastMode: boolean;
  hasMessages: boolean;
  onToggleFast: () => void;
  onNewChat?: () => void;
  onClear: () => void;
  onFind?: () => void;
  onExport?: (kind: "md" | "pdf") => void;
}

function ExportMenu({ onExport }: { onExport: (kind: "md" | "pdf") => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const pick = (kind: "md" | "pdf"): void => { setOpen(false); onExport(kind); };
  return (
    <div className="chat-export" ref={ref}>
      <button className="btn-ghost chat-clear-btn" onClick={() => setOpen((o) => !o)} title="Export conversation">
        <Download size={16} />
      </button>
      {open && (
        <div className="chat-export-menu">
          <button onClick={() => pick("md")}>Markdown (.md)</button>
          <button onClick={() => pick("pdf")}>PDF (.pdf)</button>
        </div>
      )}
    </div>
  );
}

function UsageBadge({ usage }: { usage: UsageState }): React.JSX.Element {
  const tooltip =
    `Prompt: ${usage.promptTokens.toLocaleString()} | ` +
    `Completion: ${usage.completionTokens.toLocaleString()}` +
    (usage.cost != null ? ` | Cost: $${usage.cost.toFixed(4)}` : "");

  return (
    <span className="chat-token-counter" title={tooltip}>
      {usage.totalTokens.toLocaleString()} tokens
      {usage.cost != null && (
        <span className="chat-cost"> · ${usage.cost.toFixed(4)}</span>
      )}
    </span>
  );
}

export const ChatHeader = memo(function ChatHeader({
  sessionId,
  agentInfo,
  usage,
  fastMode,
  hasMessages,
  onToggleFast,
  onNewChat,
  onClear,
  onFind,
  onExport,
}: ChatHeaderProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="chat-header">
      <div className="chat-header-left">
        <div className="chat-header-title">
          {sessionId
            ? t("chat.sessionTitle", { id: sessionId.slice(-6) })
            : t("chat.title")}
        </div>
        {agentInfo && (
          <span
            className="chat-agent-chip"
            title={agentInfo.description || `Talking to ${agentInfo.agent}`}
          >
            <Bot size={12} />
            {agentInfo.agent === "default" ? "Theta" : agentInfo.agent}
          </span>
        )}
        {agentInfo?.project && (
          <span className="chat-agent-chip chat-project-chip" title="Project">
            <Folder size={12} />
            {agentInfo.project}
          </span>
        )}
        {usage && <UsageBadge usage={usage} />}
      </div>
      <div className="chat-header-actions">
        <div className="chat-fast-wrapper">
          <button
            className={`btn-ghost chat-fast-btn ${fastMode ? "chat-fast-active" : ""}`}
            onClick={onToggleFast}
          >
            <Zap size={14} />
          </button>
          <div className="chat-fast-popover">
            <strong>
              {fastMode ? t("chat.fastModeOn") : t("chat.fastMode")}
            </strong>
            <span>
              {fastMode ? t("chat.fastModeActive") : t("chat.fastModeInactive")}
            </span>
          </div>
        </div>
        {hasMessages && onFind && (
          <button className="btn-ghost chat-clear-btn" onClick={onFind} title="Find in conversation (Ctrl+F)">
            <Search size={16} />
          </button>
        )}
        {hasMessages && onExport && <ExportMenu onExport={onExport} />}
        {onNewChat && (
          <button
            className="btn-ghost chat-clear-btn"
            onClick={onNewChat}
            title={t("chat.newChat")}
          >
            <Plus size={16} />
          </button>
        )}
        {hasMessages && (
          <button
            className="btn-ghost chat-clear-btn"
            onClick={() => {
              if (window.confirm(t("chat.clearChatConfirm"))) onClear();
            }}
            title={t("chat.clearChat")}
          >
            <Trash size={16} />
          </button>
        )}
      </div>
    </div>
  );
});
