import { apiFetch, isRemoteMode } from "./hermes";

export interface PluginRow {
  name: string;
  version: string;
  description: string;
  source: string;
  runtime_status: "disabled" | "enabled" | "inactive";
  has_dashboard_manifest: boolean;
  path: string;
  can_remove: boolean;
  can_update_git: boolean;
  auth_required: boolean;
  auth_command: string;
  user_hidden: boolean;
}

export interface PluginProvider {
  name: string;
  description: string;
}

export interface PluginsHubData {
  plugins: PluginRow[];
  orphan_dashboard_plugins: Array<{
    name: string;
    label: string;
    description: string;
    tab?: { path: string; hidden?: boolean };
  }>;
  providers: {
    memory_provider: string;
    memory_options: PluginProvider[];
    context_engine: string;
    context_options: PluginProvider[];
  };
}

export async function getPluginsHub(): Promise<PluginsHubData> {
  if (isRemoteMode()) {
    const { ok, data } = await apiFetch("/api/dashboard/plugins/hub");
    if (!ok) throw new Error("Failed to fetch plugin hub");
    return data as PluginsHubData;
  }
  // For local mode, try to hit the local REST API (which the gateway exposes)
  try {
    const res = await fetch("http://127.0.0.1:9119/api/dashboard/plugins/hub");
    if (res.ok) return await res.json();
  } catch {}
  return { plugins: [], orphan_dashboard_plugins: [], providers: { memory_provider: "", memory_options: [], context_engine: "compressor", context_options: [] } };
}

export async function installPlugin(
  identifier: string,
  force = false,
  enable = true,
): Promise<{ ok: boolean; plugin_name?: string; warnings?: string[]; missing_env?: string[]; error?: string }> {
  if (isRemoteMode()) {
    const { ok, data } = await apiFetch("/api/dashboard/agent-plugins/install", {
      method: "POST",
      body: { identifier, force, enable },
    });
    if (!ok) return { ok: false, error: String((data as any)?.detail) || "Install failed" };
    return data as any;
  }
  try {
    const res = await fetch("http://127.0.0.1:9119/api/dashboard/agent-plugins/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, force, enable }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: String((data as any)?.detail) || "Install failed" };
    return data;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function enablePlugin(name: string): Promise<boolean> {
  if (isRemoteMode()) {
    const { ok } = await apiFetch(`/api/dashboard/agent-plugins/${encodeURIComponent(name)}/enable`, { method: "POST" });
    return ok;
  }
  try {
    const res = await fetch(`http://127.0.0.1:9119/api/dashboard/agent-plugins/${encodeURIComponent(name)}/enable`, { method: "POST" });
    return res.ok;
  } catch {}
  return false;
}

export async function disablePlugin(name: string): Promise<boolean> {
  if (isRemoteMode()) {
    const { ok } = await apiFetch(`/api/dashboard/agent-plugins/${encodeURIComponent(name)}/disable`, { method: "POST" });
    return ok;
  }
  try {
    const res = await fetch(`http://127.0.0.1:9119/api/dashboard/agent-plugins/${encodeURIComponent(name)}/disable`, { method: "POST" });
    return res.ok;
  } catch {}
  return false;
}

export async function updatePlugin(name: string): Promise<boolean> {
  if (isRemoteMode()) {
    const { ok } = await apiFetch(`/api/dashboard/agent-plugins/${encodeURIComponent(name)}/update`, { method: "POST" });
    return ok;
  }
  try {
    const res = await fetch(`http://127.0.0.1:9119/api/dashboard/agent-plugins/${encodeURIComponent(name)}/update`, { method: "POST" });
    return res.ok;
  } catch {}
  return false;
}

export async function removePlugin(name: string): Promise<boolean> {
  if (isRemoteMode()) {
    const { ok } = await apiFetch(`/api/dashboard/agent-plugins/${encodeURIComponent(name)}`, { method: "DELETE" });
    return ok;
  }
  try {
    const res = await fetch(`http://127.0.0.1:9119/api/dashboard/agent-plugins/${encodeURIComponent(name)}`, { method: "DELETE" });
    return res.ok;
  } catch {}
  return false;
}

export async function savePluginProviders(
  memoryProvider: string,
  contextEngine: string,
): Promise<boolean> {
  if (isRemoteMode()) {
    const { ok } = await apiFetch("/api/dashboard/plugin-providers", {
      method: "PUT",
      body: { memory_provider: memoryProvider, context_engine: contextEngine },
    });
    return ok;
  }
  try {
    const res = await fetch("http://127.0.0.1:9119/api/dashboard/plugin-providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory_provider: memoryProvider, context_engine: contextEngine }),
    });
    return res.ok;
  } catch {}
  return false;
}

export async function setPluginVisibility(name: string, hidden: boolean): Promise<boolean> {
  if (isRemoteMode()) {
    const { ok } = await apiFetch(`/api/dashboard/plugins/${encodeURIComponent(name)}/visibility`, {
      method: "POST",
      body: { hidden },
    });
    return ok;
  }
  try {
    const res = await fetch(`http://127.0.0.1:9119/api/dashboard/plugins/${encodeURIComponent(name)}/visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden }),
    });
    return res.ok;
  } catch {}
  return false;
}
