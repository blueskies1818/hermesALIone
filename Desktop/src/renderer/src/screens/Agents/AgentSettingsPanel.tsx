import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type {
  AgentSettings,
  AgentSettingsPatch,
  FallbackEntry,
  ProjectScopeMode,
  ProviderOption,
  ToolRow,
} from "../../../../shared/agents";

const CUSTOM = "__custom__";

/** Provider + model picker fed by the server's model catalog. */
export function ModelChooser({
  providers,
  provider,
  model,
  onChange,
}: {
  providers: ProviderOption[];
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
}): React.JSX.Element {
  const options = useMemo(() => {
    const list = [...providers];
    if (provider && provider !== "auto" && !list.some((p) => p.slug === provider)) {
      list.push({ slug: provider, name: provider, models: [] });
    }
    return list;
  }, [providers, provider]);
  const models = options.find((p) => p.slug === provider)?.models ?? [];
  const isCustom = !!model && !models.includes(model);
  const [customMode, setCustomMode] = useState(isCustom);

  return (
    <div className="agent-model-chooser">
      <select
        className="input input-sm"
        value={provider}
        onChange={(e) => {
          const next = options.find((p) => p.slug === e.target.value);
          setCustomMode(false);
          onChange(e.target.value, next?.models[0] ?? "");
        }}
      >
        {!provider && <option value="">Choose a provider…</option>}
        {options.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>
      {customMode || models.length === 0 ? (
        <input
          className="input input-sm"
          placeholder="model id"
          value={model}
          onChange={(e) => onChange(provider, e.target.value)}
        />
      ) : (
        <select
          className="input input-sm"
          value={model}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              setCustomMode(true);
              return;
            }
            onChange(provider, e.target.value);
          }}
        >
          {!model && <option value="">Choose a model…</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value={CUSTOM}>Other model…</option>
        </select>
      )}
    </div>
  );
}

