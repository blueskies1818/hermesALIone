import { apiFetch } from "./hermes";

export interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const { ok, data } = await apiFetch("/api/profiles");
  if (!ok) return [];
  const raw = (data as any)?.profiles || [];
  // Normalise the fields the renderer expects
  return raw.map((p: any) => ({
    name: p.name || "default",
    path: p.path || "",
    isDefault: p.name === "default",
    isActive: p.is_active ?? (p.name === "default"),
    model: p.model || "",
    provider: p.provider || "auto",
    hasEnv: p.has_env ?? false,
    hasSoul: p.has_soul ?? false,
    skillCount: p.skill_count ?? p.skillCount ?? 0,
    gatewayRunning: p.gateway_running ?? false,
  }));
}

export async function createProfile(
  name: string,
  clone: boolean,
): Promise<{ success: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/profiles", {
    method: "POST",
    body: { name, clone_from_default: clone },
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "Failed to create profile" };
  return { success: true };
}

export async function deleteProfile(name: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const { ok, data } = await apiFetch(`/api/profiles/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "Failed to delete profile" };
  return { success: true };
}

export async function setActiveProfile(name: string): Promise<void> {
  await apiFetch(`/api/profiles/${encodeURIComponent(name)}/activate`, {
    method: "POST",
  });
}
