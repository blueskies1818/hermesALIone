import { apiFetch } from "./hermes";

export interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

export interface SkillSearchResult {
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
}

export async function listInstalledSkills(profile?: string): Promise<InstalledSkill[]> {
  const params = profile && profile !== "default" ? { profile } : undefined;
  const { ok, data } = await apiFetch("/api/skills", { params });
  if (!ok) return [];
  const raw = Array.isArray(data) ? data : (data as any)?.skills || [];
  return raw
    .filter((s: any) => s.installed !== false)
    .map((s: any) => ({
      name: s.name || "",
      category: s.category || "",
      description: s.description || "",
      path: s.path || s.name || "",
    }));
}

export async function listBundledSkills(): Promise<SkillSearchResult[]> {
  const { ok, data } = await apiFetch("/api/skills");
  if (!ok) return [];
  const raw = Array.isArray(data) ? data : (data as any)?.skills || [];
  return raw.map((s: any) => ({
    name: s.name || "",
    description: s.description || "",
    category: s.category || "",
    source: s.source || "bundled",
    installed: s.installed || false,
  }));
}

export function getSkillContent(skillPath: string): string {
  // Skill content is not available via REST — return empty.
  // The renderer should display what it has from listInstalledSkills.
  return "";
}

export async function searchSkills(query: string): Promise<SkillSearchResult[]> {
  const { ok, data } = await apiFetch("/api/skills");
  if (!ok) return [];
  const raw = Array.isArray(data) ? data : (data as any)?.skills || [];
  const q = query.toLowerCase();
  return raw
    .filter((s: any) => {
      const name = (s.name || "").toLowerCase();
      const desc = (s.description || "").toLowerCase();
      return name.includes(q) || desc.includes(q);
    })
    .map((s: any) => ({
      name: s.name || "",
      description: s.description || "",
      category: s.category || "",
      source: s.source || "bundled",
      installed: s.installed || false,
    }));
}

export async function installSkill(
  identifier: string,
  _profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/skills/install", {
    method: "POST",
    body: { identifier, force: true },
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "Install failed" };
  return { success: true };
}

export async function uninstallSkill(
  name: string,
  _profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/skills/uninstall", {
    method: "POST",
    body: { name },
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "Uninstall failed" };
  return { success: true };
}
