import { apiFetch } from "./hermes";

export interface ToolsetInfo {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export async function getToolsets(profile?: string): Promise<ToolsetInfo[]> {
  const params: Record<string, string> = {};
  if (profile) params.profile = profile;

  const { ok, data } = await apiFetch("/api/tools/toolsets", { params });
  if (!ok) return [];

  const items = data as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) return [];

  return items.map((item) => ({
    key: String(item.name || item.key || ""),
    label: String(item.label || ""),
    description: String(item.description || ""),
    enabled: Boolean(item.enabled),
  }));
}

export async function setToolsetEnabled(
  key: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  const { ok } = await apiFetch("/api/tools/toolset", {
    method: "PUT",
    body: { key, enabled, profile: profile || "default" },
  });
  return ok;
}
