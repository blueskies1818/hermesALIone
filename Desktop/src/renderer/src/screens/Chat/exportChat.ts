import type { ChatMessage } from "./types";

/** A short title for an exported conversation (first user message). */
export function conversationTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.content.trim());
  const line = (first?.content || "Conversation").trim().split("\n")[0];
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

/** Render a conversation as a Markdown document. */
export function conversationMarkdown(
  messages: ChatMessage[],
  title: string,
  exportedAt: Date = new Date(),
): string {
  const out = [`# ${title}`, "", `_Exported from Theta R&D on ${exportedAt.toLocaleString()}_`, ""];
  for (const m of messages) {
    const body = m.content.trim();
    if (!body) continue;
    out.push(m.role === "user" ? "## You" : "## Theta", "", body, "");
    const files = (m.attachments || []).map((a) => a.name).filter(Boolean);
    if (files.length) out.push(`_Attachments: ${files.join(", ")}_`, "");
  }
  return out.join("\n").trimEnd() + "\n";
}

/** A filesystem-safe file name for the export. */
export function exportFileName(title: string, ext: "md" | "pdf"): string {
  const base = title
    .replace(/…$/, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${base || "conversation"}.${ext}`;
}
