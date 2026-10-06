import { apiFetch } from "./hermes";
import type {
  AgentSettings,
  AgentSettingsPatch,
  ApiResult,
  McpServerInfo,
  McpServerInput,
  ProviderOption,
  SessionPolicy,
} from "../shared/agents";

// Theta: thin wrappers over hermes_cli/theta_agents_api.py. Everything
// lives on the server; the app only reads and edits it.

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const { ok, data } = await apiFetch(path, { ...options, timeoutMs: 30000 });
    if (ok) return { ok: true, data: data as T };
    const detail = (data as { detail?: unknown } | null)?.detail;
    return { ok: false, error: typeof detail === "string" ? detail : "Request failed" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const agentPath = (name: string): string =>
  `/api/agents/${encodeURIComponent(name || "default")}/settings`;
const sessionPath = (id: string, rest: string): string =>
  `/api/sessions/${encodeURIComponent(id)}/${rest}`;

export const getAgentSettings = (name: string): Promise<ApiResult<AgentSettings>> =>
  call(agentPath(name));

export const updateAgentSettings = (
  name: string,
  patch: AgentSettingsPatch,
): Promise<ApiResult<AgentSettings>> => call(agentPath(name), { method: "PUT", body: patch });

export const getSessionPolicy = (id: string): Promise<ApiResult<SessionPolicy>> =>
  call(sessionPath(id, "policy"));

export const setSessionTool = (
  id: string,
  toolset: string,
  enabled: boolean | null,
): Promise<ApiResult<SessionPolicy>> =>
  call(sessionPath(id, "tools"), { method: "PUT", body: { toolset, enabled } });

export const setSessionProject = (id: string, project: string): Promise<ApiResult<SessionPolicy>> =>
  call(sessionPath(id, "project"), { method: "PUT", body: { project } });

export async function listProjects(): Promise<string[]> {
  const r = await call<{ projects?: string[] }>("/api/projects");
  return r.ok ? r.data.projects || [] : [];
}

/** Providers with credentials and their models (server's model catalog). */
export async function listModelOptions(): Promise<ProviderOption[]> {
  const r = await call<{ providers?: ProviderOption[] }>("/api/model/options");
  if (!r.ok) return [];
  return (r.data.providers || []).map((p) => ({
    slug: String(p.slug || ""),
    name: String(p.name || p.slug || ""),
    models: Array.isArray(p.models) ? p.models.map(String) : [],
    is_current: Boolean(p.is_current),
  }));
}

type McpResult = ApiResult<{ servers: McpServerInfo[]; restart_required?: boolean }>;

export const listMcp = (): Promise<McpResult> => call("/api/theta/mcp/servers");
export const addMcp = (server: McpServerInput): Promise<McpResult> =>
  call("/api/theta/mcp/servers", { method: "POST", body: server });
export const toggleMcp = (name: string, enabled: boolean): Promise<McpResult> =>
  call(`/api/theta/mcp/servers/${encodeURIComponent(name)}`, { method: "PUT", body: { enabled } });
export const deleteMcp = (name: string): Promise<McpResult> =>
  call(`/api/theta/mcp/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
