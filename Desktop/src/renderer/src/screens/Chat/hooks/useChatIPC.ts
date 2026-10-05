import { useEffect } from "react";
import type { ChatMessage, ToolStep, UsageState } from "../types";

/** Apply `fn` to the reply being built this turn, creating it if needed. */
function updateCurrentReply(
  prev: ChatMessage[],
  fn: (msg: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "agent") return [...prev.slice(0, -1), fn(last)];
  return [...prev, fn({ id: `agent-${Date.now()}`, role: "agent", content: "" })];
}

interface UseChatIPCArgs {
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setHermesSessionId: (id: string) => void;
  setToolProgress: (tool: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setStreamStarted: (started: boolean) => void;
  setUsage: React.Dispatch<React.SetStateAction<UsageState | null>>;
}

/**
 * Registers all chat-related IPC listeners once and tears them down on unmount.
 *
 * Each listener writes through the provided setters; consumers should pass
 * stable `useState`/`useDispatch` setters (React guarantees identity).
 */
export function useChatIPC({
  setMessages,
  setHermesSessionId,
  setToolProgress,
  setIsLoading,
  setStreamStarted,
  setUsage,
}: UseChatIPCArgs): void {
  useEffect(() => {
    const cleanupChunk = window.hermesAPI.onChatChunk((chunk) => {
      setStreamStarted(true);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "agent") {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        }
        // Skip empty initial chunks so we don't create an empty bubble
        if (!chunk || !chunk.trim()) return prev;
        return [
          ...prev,
          { id: `agent-${Date.now()}`, role: "agent", content: chunk },
        ];
      });
    });

    const cleanupDone = window.hermesAPI.onChatDone((sessionId) => {
      if (sessionId) setHermesSessionId(sessionId);
      setToolProgress(null);
      setStreamStarted(false);
      setIsLoading(false);
    });

    const cleanupError = window.hermesAPI.onChatError((error) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "agent",
          content: `Error: ${error}`,
        },
      ]);
      setToolProgress(null);
      setStreamStarted(false);
      setIsLoading(false);
    });

    // Theta: steps panel + thinking section on the reply being built.
    const cleanupToolEvent = window.hermesAPI.onChatToolEvent((raw) => {
      const ev = raw as {
        tool?: string; label?: string; emoji?: string; toolCallId?: string;
        status?: string; args?: string; result?: string;
      };
      if (!ev.toolCallId) return;
      setStreamStarted(true);
      setMessages((prev) =>
        updateCurrentReply(prev, (msg) => {
          const steps = [...(msg.steps ?? [])];
          const i = steps.findIndex((s) => s.id === ev.toolCallId);
          if (ev.status === "completed") {
            if (i >= 0) steps[i] = { ...steps[i], status: "completed", result: ev.result };
          } else if (i < 0) {
            const step: ToolStep = {
              id: ev.toolCallId!,
              tool: ev.tool || "tool",
              label: ev.label || ev.tool || "tool",
              emoji: ev.emoji,
              status: "running",
              args: ev.args,
            };
            steps.push(step);
          }
          return { ...msg, steps };
        }),
      );
    });

    const cleanupReasoning = window.hermesAPI.onChatReasoning((text) => {
      setStreamStarted(true);
      setMessages((prev) =>
        updateCurrentReply(prev, (msg) => ({ ...msg, reasoning: (msg.reasoning ?? "") + text })),
      );
    });

    const cleanupToolProgress = window.hermesAPI.onChatToolProgress((tool) => {
      setStreamStarted(true);
      setToolProgress(tool);
    });

    const cleanupUsage = window.hermesAPI.onChatUsage((u) => {
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
        cost: u.cost != null ? (prev?.cost || 0) + u.cost : prev?.cost,
      }));
    });

    return () => {
      cleanupChunk();
      cleanupDone();
      cleanupError();
      cleanupToolProgress();
      cleanupToolEvent();
      cleanupReasoning();
      cleanupUsage();
    };
  }, [
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setStreamStarted,
    setUsage,
  ]);
}
