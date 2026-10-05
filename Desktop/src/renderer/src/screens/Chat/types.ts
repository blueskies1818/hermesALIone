export type {
  Attachment,
  AttachmentKind,
  ToolStep,
} from "../../../../shared/attachments";

import type { Attachment, ToolStep } from "../../../../shared/attachments";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  attachments?: Attachment[];
  /** Theta: tool calls made while producing this reply. */
  steps?: ToolStep[];
  /** Theta: the model's streamed reasoning for this reply. */
  reasoning?: string;
  /** Theta: when the message was sent / the reply started (ms epoch). */
  createdAt?: number;
  /** Theta: model that produced this reply. */
  model?: string;
}

export interface ModelGroup {
  provider: string;
  providerLabel: string;
  models: {
    provider: string;
    model: string;
    label: string;
    baseUrl: string;
  }[];
}

export interface UsageState {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}