function ToolList({
  title,
  rows,
  onToggle,
}: {
  title: string;
  rows: ToolRow[];
  onToggle: (row: ToolRow) => void;
}): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <div className="agent-settings-tools">
      <div className="agent-settings-subtitle">{title}</div>
      {rows.map((row) => (
        <label key={row.name} className="agent-tool-row" title={row.description}>
          <input type="checkbox" checked={row.default} onChange={() => onToggle(row)} />
          <span className="agent-tool-name">{row.label || row.name}</span>
          <span className="agent-tool-desc">{row.description}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Theta: everything about one agent — model, backup models, which tools
 * are on by default and which projects it may work in. Saved on the server.
 */
export function AgentSettingsPanel({
  agent,
  onClose,
  onSaved,
}: {
  agent: string;
  onClose: () => void;
  onSaved?: () => void;
}): React.JSX.Element {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftModel, setDraftModel] = useState({ provider: "", model: "" });
  const [scopeProject, setScopeProject] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([
      window.hermesAPI.agentSettings(agent),
      window.hermesAPI.listModelOptions(),
      window.hermesAPI.listProjects(),
    ]).then(([r, opts, projs]) => {
      if (!alive) return;
      setProviders(opts);
      setProjects(projs);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSettings(r.data);
      setDraftModel({ provider: r.data.model.provider, model: r.data.model.model });
      setScopeProject(r.data.project_scope.project);
    });
    return () => {
      alive = false;
    };
  }, [agent]);

  const save = useCallback(
    async (patch: AgentSettingsPatch): Promise<boolean> => {
      setSaving(true);
      setError(null);
      const r = await window.hermesAPI.updateAgentSettings(agent, patch);
      setSaving(false);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      setSettings(r.data);
      onSaved?.();
      return true;
    },
    [agent, onSaved],
  );

  const modelDirty =
    !!settings &&
    (draftModel.provider !== settings.model.provider || draftModel.model !== settings.model.model);

  const setFallbacks = (fallbacks: FallbackEntry[]): void => {
    void save({ fallbacks: fallbacks.filter((f) => f.provider && f.model) });
  };

  const setScope = (mode: ProjectScopeMode, project = scopeProject): void => {
    if (mode === "fixed" && !project.trim()) {
      setError("Pick or type the project this agent always works in.");
      return;
    }
    void save({ project_scope: { mode, project: project.trim() } });
  };

  return (
    <div className="agent-settings-overlay" onClick={onClose}>
      <div className="agent-settings" onClick={(e) => e.stopPropagation()}>
        <div className="agent-settings-head">
          <h3>{agent === "default" ? "Theta (default agent)" : agent}</h3>
          {saving && <span className="agent-settings-saving">Saving…</span>}
          <button className="agent-settings-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        {error && <div className="agent-settings-error">{error}</div>}
        {!settings ? (
          !error && <div className="agent-settings-loading">Loading…</div>
        ) : (
          <div className="agent-settings-body">
            <section>
              <h4>Model</h4>
              <ModelChooser
                providers={providers}
                provider={draftModel.provider}
                model={draftModel.model}
                onChange={(provider, model) => setDraftModel({ provider, model })}
              />
              {modelDirty && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!draftModel.provider || !draftModel.model || saving}
                  onClick={() => save({ model: draftModel })}
                >
                  Save model
                </button>
              )}
              {providers.length === 0 && (
                <p className="agent-settings-hint">
                  No providers with API keys found on the server. Add keys under Providers.
                </p>
              )}
            </section>

            <section>
              <h4>Backup models</h4>
              <p className="agent-settings-hint">
                Tried in order if the main model fails (rate limits, outages).
              </p>
              {settings.fallbacks.map((f, i) => (
                <div key={`${f.provider}-${f.model}-${i}`} className="agent-fallback-row">
                  <span>
                    {i + 1}. {f.provider} / {f.model}
                  </span>
                  <button
                    className="agent-settings-icon-btn"
                    title="Remove"
                    onClick={() => setFallbacks(settings.fallbacks.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <AddFallback
                providers={providers}
                onAdd={(entry) => setFallbacks([...settings.fallbacks, entry])}
              />
            </section>

            <section>
              <h4>Tools on by default</h4>
              <p className="agent-settings-hint">
                A conversation can still turn tools on or off for itself from the chat header.
              </p>
              <ToolList
                title="Built-in"
                rows={settings.tools.filter((t) => t.kind === "builtin")}
                onToggle={(row) => save({ tools: { [row.name]: !row.default } })}
              />
              <ToolList
                title="MCP servers"
                rows={settings.tools.filter((t) => t.kind === "mcp")}
                onToggle={(row) => save({ tools: { [row.name]: !row.default } })}
              />
            </section>

            <section>
              <h4>Projects</h4>
              <div className="agent-scope-options">
                <label>
                  <input
                    type="radio"
                    checked={settings.project_scope.mode === "all"}
                    onChange={() => setScope("all")}
                  />
                  <span>
                    <strong>All projects</strong> — can look through every project in the vault
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    checked={settings.project_scope.mode === "chat"}
                    onChange={() => setScope("chat")}
                  />
                  <span>
                    <strong>One project per chat</strong> — each conversation picks a project and
                    stays inside it
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    checked={settings.project_scope.mode === "fixed"}
                    onChange={() => setScope("fixed")}
                  />
                  <span>
                    <strong>Always this project</strong> — every conversation is locked to:
                  </span>
                </label>
              </div>
              <div className="agent-scope-project">
                <input
                  className="input input-sm"
                  list="agent-settings-projects"
                  placeholder="Project name"
                  value={scopeProject}
                  onChange={(e) => setScopeProject(e.target.value)}
                />
                <datalist id="agent-settings-projects">
                  {projects.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                {(settings.project_scope.mode !== "fixed" ||
                  scopeProject.trim() !== settings.project_scope.project) && (
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={!scopeProject.trim() || saving}
                    onClick={() => setScope("fixed", scopeProject)}
                  >
                    Lock to this project
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function AddFallback({
  providers,
  onAdd,
}: {
  providers: ProviderOption[];
  onAdd: (entry: FallbackEntry) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ provider: providers[0]?.slug ?? "", model: providers[0]?.models[0] ?? "" });
  if (!open) {
    return (
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        <Plus size={13} /> Add backup model
      </button>
    );
  }
  return (
    <div className="agent-fallback-add">
      <ModelChooser
        providers={providers}
        provider={draft.provider}
        model={draft.model}
        onChange={(provider, model) => setDraft({ provider, model })}
      />
      <button
        className="btn btn-primary btn-sm"
        disabled={!draft.provider || !draft.model}
        onClick={() => {
          onAdd(draft);
          setOpen(false);
        }}
      >
        Add
      </button>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
