import { apiFetch } from "./hermes";

export interface MemoryEntry {
  index: number;
  content: string;
}

export interface MemoryInfo {
  memory: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    entries: MemoryEntry[];
    charCount: number;
    charLimit: number;
  };
  user: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    charCount: number;
    charLimit: number;
  };
  stats: { totalSessions: number; totalMessages: number };
}

function profileParam(profile?: string): Record<string, string> {
  return profile && profile !== "default" ? { profile } : {};
}

// ── Read ────────────────────────────────────────────

export async function readMemory(profile?: string): Promise<MemoryInfo> {
  const { ok, data } = await apiFetch("/api/memory", {
    params: profileParam(profile),
  });
  if (!ok) throw new Error(`Failed to read memory: ${(data as any)?.detail}`);
  return data as MemoryInfo;
}

// ── Write operations ────────────────────────────────

export async function addMemoryEntry(
  content: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/memory", {
    method: "POST",
    body: { content, profile: profile || "default" },
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "API error" };
  return { success: true };
}

export async function updateMemoryEntry(
  index: number,
  content: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/memory", {
    method: "PUT",
    body: { index, content, profile: profile || "default" },
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "API error" };
  return { success: true };
}

export async function removeMemoryEntry(
  index: number,
  profile?: string,
): Promise<boolean> {
  const { ok } = await apiFetch("/api/memory", {
    method: "DELETE",
    body: { index, profile: profile || "default" },
  });
  return ok;
}

export async function writeUserProfile(
  content: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/memory/user", {
    method: "PUT",
    body: { content, profile: profile || "default" },
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "API error" };
  return { success: true };
}
