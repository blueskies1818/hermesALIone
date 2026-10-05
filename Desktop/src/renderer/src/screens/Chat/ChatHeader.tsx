import { memo } from "react";
import { Trash2 as Trash, Plus, Zap, Bot, Folder } from "lucide-react";
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
