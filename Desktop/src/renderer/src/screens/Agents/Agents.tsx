import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, ChatBubble, ChevronDown, Check } from "../../assets/icons";
import HermesLogo from "../../components/common/HermesLogo";
import { useI18n } from "../../components/useI18n";

interface ProfileInfo {
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

interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
}

interface AgentsProps {
  activeProfile: string;
  onSelectProfile: (name: string) => void;
  onChatWith: (name: string) => void;
}

function AgentAvatar({ name }: { name: string }): React.JSX.Element {
  if (name === "default") {
    return (
      <div className="agents-card-avatar agents-card-avatar-icon">
        <HermesLogo size={22} />
      </div>
    );
  }
  return (
    <div className="agents-card-avatar">{name.charAt(0).toUpperCase()}</div>
  );
}

function Agents({
  activeProfile,
  onSelectProfile,
  onChatWith,
}: AgentsProps): React.JSX.Element {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [cloneConfig, setCloneConfig] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Model editing state — which profile card has the model picker open
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [savingModel, setSavingModel] = useState(false);

  const loadProfiles = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listProfiles();
    setProfiles(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Load configured model entries (providers + models with valid API keys)
  useEffect(() => {
    window.hermesAPI.listModels().then(setModelList).catch(() => setModelList([]));
  }, []);

  async function handleSetModel(
    profileName: string,
    provider: string,
    model: string,
    baseUrl: string,
  ): Promise<void> {
    setSavingModel(true);
    try {
      await window.hermesAPI.setModelConfig(provider, model, baseUrl, profileName);
      setEditingModel(null);
      loadProfiles();
    } finally {
      setSavingModel(false);
    }
  }

  async function handleCreate(): Promise<void> {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    setCreating(true);
    setError("");
    const result = await window.hermesAPI.createProfile(name, cloneConfig);
    setCreating(false);
    if (result.success) {
      setShowCreate(false);
      setNewName("");
      loadProfiles();
    } else {
      setError(result.error || t("agents.createFailed"));
    }
  }

  async function handleDelete(name: string): Promise<void> {
    const result = await window.hermesAPI.deleteProfile(name);
    if (result.success) {
      if (activeProfile === name) onSelectProfile("default");
      loadProfiles();
    }
    setConfirmDelete(null);
  }

  async function handleSelect(name: string): Promise<void> {
    await window.hermesAPI.setActiveProfile(name);
    onSelectProfile(name);
    loadProfiles();
  }

  function providerLabel(provider: string): string {
    if (!provider || provider === "auto") return t("agents.auto");
    if (provider === "custom") return t("agents.local");
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  if (loading) {
    return (
      <div className="agents-container">
        <div className="agents-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="agents-container">
      <div className="agents-header">
        <div>
          <h2 className="agents-title">{t("agents.title")}</h2>
          <p className="agents-subtitle">{t("agents.subtitle")}</p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={14} />
          {t("agents.newAgent")}
        </button>
      </div>

      {showCreate && (
        <div className="agents-create">
          <input
            className="input"
            placeholder={t("agents.namePlaceholder")}
            value={newName}
            onChange={(e) => {
              const v = e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "");
              setNewName(v);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <label className="agents-create-clone">
            <input
              type="checkbox"
              checked={cloneConfig}
              onChange={(e) => setCloneConfig(e.target.checked)}
            />
            <span>{t("agents.cloneConfig")}</span>
          </label>
          {error && <div className="agents-create-error">{error}</div>}
          <div className="agents-create-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? t("agents.creating") : t("agents.create")}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setShowCreate(false);
                setError("");
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="agents-grid">
        {profiles.map((p) => (
          <div
            key={p.name}
            className={`agents-card ${activeProfile === p.name ? "active" : ""}`}
            onClick={() => handleSelect(p.name)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSelect(p.name);
            }}
          >
            <div className="agents-card-header">
              <AgentAvatar name={p.name} />
              <div className="agents-card-info">
                <div className="agents-card-name">{p.name}</div>
                <div className="agents-card-provider">
                  {providerLabel(p.provider)}
                </div>
              </div>
              {activeProfile === p.name && (
                <span className="agents-card-active-badge">
                  {t("agents.active")}
                </span>
              )}
            </div>
            <div
              className="agents-card-model agents-card-model-editable"
              onClick={(e) => {
                e.stopPropagation();
                setEditingModel(editingModel === p.name ? null : p.name);
              }}
              title="Click to change model"
            >
              {editingModel === p.name ? (
                <ModelPickerInline
                  currentProvider={p.provider}
                  currentModel={p.model || ""}
                  modelList={modelList}
                  saving={savingModel}
                  onSelect={(provider, model, baseUrl) =>
                    handleSetModel(p.name, provider, model, baseUrl)
                  }
                  onCancel={() => setEditingModel(null)}
                />
              ) : (
                <span className="agents-card-model-text">
                  {p.model ? p.model.split("/").pop() : t("agents.noModel")}
                  <ChevronDown size={12} className="agents-card-model-chevron" />
                </span>
              )}
            </div>
            <div className="agents-card-stats">
              <span>{t("agents.skillsCount", { count: p.skillCount })}</span>
              <span className="agents-card-dot" />
              {p.gatewayRunning ? (
                <span className="agents-card-gateway-on">
                  {t("agents.gatewayRunning")}
                </span>
              ) : (
                <span>{t("agents.gatewayOff")}</span>
              )}
            </div>
            <div className="agents-card-footer">
              <button
                className="btn btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onChatWith(p.name);
                }}
              >
                <ChatBubble size={13} />
                {t("agents.chat")}
              </button>
              {!p.isDefault &&
                (confirmDelete === p.name ? (
                  <div
                    className="agents-card-confirm-delete"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>{t("agents.deleteConfirm")}</span>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(p.name);
                      }}
                    >
                      {t("agents.yes")}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(null);
                      }}
                    >
                      {t("agents.no")}
                    </button>
                  </div>
                ) : (
                  <button
                    className="agents-card-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(p.name);
                    }}
                    title={t("agents.deleteTitle")}
                  >
                    <Trash size={14} />
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ModelPickerInlineProps {
  currentProvider: string;
  currentModel: string;
  modelList: ModelEntry[];
  saving: boolean;
  onSelect: (provider: string, model: string, baseUrl: string) => void;
  onCancel: () => void;
}

function ModelPickerInline({
  currentProvider,
  currentModel,
  modelList,
  saving,
  onSelect,
  onCancel,
}: ModelPickerInlineProps): React.JSX.Element {
  const providers = [...new Set(modelList.map((m) => m.provider))].filter(Boolean);
  const [provider, setProvider] = useState(currentProvider || providers[0] || "anthropic");
  const [model, setModel] = useState(currentModel || "");
  const [baseUrl] = useState("");

  // Filter models for selected provider
  const providerModels = modelList.filter((m) => m.provider === provider);

  useEffect(() => {
    if (providerModels.length > 0 && !model) {
      setModel(providerModels[0].model);
    }
  }, [provider, providerModels, model]);

  function handleSave(): void {
    if (!model.trim()) return;
    const entry = modelList.find((m) => m.provider === provider && m.model === model);
    onSelect(provider, model.trim(), entry?.baseUrl || baseUrl);
  }

  return (
    <div
      className="agents-model-picker"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <select
        className="input input-sm"
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value);
          setModel("");
        }}
      >
        {providers.length === 0 && (
          <option value="anthropic">anthropic</option>
        )}
        {providers.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <div className="agents-model-picker-model-row">
        {providerModels.length > 0 ? (
          <select
            className="input input-sm"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {providerModels.map((m) => (
              <option key={m.id} value={m.model}>
                {m.model}
              </option>
            ))}
            <option value="__custom__">Custom model...</option>
          </select>
        ) : (
          <input
            className="input input-sm"
            placeholder="model name (e.g. claude-sonnet-4-6)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
        )}
        {model === "__custom__" && (
          <input
            className="input input-sm"
            placeholder="model name"
            value=""
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            autoFocus
          />
        )}
      </div>
      <div className="agents-model-picker-actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={saving || !model.trim() || model === "__custom__"}
        >
          <Check size={12} />
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>
          X
        </button>
      </div>
    </div>
  );
}

export default Agents;
