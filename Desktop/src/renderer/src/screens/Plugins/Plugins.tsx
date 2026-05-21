import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../../components/useI18n";

interface PluginRow {
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

interface PluginProvider {
  name: string;
  description: string;
}

interface PluginsHubData {
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

interface PluginsProps {
  profile?: string;
}

const MEMORY_BUILTIN = "__hermes_memory_builtin__";

function Plugins({ profile: _profile }: PluginsProps): React.JSX.Element {
  const { t } = useI18n();

  const [hub, setHub] = useState<PluginsHubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [installId, setInstallId] = useState("");
  const [installForce, setInstallForce] = useState(false);
  const [installEnable, setInstallEnable] = useState(true);
  const [installBusy, setInstallBusy] = useState(false);
  const [memorySel, setMemorySel] = useState(MEMORY_BUILTIN);
  const [contextSel, setContextSel] = useState("compressor");
  const [providerBusy, setProviderBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  function showStatus(text: string, type: "success" | "error") {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 4000);
  }

  const loadHub = useCallback(() => {
    return window.hermesAPI
      .getPluginsHub()
      .then((h) => {
        setHub(h);
        const p = h.providers;
        setMemorySel(
          p.memory_provider ? p.memory_provider : MEMORY_BUILTIN,
        );
        setContextSel(p.context_engine || "compressor");
      })
      .catch(() => showStatus("Failed to load plugins", "error"));
  }, []);

  useEffect(() => {
    setLoading(true);
    loadHub().finally(() => setLoading(false));
  }, [loadHub]);

  async function onInstall() {
    const id = installId.trim();
    if (!id) {
      showStatus("Enter a plugin identifier", "error");
      return;
    }
    setInstallBusy(true);
    try {
      const r = await window.hermesAPI.installPlugin(
        id,
        installForce,
        installEnable,
      );
      if (r.ok) {
        showStatus(`${r.plugin_name ?? id} installed`, "success");
        if ((r.warnings?.length ?? 0) > 0)
          showStatus(r.warnings!.join(" "), "error");
        if ((r.missing_env?.length ?? 0) > 0)
          showStatus(
            `Missing env vars: ${r.missing_env!.join(", ")}`,
            "error",
          );
        setInstallId("");
        await loadHub();
      } else {
        showStatus(r.error ?? "Install failed", "error");
      }
    } catch (e) {
      showStatus(
        e instanceof Error ? e.message : "Install failed",
        "error",
      );
    } finally {
      setInstallBusy(false);
    }
  }

  async function onSaveProviders() {
    setProviderBusy(true);
    try {
      const ok = await window.hermesAPI.savePluginProviders(
        memorySel === MEMORY_BUILTIN ? "" : memorySel,
        contextSel,
      );
      if (ok) {
        showStatus("Providers saved", "success");
        await loadHub();
      } else {
        showStatus("Failed to save providers", "error");
      }
    } catch (e) {
      showStatus(
        e instanceof Error ? e.message : "Save failed",
        "error",
      );
    } finally {
      setProviderBusy(false);
    }
  }

  async function doRowAction(
    name: string,
    fn: () => Promise<boolean>,
    okMsg: string,
  ) {
    setRowBusy(name);
    try {
      const ok = await fn();
      if (ok) {
        showStatus(okMsg, "success");
        await loadHub();
      } else {
        showStatus("Operation failed", "error");
      }
    } catch (e) {
      showStatus(
        e instanceof Error ? e.message : "Failed",
        "error",
      );
    } finally {
      setRowBusy(null);
    }
  }

  const rows = hub?.plugins ?? [];

  return (
    <div className="schedules-container">
      <div className="schedules-header">
        <div>
          <h2 className="schedules-title">{t("navigation.plugins")}</h2>
          <p className="schedules-subtitle">Manage agent plugins and providers</p>
        </div>
        <div className="schedules-header-actions">
          <button
            className="btn-ghost"
            disabled={loading}
            onClick={() => {
              loadHub();
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="16"
              height="16"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`config-status ${
            statusMsg.type === "error" ? "config-status-error" : ""
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      <div className="plugins-content">
        {/* Providers */}
        {hub?.providers && (
          <div className="plugins-card">
            <h3 className="plugins-card-title">Providers</h3>
            <p className="plugins-card-hint">
              Select memory and context providers used by the agent runtime.
            </p>

            <div className="plugins-provider-grid">
              <div className="plugins-field">
                <label className="plugins-label">Memory Provider</label>
                <select
                  className="input"
                  value={memorySel}
                  onChange={(e) => setMemorySel(e.target.value)}
                >
                  <option value={MEMORY_BUILTIN}>(defaults)</option>
                  {hub.providers.memory_options.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="plugins-field">
                <label className="plugins-label">Context Engine</label>
                <select
                  className="input"
                  value={contextSel}
                  onChange={(e) => setContextSel(e.target.value)}
                >
                  <option value="compressor">compressor</option>
                  {hub.providers.context_options
                    .filter((o) => o.name !== "compressor")
                    .map((o) => (
                      <option key={o.name} value={o.name}>
                        {o.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <button
              className="btn btn-primary btn-sm"
              disabled={providerBusy}
              onClick={onSaveProviders}
            >
              {providerBusy ? "Saving..." : "Save Providers"}
            </button>
          </div>
        )}

        {/* Install */}
        <div className="plugins-card">
          <h3 className="plugins-card-title">Install Plugin</h3>
          <p className="plugins-card-hint">
            Enter a plugin identifier (owner/repo or URL) to install.
          </p>

          <div className="plugins-install-row">
            <input
              className="input"
              type="text"
              placeholder="owner/repo or https://..."
              value={installId}
              onChange={(e) => setInstallId(e.target.value)}
            />
          </div>

          <div className="plugins-toggle-row">
            <label className="plugins-toggle">
              <input
                type="checkbox"
                checked={installForce}
                onChange={(e) => setInstallForce(e.target.checked)}
              />
              <span>Force reinstall</span>
            </label>
            <label className="plugins-toggle">
              <input
                type="checkbox"
                checked={installEnable}
                onChange={(e) => setInstallEnable(e.target.checked)}
              />
              <span>Enable after install</span>
            </label>
          </div>

          <button
            className="btn btn-primary btn-sm"
            disabled={installBusy}
            onClick={onInstall}
          >
            {installBusy ? "Installing..." : "Install"}
          </button>

          <p className="plugins-hint-text">
            Plugins added manually to the plugins directory will appear after a
            refresh.
          </p>
        </div>

        {/* Plugin list */}
        {loading ? (
          <div className="schedules-empty">
            <p className="schedules-empty-text">Loading...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="schedules-empty">
            <p className="schedules-empty-text">No plugins installed</p>
          </div>
        ) : (
          <div className="plugins-list">
            <h3 className="plugins-section-title">Installed Plugins</h3>
            {rows.map((row) => (
              <div
                key={row.name}
                className={`plugins-row-card ${
                  rowBusy === row.name ? "plugins-row-busy" : ""
                }`}
              >
                <div className="plugins-row-top">
                  <div className="plugins-row-info">
                    <span className="plugins-row-name">{row.name}</span>
                    <span className="plugins-row-badge">{row.source}</span>
                    <span className="plugins-row-badge">
                      v{row.version || "—"}
                    </span>
                    <span
                      className={`plugins-row-badge plugins-status-${row.runtime_status}`}
                    >
                      {row.runtime_status}
                    </span>
                    {row.auth_required && (
                      <span className="plugins-row-badge plugins-status-disabled">
                        Auth Required
                      </span>
                    )}
                  </div>
                  <div className="plugins-row-actions">
                    <button
                      className="btn-ghost"
                      disabled={
                        rowBusy === row.name ||
                        row.runtime_status === "enabled"
                      }
                      onClick={() =>
                        doRowAction(
                          row.name,
                          () => window.hermesAPI.enablePlugin(row.name),
                          `${row.name} enabled`,
                        )
                      }
                    >
                      Enable
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={
                        rowBusy === row.name ||
                        row.runtime_status === "disabled"
                      }
                      onClick={() =>
                        doRowAction(
                          row.name,
                          () => window.hermesAPI.disablePlugin(row.name),
                          `${row.name} disabled`,
                        )
                      }
                    >
                      Disable
                    </button>
                    {row.can_update_git && (
                      <button
                        className="btn-ghost"
                        disabled={rowBusy === row.name}
                        onClick={() =>
                          doRowAction(
                            row.name,
                            () => window.hermesAPI.updatePlugin(row.name),
                            `${row.name} updated`,
                          )
                        }
                      >
                        Update
                      </button>
                    )}
                    {row.has_dashboard_manifest && (
                      <button
                        className="btn-ghost"
                        disabled={rowBusy === row.name}
                        title={
                          row.user_hidden
                            ? "Show in sidebar"
                            : "Hide from sidebar"
                        }
                        onClick={() =>
                          doRowAction(
                            row.name,
                            () =>
                              window.hermesAPI.setPluginVisibility(
                                row.name,
                                !row.user_hidden,
                              ),
                            `${row.name} visibility updated`,
                          )
                        }
                      >
                        {row.user_hidden ? "Show" : "Hide"}
                      </button>
                    )}
                    {row.can_remove && (
                      <button
                        className="btn-ghost"
                        disabled={rowBusy === row.name}
                        onClick={() => setConfirmRemove(row.name)}
                        style={{ color: "var(--error)" }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          width="14"
                          height="14"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {row.description && (
                  <p className="plugins-row-desc">{row.description}</p>
                )}

                {row.auth_required && row.auth_command && (
                  <div className="plugins-auth-cmd">
                    <span className="plugins-auth-label">Auth command:</span>
                    <code>{row.auth_command}</code>
                  </div>
                )}

                {!row.has_dashboard_manifest && (
                  <p className="plugins-hint-text">No dashboard UI</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Orphan dashboard plugins */}
        {(hub?.orphan_dashboard_plugins?.length ?? 0) > 0 && (
          <div className="plugins-list">
            <h3 className="plugins-section-title">Orphan Dashboard Plugins</h3>
            <div className="plugins-orphan-list">
              {hub!.orphan_dashboard_plugins.map((m) => (
                <div key={m.name} className="plugins-orphan-item">
                  <span>
                    {m.label ?? m.name} — {m.description || m.tab?.path}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Confirm remove dialog */}
      {confirmRemove && (
        <div className="plugins-overlay" onClick={() => setConfirmRemove(null)}>
          <div
            className="plugins-confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="plugins-confirm-title">
              Remove "{confirmRemove}"?
            </p>
            <p className="plugins-confirm-desc">
              This will remove the plugin from your agent.
            </p>
            <div className="plugins-confirm-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmRemove(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  const name = confirmRemove;
                  setConfirmRemove(null);
                  doRowAction(
                    name,
                    () => window.hermesAPI.removePlugin(name),
                    `${name} removed`,
                  );
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Plugins;
