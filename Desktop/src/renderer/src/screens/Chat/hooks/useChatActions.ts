import { useCallback, useEffect, useRef } from "react";
import type { ChatInputHandle } from "../ChatInput";
import type { Attachment, ChatMessage } from "../types";

interface LocalCommands {
  isLocal: (text: string) => boolean;
  executeLocal: (text: string) => Promise<boolean>;
}

interface UseChatActionsArgs {
  profile?: string;
  hermesSessionId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  setStreamStarted: (started: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onSessionStarted?: () => void;
  chatInputRef: React.RefObject<ChatInputHandle | null>;
  localCommands: LocalCommands;
}

interface UseChatActionsResult {
  handleSend: (text: string, attachments?: Attachment[]) => Promise<void>;
  handleQuickAsk: (text: string, attachments?: Attachment[]) => Promise<void>;
  handleAbort: () => void;
  handleApprove: () => void;
  handleDeny: () => void;
  handleRegenerate: () => Promise<void>;
  handleEdit: (messageId: string, text: string) => Promise<void>;
}

/** User messages the server stored (local slash-command echoes are not). */
function isServerUserMessage(m: ChatMessage): boolean {
  return m.role === "user" && !m.id.startsWith("local-");
}

/**
 * Encapsulates the chat's user-facing actions (send, quick-ask, abort,
 * approve, deny). All returned callbacks have stable identities so that
 * memoized children don't re-render on every streaming chunk — `messages`
 * and `isLoading` are read via live refs that update via `useEffect`.
 */
export function useChatActions({
  profile,
  hermesSessionId,
  messages,
  isLoading,
  setIsLoading,
  setStreamStarted,
  setMessages,
  onSessionStarted,
  chatInputRef,
  localCommands,
}: UseChatActionsArgs): UseChatActionsResult {
  const messagesRef = useRef(messages);
  const isLoadingRef = useRef(isLoading);
  useEffect(() => {
    messagesRef.current = messages;
    isLoadingRef.current = isLoading;
  });

  const pushUser = useCallback(
    (content: string, idPrefix = "user", attachments?: Attachment[]) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${idPrefix}-${Date.now()}`,
          role: "user",
          content,
          createdAt: Date.now(),
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        },
      ]);
    },
    [setMessages],
  );

  const sendToAgent = useCallback(
    async (text: string, attachments?: Attachment[]): Promise<void> => {
      try {
        await window.hermesAPI.sendMessage(
          text,
          profile,
          hermesSessionId || undefined,
          messagesRef.current.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          attachments,
        );
      } catch {
        // onChatError IPC already surfaces this to the user
      }
    },
    [profile, hermesSessionId],
  );

  const handleSend = useCallback(
    async (text: string, attachments?: Attachment[]): Promise<void> => {
      const hasPayload = text.length > 0 || (attachments?.length ?? 0) > 0;
      if (!hasPayload || isLoadingRef.current) return;

      if (text && localCommands.isLocal(text)) {
        const cmd = text.split(/\s+/)[0].toLowerCase();
        if (cmd !== "/new" && cmd !== "/clear") pushUser(text, "local");
        await localCommands.executeLocal(text);
        return;
      }

      setIsLoading(true);
      setStreamStarted(false);
      pushUser(text, "user", attachments);
      onSessionStarted?.();
      await sendToAgent(text, attachments);
    },
    [localCommands, pushUser, onSessionStarted, sendToAgent, setIsLoading],
  );

  const handleQuickAsk = useCallback(
    async (text: string, attachments?: Attachment[]): Promise<void> => {
      if (!text || isLoadingRef.current) return;
      setIsLoading(true);
      setStreamStarted(false);
      pushUser(`💭 ${text}`, "user-btw", attachments);
      await sendToAgent(`/btw ${text}`, attachments);
    },
    [pushUser, sendToAgent, setIsLoading],
  );

  const handleAbort = useCallback(() => {
    window.hermesAPI.abortChat();
    setIsLoading(false);
    setStreamStarted(false);
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }, [chatInputRef, setIsLoading, setStreamStarted]);

  const handleApprove = useCallback(() => {
    chatInputRef.current?.clear();
    setIsLoading(true);
    setStreamStarted(false);
    pushUser("/approve", "user-approve");
    sendToAgent("/approve").catch(() => setIsLoading(false));
  }, [chatInputRef, pushUser, sendToAgent, setIsLoading, setStreamStarted]);

  const handleDeny = useCallback(() => {
    chatInputRef.current?.clear();
    setIsLoading(true);
    setStreamStarted(false);
    pushUser("/deny", "user-deny");
    sendToAgent("/deny").catch(() => setIsLoading(false));
  }, [chatInputRef, pushUser, sendToAgent, setIsLoading, setStreamStarted]);

  /**
   * Theta: cut the conversation at a user message (on the server too) and
   * send that message again, optionally with new text. Used by regenerate
   * and edit-and-resend.
   */
  const resendFrom = useCallback(
    async (index: number, text: string, attachments?: Attachment[]): Promise<void> => {
      if (isLoadingRef.current) return;
      const current = messagesRef.current;
      const userTurn = current.slice(0, index).filter(isServerUserMessage).length;
      if (hermesSessionId) {
        const ok = await window.hermesAPI.rewindSession(hermesSessionId, userTurn);
        if (!ok) {
          setMessages((prev) => [
            ...prev,
            { id: `error-${Date.now()}`, role: "agent", content: "Error: could not rewind the conversation on the server." },
          ]);
          return;
        }
      }
      const kept = current.slice(0, index);
      messagesRef.current = kept;
      setMessages(kept);
      setIsLoading(true);
      setStreamStarted(false);
      pushUser(text, "user", attachments);
      await sendToAgent(text, attachments);
    },
    [hermesSessionId, pushUser, sendToAgent, setIsLoading, setMessages, setStreamStarted],
  );

  const handleRegenerate = useCallback(async (): Promise<void> => {
    const current = messagesRef.current;
    for (let i = current.length - 1; i >= 0; i--) {
      if (isServerUserMessage(current[i])) {
        await resendFrom(i, current[i].content, current[i].attachments);
        return;
      }
    }
  }, [resendFrom]);

  const handleEdit = useCallback(
    async (messageId: string, text: string): Promise<void> => {
      const current = messagesRef.current;
      const index = current.findIndex((m) => m.id === messageId);
      if (index < 0 || !text.trim()) return;
      await resendFrom(index, text.trim(), current[index].attachments);
    },
    [resendFrom],
  );

  return {
    handleSend,
    handleQuickAsk,
    handleAbort,
    handleApprove,
    handleDeny,
    handleRegenerate,
    handleEdit,
  };
}
