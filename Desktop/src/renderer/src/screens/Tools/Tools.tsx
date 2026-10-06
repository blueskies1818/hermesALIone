import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../../components/useI18n";
import type { ApiResult, McpServerInfo, ToolRow } from "../../../../shared/agents";

interface ToolsProps {
  profile?: string;
}

// SVG icons per toolset key
const TOOL_ICONS: Record<string, React.JSX.Element> = {
  web: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  browser: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 3v6" />
    </svg>
  ),
  terminal: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m7 10 3 3-3 3M13 16h4" />
    </svg>
  ),
  file: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  code_execution: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
      <line x1="14" y1="4" x2="10" y2="20" />
    </svg>
  ),
  vision: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  image_gen: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  ),
  tts: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  ),
  skills: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.61-1.61a2.404 2.404 0 0 1 1.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z" />
    </svg>
  ),
  memory: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    </svg>
  ),
  session_search: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
      <path d="M11 8v6M8 11h6" />
    </svg>
  ),
  clarify: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  delegation: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  cronjob: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  moa: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  todo: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
};

function ToolIcon({ toolKey }: { toolKey: string }): React.JSX.Element {
  return (
    <div className="tools-card-icon">
      {TOOL_ICONS[toolKey] || (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )}
    </div>
  );
}

const SERVER_ICON = (
  <div className="tools-card-icon">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="6" cy="18" r="1" />
    </svg>
  </div>
);

/** "KEY=value" lines → object (blank lines ignored). */
function parsePairs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

