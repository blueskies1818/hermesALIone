import { describe, it, expect } from "vitest";
import { conversationMarkdown, conversationTitle, exportFileName } from "./exportChat";
import type { ChatMessage } from "./types";

const msgs: ChatMessage[] = [
  { id: "user-1", role: "user", content: "How do I grow tomatoes on a balcony?" },
  { id: "agent-1", role: "agent", content: "Use a **large pot**.\n\n- Sun\n- Water" },
  { id: "agent-2", role: "agent", content: "   " },
];

describe("exportChat", () => {
  it("titles from the first user message", () => {
    expect(conversationTitle(msgs)).toBe("How do I grow tomatoes on a balcony?");
    expect(conversationTitle([])).toBe("Conversation");
    expect(conversationTitle([{ id: "u", role: "user", content: "x".repeat(100) }])).toHaveLength(58);
  });

  it("renders roles and skips empty messages", () => {
    const md = conversationMarkdown(msgs, "Tomatoes", new Date(2026, 0, 1));
    expect(md.startsWith("# Tomatoes\n")).toBe(true);
    expect(md).toContain("## You\n\nHow do I grow tomatoes on a balcony?");
    expect(md).toContain("## Theta\n\nUse a **large pot**.\n\n- Sun\n- Water");
    expect(md.match(/## Theta/g)).toHaveLength(1);
  });

  it("makes safe file names", () => {
    expect(exportFileName('a/b:c*?"<>| d', "md")).toBe("abc d.md");
    expect(exportFileName("…", "pdf")).toBe("conversation.pdf");
  });
});
