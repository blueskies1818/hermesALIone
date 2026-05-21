import { apiFetch } from "./hermes";

export async function readSoul(profile?: string): Promise<string> {
  const params = profile && profile !== "default" ? `?profile=${encodeURIComponent(profile)}` : "";
  const { ok, data } = await apiFetch(`/api/soul${params}`);
  if (!ok) throw new Error(`Failed to read soul: ${(data as any)?.detail}`);
  return (data as any).content || "";
}

export async function writeSoul(content: string, profile?: string): Promise<boolean> {
  const { ok } = await apiFetch("/api/soul", {
    method: "PUT",
    body: { content, profile: profile || "default" },
  });
  return ok;
}

export async function resetSoul(profile?: string): Promise<string> {
  const { ok, data } = await apiFetch("/api/soul/reset", {
    method: "POST",
    body: { profile: profile || "default" },
  });
  if (!ok) throw new Error(`Failed to reset soul: ${(data as any)?.detail}`);
  return (data as any).content || "";
}