function AddMcpForm({ onAdded }: { onAdded: (servers: McpServerInfo[]) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"stdio" | "http">("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [secrets, setSecrets] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        + Add MCP server
      </button>
    );
  }

  const submit = async (): Promise<void> => {
    setError(null);
    const pairs = parsePairs(secrets);
    const r = await window.hermesAPI.thetaAddMcp(
      kind === "stdio"
        ? {
            name: name.trim(),
            command: command.trim(),
            args: args.trim() ? args.trim().split(/\s+/) : [],
            env: pairs,
          }
        : { name: name.trim(), url: url.trim(), headers: pairs },
    );
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onAdded(r.data.servers);
    setOpen(false);
    setName("");
    setCommand("");
    setArgs("");
    setUrl("");
    setSecrets("");
  };

  return (
    <div className="mcp-add">
      <div className="mcp-add-row">
        <select
          className="input input-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as "stdio" | "http")}
        >
          <option value="stdio">Command (stdio)</option>
          <option value="http">URL (http)</option>
        </select>
        <input
          className="input input-sm"
          placeholder="name, e.g. github"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {kind === "stdio" ? (
        <div className="mcp-add-row">
          <input
            className="input input-sm"
            placeholder="command, e.g. npx"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <input
            className="input input-sm"
            placeholder="arguments, e.g. -y @modelcontextprotocol/server-github"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
        </div>
      ) : (
        <input
          className="input input-sm"
          placeholder="https://example.com/mcp"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      )}
      <textarea
        className="input input-sm mcp-add-secrets"
        placeholder={
          kind === "stdio"
            ? "Environment, one KEY=value per line (optional)"
            : "Headers, one Name=value per line (optional)"
        }
        value={secrets}
        onChange={(e) => setSecrets(e.target.value)}
        rows={2}
      />
      <p className="mcp-add-hint">Values are stored on the server and never sent back to the app.</p>
      {error && <div className="mcp-add-error">{error}</div>}
      <div className="mcp-add-row">
        <button
          className="btn btn-primary btn-sm"
          onClick={submit}
          disabled={!name.trim() || (kind === "stdio" ? !command.trim() : !url.trim())}
        >
          Add
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Theta: tools of the selected agent (profile) and the server's MCP servers.
 * Toggles set the agent's defaults; a chat can still override them.
 */
function Tools({ profile }: ToolsProps): React.JSX.Element {
  const { t } = useI18n();
  const agent = profile || "default";
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const [settings, mcp] = await Promise.all([
      window.hermesAPI.agentSettings(agent),
      window.hermesAPI.thetaListMcp(),
    ]);
    if (settings.ok) setTools(settings.data.tools);
    else setError(settings.error);
    if (mcp.ok) setMcpServers(mcp.data.servers);
    setLoading(false);
  }, [agent]);

  useEffect(() => {
    load();
  }, [load]);

  async function setDefault(name: string, enabled: boolean): Promise<void> {
    setTools((prev) => prev.map((row) => (row.name === name ? { ...row, default: enabled } : row)));
    const r = await window.hermesAPI.updateAgentSettings(agent, { tools: { [name]: enabled } });
    if (r.ok) setTools(r.data.tools);
    else setError(r.error);
  }

  async function mcpChanged(
    promise: Promise<ApiResult<{ servers: McpServerInfo[] }>>,
  ): Promise<void> {
    const r = await promise;
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setMcpServers(r.data.servers);
    setRestartNeeded(true);
    const settings = await window.hermesAPI.agentSettings(agent);
    if (settings.ok) setTools(settings.data.tools);
  }

  async function applyRestart(): Promise<void> {
    setRestarting(true);
    await window.hermesAPI.restartGatewayForConfig().catch(() => false);
    setRestarting(false);
    setRestartNeeded(false);
  }

  if (loading) {
    return (
      <div className="tools-container">
        <div className="tools-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  const builtin = tools.filter((row) => row.kind === "builtin");
  const usedBy = (name: string): ToolRow | undefined => tools.find((row) => row.name === name);

  return (
    <div className="tools-container">
      <div className="tools-header">
        <h2 className="tools-title">{t("tools.title")}</h2>
        <p className="tools-subtitle">
          Default tools for{" "}
          <strong>{agent === "default" ? "Theta (default agent)" : agent}</strong>. A
          conversation can still turn tools on or off for itself from the chat header.
        </p>
      </div>
      {error && <div className="mcp-add-error">{error}</div>}

      <div className="tools-grid">
        {builtin.map((row) => (
          <div
            key={row.name}
            className={`tools-card ${row.default ? "tools-card-enabled" : "tools-card-disabled"}`}
            onClick={() => setDefault(row.name, !row.default)}
          >
            <div className="tools-card-top">
              <ToolIcon toolKey={row.name} />
              <label className="tools-toggle" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={row.default}
                  onChange={() => setDefault(row.name, !row.default)}
                />
                <span className="tools-toggle-track" />
              </label>
            </div>
            <div className="tools-card-label">{row.label}</div>
            <div className="tools-card-description">{row.description}</div>
          </div>
        ))}
      </div>

      <div className="tools-header" style={{ marginTop: 32 }}>
        <h2 className="tools-title">{t("tools.mcpServers")}</h2>
        <p className="tools-subtitle">
          Servers are shared by all agents; the switch on each card sets whether this agent uses it.
        </p>
      </div>
      {restartNeeded && (
        <div className="mcp-restart">
          MCP changes take effect after the chat server restarts (running chats are interrupted).
          <button className="btn btn-primary btn-sm" onClick={applyRestart} disabled={restarting}>
            {restarting ? "Restarting…" : "Restart now"}
          </button>
        </div>
      )}
      <div className="tools-grid">
        {mcpServers.map((s) => {
          const row = usedBy(s.name);
          return (
            <div
              key={s.name}
              className={`tools-card ${s.enabled && row?.default ? "tools-card-enabled" : "tools-card-disabled"}`}
            >
              <div className="tools-card-top">
                {SERVER_ICON}
                {row && s.enabled && (
                  <label className="tools-toggle" title={`Use with ${agent}`}>
                    <input
                      type="checkbox"
                      checked={row.default}
                      onChange={() => setDefault(s.name, !row.default)}
                    />
                    <span className="tools-toggle-track" />
                  </label>
                )}
              </div>
              <div className="tools-card-label">{s.name}</div>
              <div className="tools-card-description">
                {s.type === "http" ? s.url : [s.command, ...s.args].join(" ")}
              </div>
              {(s.env_keys.length > 0 || s.header_keys.length > 0) && (
                <div className="tools-card-description">
                  {[...s.env_keys, ...s.header_keys].join(", ")} set
                </div>
              )}
              <div className="mcp-card-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => mcpChanged(window.hermesAPI.thetaToggleMcp(s.name, !s.enabled))}
                >
                  {s.enabled ? "Disable for all" : "Enable"}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (window.confirm(`Remove the MCP server '${s.name}'?`)) {
                      void mcpChanged(window.hermesAPI.thetaDeleteMcp(s.name));
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12 }}>
        <AddMcpForm
          onAdded={(servers) => {
            setMcpServers(servers);
            setRestartNeeded(true);
            void load();
          }}
        />
      </div>
    </div>
  );
}

export default Tools;
