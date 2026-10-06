// Theta: agent settings, per-conversation policy and MCP servers
// (served by hermes_cli/theta_agents_api.py).

export interface ToolRow {
  name: string;
  label: string;
  description: string;
  kind: "builtin" | "mcp";
  /** On by default for this agent. */
  default: boolean;
  /** Per-conversation rows only: the override (null = use the default). */
  override?: boolean | null;
  enabled?: boolean;
}

export type ProjectScopeMode = "all" | "fixed" | "chat";

export interface FallbackEntry {
  provider: string;
  model: string;
  base_url?: string;
}

export interface AgentSettings {
  name: string;
  model: { provider: string; model: string; base_url: string };
  fallbacks: FallbackEntry[];
  tools: ToolRow[];
  project_scope: { mode: ProjectScopeMode; project: string };
}

export interface AgentSettingsPatch {
  model?: { provider: string; model: string; base_url?: string };
  fallbacks?: FallbackEntry[];
  tools?: Record<string, boolean | null>;
  project_scope?: { mode: ProjectScopeMode; project?: string };
}

export interface SessionPolicy {
  session_id: string;
  agent: string;
  project: string | null;
  scope: { mode: ProjectScopeMode; project: string | null; locked: boolean };
  tools: ToolRow[];
}

export interface ProviderOption {
  slug: string;
  name: string;
  models: string[];
  is_current?: boolean;
}

export interface McpServerInfo {
  name: string;
  type: "stdio" | "http";
  command: string;
  args: string[];
  url: string;
  enabled: boolean;
  env_keys: string[];
  header_keys: string[];
}

export interface McpServerInput {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

/** `{ok, data}` or `{ok: false, error}` from the server. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
