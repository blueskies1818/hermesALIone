import { memo, useMemo } from "react";
import { HermesAvatar, MessageRow } from "./MessageRow";
import type { ChatMessage } from "./types";

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  streamStarted: boolean;
  toolProgress: string | null;
  onApprove: () => void;
  onDeny: () => void;
  onRegenerate?: () => void;
  onEdit?: (messageId: string, text: string) => void;
}

function TypingIndicator({
  toolProgress,
}: {
  toolProgress: string | null;
}): React.JSX.Element {
  return (
    <div className="chat-message chat-message-agent">
      <HermesAvatar />
      <div className="chat-bubble chat-bubble-agent">
        {toolProgress ? (
          <div className="chat-tool-progress">{toolProgress}</div>
        ) : (
          <div className="chat-typing">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageList = memo(function MessageList({
  messages,
  isLoading,
  streamStarted,
  toolProgress,
  onApprove,
  onDeny,
  onRegenerate,
  onEdit,
}: MessageListProps): React.JSX.Element {
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) => (m.content || "").trim() || (m.steps?.length ?? 0) > 0 || (m.reasoning || "").trim(),
      ),
    [messages],
  );

  const lastMessageIsAgent =
    messages.length > 0 && messages[messages.length - 1].role === "agent";

  return (
    <>
      {visibleMessages.map((msg, i) => (
        <MessageRow
          key={msg.id}
          msg={msg}
          isLast={i === visibleMessages.length - 1}
          isLoading={isLoading}
          onApprove={onApprove}
          onDeny={onDeny}
          onRegenerate={onRegenerate}
          onEdit={onEdit}
        />
      ))}

      {isLoading && !lastMessageIsAgent && (
        <TypingIndicator toolProgress={streamStarted ? toolProgress : null} />
      )}

      {isLoading && streamStarted && toolProgress && lastMessageIsAgent && (
        <div className="chat-tool-progress-inline">{toolProgress}</div>
      )}
    </>
  );
});
