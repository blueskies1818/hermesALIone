import { apiFetch } from "./hermes";
import type { Attachment } from "../shared/attachments";
import { isImageMime } from "../shared/attachments";

// Sentinel prefix used by hermes-agent's hermes_state.py to mark
// JSON-encoded multimodal content in the messages.content column.
const CONTENT_JSON_PREFIX = "\x00json:";

export interface SessionSummary {
  id: string;
  source: string;
  startedAt: number;
  endedAt: number | null;
  messageCount: number;
  model: string;
  title: string | null;
  preview: string;
}

export interface SessionMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  attachments?: Attachment[];
}

interface DecodedContent {
  text: string;
  attachments: Attachment[];
}

export function decodeContent(raw: string, messageId: number): DecodedContent {
  if (!raw || !raw.startsWith(CONTENT_JSON_PREFIX)) {
    return { text: raw || "", attachments: [] };
  }
  let parts: unknown;
  try {
    parts = JSON.parse(raw.slice(CONTENT_JSON_PREFIX.length));
  } catch {
    return { text: raw, attachments: [] };
  }
  if (!Array.isArray(parts)) {
    return { text: typeof parts === "string" ? parts : raw, attachments: [] };
  }

  const texts: string[] = [];
  const attachments: Attachment[] = [];
  let idx = 0;
  for (const p of parts) {
    if (typeof p === "string") {
      if (p) texts.push(p);
      continue;
    }
    if (!p || typeof p !== "object") continue;
    const type = String(
      (p as Record<string, unknown>).type || "",
    ).toLowerCase();
    if (type === "text" || type === "input_text" || type === "output_text") {
      const t = (p as Record<string, unknown>).text;
      if (typeof t === "string" && t) texts.push(t);
    } else if (type === "image_url" || type === "input_image") {
      const ref = (p as Record<string, unknown>).image_url;
      let url = "";
      if (typeof ref === "string") url = ref;
      else if (ref && typeof ref === "object") {
        const u = (ref as Record<string, unknown>).url;
        if (typeof u === "string") url = u;
      }
      if (!url || !url.startsWith("data:image/")) continue;
      const mime = url.slice("data:".length, url.indexOf(";"));
      attachments.push({
        id: `db-${messageId}-${idx++}`,
        kind: "image",
        name: `image.${guessExtension(mime)}`,
        mime: isImageMime(mime) ? mime : "image/png",
        size: 0,
        dataUrl: url,
      });
    }
  }
  return { text: texts.join("\n\n"), attachments };
}

function guessExtension(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    default: return "bin";
  }
}

export interface SearchResult {
  sessionId: string;
  title: string | null;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  snippet: string;
}

export async function listSessions(
  limit = 30,
  offset = 0,
): Promise<SessionSummary[]> {
  const { ok, data } = await apiFetch("/api/sessions", {
    params: { limit: String(limit), offset: String(offset) },
  });
  if (!ok) return [];
  const sessions = (data as Record<string, unknown>)?.sessions as Array<Record<string, unknown>> | undefined;
  if (!sessions) return [];
  return sessions.map((s) => ({
    id: String(s.id || ""),
    source: String(s.source || ""),
    startedAt: Number(s.started_at || 0),
    endedAt: s.ended_at != null ? Number(s.ended_at) : null,
    messageCount: Number(s.message_count || 0),
    model: String(s.model || ""),
    title: s.title ? String(s.title) : null,
    preview: "",
  }));
}

export async function searchSessions(
  query: string,
  limit = 20,
): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const { ok, data } = await apiFetch("/api/sessions/search", {
    params: { q: query.trim(), limit: String(limit) },
  });
  if (!ok) return [];
  const results = (data as Record<string, unknown>)?.results as Array<Record<string, unknown>> | undefined;
  if (!results) return [];
  return results.map((r) => ({
    sessionId: String(r.session_id || ""),
    title: r.title ? String(r.title) : null,
    startedAt: Number(r.session_started || r.started_at || 0),
    source: String(r.source || ""),
    messageCount: Number(r.message_count || 0),
    model: String(r.model || ""),
    snippet: String(r.snippet || ""),
  }));
}

export async function getSessionMessages(
  sessionId: string,
): Promise<SessionMessage[]> {
  const { ok, data } = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  if (!ok) return [];
  const messages = (data as Record<string, unknown>)?.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return [];
  return messages.map((r) => {
    const decoded = decodeContent(String(r.content || ""), Number(r.id || 0));
    return {
      id: Number(r.id || 0),
      role: (r.role as SessionMessage["role"]) || "user",
      content: decoded.text,
      timestamp: Number(r.timestamp || 0),
      ...(decoded.attachments.length > 0
        ? { attachments: decoded.attachments }
        : {}),
    };
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}
