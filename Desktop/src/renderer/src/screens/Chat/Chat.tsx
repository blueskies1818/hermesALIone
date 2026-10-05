import { ArrowDown, Clock, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatHeader, type SessionAgentInfo } from "./ChatHeader";
import { CanvasContext, CanvasPanel, type CanvasFile } from "./Canvas";
import { FindBar } from "./FindBar";
import { isEditable } from "./MessageRow";
import { conversationMarkdown, conversationTitle, exportFileName } from "./exportChat";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatIPC } from "./hooks/useChatIPC";
import { useChatActions } from "./hooks/useChatActions";
import { useModelConfig } from "./hooks/useModelConfig";
import { useFastMode } from "./hooks/useFastMode";
import { useLocalCommands } from "./hooks/useLocalCommands";
import { useI18n } from "../../components/useI18n";
import type { Attachment, ChatMessage, UsageState } from "./types";

interface QueuedMessage {
  id: string;
  text: string;
  attachments?: Attachment[];
}

export type { ChatMessage } from "./types";

interface ChatProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId: string | null;
  profile?: string;
  onSessionStarted?: () => void;
  onNewChat?: () => void;
}

function Chat({
  messages,
  setMessages,
  sessionId,
  profile,
  onSessionStarted,
  onNewChat,
}: ChatProps): React.JSX.Element {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const [hermesSessionId, setHermesSessionId] = useState<string | null>(null);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [remoteMode, setRemoteMode] = useState(false);
  const dragCounter = useRef(0);
  const chatInputRef = useRef<ChatInputHandle>(null);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      const flag = await window.hermesAPI.isRemoteMode();
      if (!cancelled) setRemoteMode(flag);
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  const { containerRef, bottomRef, isAwayFromBottom, jumpToBottom } = useChatScroll(messages);
  const modelConfig = useModelConfig(profile);
  const {
    fastMode,
    toggle: toggleFastMode,
    set: setFastTier,
  } = useFastMode(profile);

  useChatIPC({
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setStreamStarted,
    setUsage,
  });

  // Reset hermes session when the parent clears messages (new chat).
  // Effect-driven sync because `messages` is owned by the parent; a key-based
  // remount would discard unrelated local state (model picker, etc.).
  useEffect(() => {
    if (messages.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHermesSessionId(null);
    }
  }, [messages]);

  // Ctrl+F → find in this conversation (only while the chat tab is shown)
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && containerRef.current?.offsetParent) {
        e.preventDefault();
        setFindOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [containerRef]);

  const handleEditLast = useCallback((): boolean => {
    if (isLoading || !messages.some(isEditable)) return false;
    setEditLastSignal((n) => n + 1);
    return true;
  }, [isLoading, messages]);

  const handleExport = useCallback(
    async (kind: "md" | "pdf") => {
      const title = conversationTitle(messages);
      const result = await window.hermesAPI.exportConversation(
        kind,
        exportFileName(title, kind),
        conversationMarkdown(messages, title),
      );
      if (!result.ok && !result.canceled) window.alert(`Export failed: ${result.error || "unknown error"}`);
    },
    [messages],
  );

  // Cmd/Ctrl+N → new chat
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        onNewChat?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNewChat]);

  const addAgentMessage = useCallback(
    (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: `agent-local-${Date.now()}`, role: "agent", content },
      ]);
    },
    [setMessages],
  );

  const handleClear = useCallback(() => {
    if (isLoading) {
      window.hermesAPI.abortChat();
      setIsLoading(false);
    }
    setStreamStarted(false);
    const idToDelete = hermesSessionId ?? sessionId;
    if (idToDelete) {
      void window.hermesAPI.deleteSession(idToDelete);
      void window.hermesAPI.clearStagedAttachments(idToDelete);
    }
    setMessages([]);
    setHermesSessionId(null);
    setUsage(null);
    setToolProgress(null);
  }, [isLoading, hermesSessionId, sessionId, setMessages, setStreamStarted]);

  const localCommands = useLocalCommands({
    profile,
    usage,
    setFastMode: setFastTier,
    onNewChat,
    onClear: handleClear,
    addAgentMessage,
  });

  // Use the IPC-assigned session ID when active; fall back to the resumed
  // session prop so that replies continue the correct session.
  const effectiveSessionId = hermesSessionId ?? sessionId;

  // Theta: canvas side panel for files the agent wrote
  const [canvasFile, setCanvasFile] = useState<CanvasFile | null>(null);
  // Theta: find in conversation (Ctrl+F) and Up-to-edit-last
  const [findOpen, setFindOpen] = useState(false);
  const [editLastSignal, setEditLastSignal] = useState(0);

  // Theta: show which agent this conversation is talking to (and its
  // project). Refreshed after each reply and right after an agent switch.
  const [agentInfo, setAgentInfo] = useState<SessionAgentInfo | null>(null);
  const refreshAgentInfo = useCallback(() => {
    if (!effectiveSessionId) { setAgentInfo(null); return; }
    window.hermesAPI.getSessionAgent(effectiveSessionId)
      .then((info) => setAgentInfo(info))
      .catch(() => {});
  }, [effectiveSessionId]);
  useEffect(() => { refreshAgentInfo(); }, [refreshAgentInfo]);
  useEffect(() => {
    const offDone = window.hermesAPI.onChatDone(() => refreshAgentInfo());
    const offTool = window.hermesAPI.onChatToolProgress((tool) => {
      if (tool && /now talking to|set_project|switch_agent/i.test(tool)) refreshAgentInfo();
    });
    return () => { offDone(); offTool(); };
  }, [refreshAgentInfo]);

  const actions = useChatActions({
    profile,
    hermesSessionId: effectiveSessionId,
    messages,
    isLoading,
    setIsLoading,
    setStreamStarted,
    setMessages,
    onSessionStarted,
    chatInputRef,
    localCommands,
  });

  const handleSuggestion = useCallback((text: string) => {
    chatInputRef.current?.setText(text);
  }, []);

  // Theta: messages sent while the agent works wait in a queue and go out
  // in order when the turn ends; follow-up suggestions after each reply.
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const followUpSeq = useRef(0);
  const abortedRef = useRef(false);
  const wasLoading = useRef(false);
  const { handleSend, handleAbort } = actions;

  const handleSubmit = useCallback(
    (text: string, attachments?: Attachment[]) => {
      followUpSeq.current++;
      setFollowUps([]);
      if (isLoading) {
        setQueue((q) => [...q, { id: `queued-${Date.now()}`, text, attachments }]);
        return;
      }
      void handleSend(text, attachments);
    },
    [isLoading, handleSend],
  );

  const handleStop = useCallback(() => {
    abortedRef.current = true;
    if (queue.length) {
      // Give queued drafts back instead of dropping them.
      chatInputRef.current?.setText(queue.map((q) => q.text).filter(Boolean).join("\n\n"));
      setQueue([]);
    }
    handleAbort();
  }, [queue, handleAbort]);

  useEffect(() => {
    const ended = wasLoading.current && !isLoading;
    wasLoading.current = isLoading;
    if (!ended) return;
    const aborted = abortedRef.current;
    abortedRef.current = false;

    const last = messages[messages.length - 1];
    const isReply = last?.role === "agent" && !/^(error|agent-local)-/.test(last.id);
    const model = modelConfig.displayModel;
    if (isReply && model && !last.model) {
      setMessages((prev) =>
        prev.map((m) => (m.id === last.id ? { ...m, model } : m)),
      );
    }
    if (queue.length) {
      const [next, ...rest] = queue;
      setQueue(rest);
      void handleSend(next.text, next.attachments);
      return;
    }
    if (aborted || !isReply || !last.content.trim()) return;
    const user = [...messages].reverse().find((m) => m.role === "user");
    const seq = ++followUpSeq.current;
    window.hermesAPI
      .followUpSuggestions(user?.content || "", last.content)
      .then((list) => { if (seq === followUpSeq.current) setFollowUps(list); })
      .catch(() => {});
    // Only the loading edge matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // A new or switched conversation starts without stale suggestions.
  useEffect(() => {
    followUpSeq.current++;
    setFollowUps([]);
  }, [effectiveSessionId]);

  // Drag-and-drop: filter for dragenter events carrying files (suppresses
  // text-drag noise from the textarea autocomplete and other in-app drags).
  const eventHasFiles = useCallback((e: React.DragEvent): boolean => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "Files") return true;
    }
    return false;
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      dragCounter.current += 1;
      if (dragCounter.current === 1) setDragActive(true);
    },
    [eventHasFiles],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    },
    [eventHasFiles],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      dragCounter.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      void chatInputRef.current?.addFiles(files);
    },
    [eventHasFiles],
  );

  return (
    <CanvasContext.Provider value={setCanvasFile}>
    <div
      className={`chat-container${canvasFile ? " chat-container--canvas" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ChatHeader
        sessionId={sessionId}
        agentInfo={agentInfo}
        usage={usage}
        fastMode={fastMode}
        hasMessages={messages.length > 0}
        onToggleFast={toggleFastMode}
        onNewChat={onNewChat}
        onClear={handleClear}
        onFind={() => setFindOpen(true)}
        onExport={handleExport}
      />
      {findOpen && (
        <FindBar containerRef={containerRef} contentKey={messages} onClose={() => setFindOpen(false)} />
      )}

      <div className="chat-messages" ref={containerRef}>
        {messages.length === 0 ? (
          <ChatEmptyState onSelectSuggestion={handleSuggestion} />
        ) : (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            streamStarted={streamStarted}
            toolProgress={toolProgress}
            onApprove={actions.handleApprove}
            onDeny={actions.handleDeny}
            onRegenerate={actions.handleRegenerate}
            onEdit={actions.handleEdit}
            editLastSignal={editLastSignal}
          />
        )}
        {!isLoading && followUps.length > 0 && messages.length > 0 && (
          <div className="chat-followups">
            {followUps.map((f) => (
              <button key={f} className="chat-followup" onClick={() => handleSubmit(f)}>
                {f}
              </button>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {isAwayFromBottom && (
        <button className="chat-jump-bottom" onClick={jumpToBottom} title="Jump to latest">
          <ArrowDown size={16} />
        </button>
      )}

      <div className="chat-input-area">
        {queue.length > 0 && (
          <div className="chat-queue">
            {queue.map((q) => (
              <div key={q.id} className="chat-queue-item" title="Sends when the current reply finishes">
                <Clock size={12} />
                <span>{q.text || `${q.attachments?.length ?? 0} attachment(s)`}</span>
                <button
                  onClick={() => setQueue((all) => all.filter((x) => x.id !== q.id))}
                  title="Remove from queue"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <ChatInput
          ref={chatInputRef}
          isLoading={isLoading}
          hasSession={!!effectiveSessionId}
          sessionId={effectiveSessionId}
          remoteMode={remoteMode}
          onSubmit={handleSubmit}
          onQuickAsk={actions.handleQuickAsk}
          onAbort={handleStop}
          onEditLast={handleEditLast}
        />
        <ModelPicker
          currentModel={modelConfig.currentModel}
          currentProvider={modelConfig.currentProvider}
          currentBaseUrl={modelConfig.currentBaseUrl}
          modelGroups={modelConfig.modelGroups}
          displayModel={modelConfig.displayModel}
          onOpen={modelConfig.reload}
          onSelectModel={modelConfig.selectModel}
        />
      </div>
      {dragActive && (
        <div className="chat-drop-overlay" aria-hidden>
          <div className="chat-drop-overlay-inner">
            {t("chat.dropToAttach")}
          </div>
        </div>
      )}
      {canvasFile && <CanvasPanel file={canvasFile} onClose={() => setCanvasFile(null)} />}
    </div>
    </CanvasContext.Provider>
  );
}

export default Chat;
