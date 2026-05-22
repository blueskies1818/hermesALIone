import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
}

interface ProviderField {
  slug: string;
  label: string;
  envKey: string;
  envBaseUrlKey?: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Known providers
// ---------------------------------------------------------------------------

const PROVIDERS: ProviderField[] = [
  {
    slug: "openai-codex",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    description: "GPT-4o, o4-mini, and Codex models",
  },
  {
    slug: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    envBaseUrlKey: "ANTHROPIC_BASE_URL",
    description: "Claude Opus, Sonnet, and Haiku models",
  },
  {
    slug: "gemini",
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    description: "Gemini 2.5 Pro, Flash, and Nano models",
  },
  {
    slug: "deepseek",
    label: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    envBaseUrlKey: "DEEPSEEK_BASE_URL",
    description: "DeepSeek-V3, R1, and Coder models",
  },
  {
    slug: "openrouter",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    description: "100+ models from multiple providers via one API",
  },
  {
    slug: "mistral",
    label: "Mistral",
    envKey: "MISTRAL_API_KEY",
    envBaseUrlKey: "MISTRAL_BASE_URL",
    description: "Mistral Large, Small, and Codestral models",
  },
  {
    slug: "xai",
    label: "xAI / Grok",
    envKey: "XAI_API_KEY",
    envBaseUrlKey: "XAI_BASE_URL",
    description: "Grok models via direct xAI API",
  },
  {
    slug: "groq",
    label: "Groq",
    envKey: "GROQ_API_KEY",
    description: "Fast inference via LPU hardware",
  },
  {
    slug: "ollama-cloud",
    label: "Ollama (Cloud)",
    envKey: "OLLAMA_API_KEY",
    envBaseUrlKey: "OLLAMA_BASE_URL",
    description: "Cloud-hosted open models via ollama.com",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ModelApisPanelProps {
  profile?: string;
}

function ModelApisPanel({ profile }: ModelApisPanelProps): React.JSX.Element {
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const savedEnvRef = useRef<Record<string, string>>({});
  const [savedModels, setSavedModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  // New model form
  const [newName, setNewName] = useState("");
  const [newProvider, setNewProvider] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [addingModel, setAddingModel] = useState(false);

  // Custom provider form
  const [customSlug, setCustomSlug] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customKey, setCustomKey] = useState("");

  // Dynamic custom providers (added at runtime)
  const [customProviders, setCustomProviders] = useState<ProviderField[]>([]);

  function showStatus(text: string, type: "success" | "error") {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 3000);
  }

  // ------------------------------------------------------------------
  // Load data
  // ------------------------------------------------------------------

  const loadData = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      window.hermesAPI.getEnv(profile),
      window.hermesAPI.listModels(),
    ])
      .then(([env, models]) => {
        setEnvVars(env);
        savedEnvRef.current = { ...env };
        setSavedModels(models);
      })
      .catch((err) => {
        setLoadError(String(err?.message || err || "Failed to load data"));
      })
      .finally(() => setLoading(false));
  }, [profile]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ------------------------------------------------------------------
  // Save env var (API key or base URL)
  // ------------------------------------------------------------------

  const handleSaveEnv = useCallback(
    async (key: string, value: string) => {
      setSaving(key);
      try {
        await window.hermesAPI.setEnv(key, value, profile);
        setEnvVars((prev) => ({ ...prev, [key]: value }));
        showStatus(`${key} saved`, "success");

        // Auto-discover models when API key is saved for a known provider
        const matchedProvider = PROVIDERS.find((p) => p.envKey === key);
        if (matchedProvider && value) {
          const baseUrlKey = matchedProvider.envBaseUrlKey;
          const baseUrl = baseUrlKey ? envVars[baseUrlKey] || "" : "";
          const result = await window.hermesAPI.discoverProviderModels(
            matchedProvider.slug,
            baseUrl || undefined,
            value || undefined,
            profile,
          );
          if (result.status === "ok" && result.models.length > 0) {
            const existing = await window.hermesAPI.listModels();
            let added = 0;
            for (const modelId of result.models) {
              const alreadyExists = existing.some(
                (m) => m.model === modelId && m.provider === matchedProvider.slug,
              );
              if (alreadyExists) continue;
              try {
                await window.hermesAPI.addModel(
                  modelId,
                  matchedProvider.slug,
                  modelId,
                  baseUrl || "",
                );
                added++;
              } catch {
                // skip individual failures
              }
            }
            if (added > 0) {
              const label = result.source === "fallback" ? "(from catalog)" : "";
              showStatus(
                `Saved key + added ${added} model(s) for ${matchedProvider.label} ${label}`,
                "success",
              );
              const models = await window.hermesAPI.listModels();
              setSavedModels(models);
            }
          }
        }
      } catch {
        showStatus(`Failed to save ${key}`, "error");
      } finally {
        setSaving(null);
      }
    },
    [profile, envVars],
  );

  // ------------------------------------------------------------------
  // Discover models for a provider
  // ------------------------------------------------------------------

  const handleDiscover = useCallback(
    async (slug: string) => {
      const envKey = PROVIDERS.find((p) => p.slug === slug)?.envKey;
      const apiKey = envKey ? envVars[envKey] || "" : "";
      const baseUrlKey = PROVIDERS.find((p) => p.slug === slug)?.envBaseUrlKey;
      const baseUrl = baseUrlKey ? envVars[baseUrlKey] || "" : "";

      try {
        const result = await window.hermesAPI.discoverProviderModels(
          slug,
          baseUrl || undefined,
          apiKey || undefined,
          profile,
        );
        if (result.status === "ok") {
          // Save each discovered model to models.json if not already present
          const existing = await window.hermesAPI.listModels();
          let added = 0;
          for (const modelId of result.models) {
            const alreadyExists = existing.some(
              (m) => m.model === modelId && m.provider === slug,
            );
            if (alreadyExists) continue;
            try {
              await window.hermesAPI.addModel(
                modelId,
                slug,
                modelId,
                baseUrl || "",
              );
              added++;
            } catch {
              // skip individual failures
            }
          }
          const label = result.source === "fallback" ? " (from catalog)" : "";
          showStatus(
            added > 0
              ? `Added ${added} model(s) for ${slug}${label}`
              : `${result.models.length} models for ${slug} already saved`,
            "success",
          );
          const models = await window.hermesAPI.listModels();
          setSavedModels(models);
        } else if (result.status === "no-key") {
          showStatus(`Set the API key for ${slug} first`, "error");
        } else {
          showStatus(
            `Could not discover models for ${slug}: ${result.status}`,
            "error",
          );
        }
      } catch {
        showStatus(`Discovery failed for ${slug}`, "error");
      }
    },
    [profile, envVars],
  );

  // ------------------------------------------------------------------
  // Add a new model entry
  // ------------------------------------------------------------------

  const handleAddModel = useCallback(async () => {
    if (!newName || !newProvider || !newModel) return;
    setAddingModel(true);
    try {
      await window.hermesAPI.addModel(
        newName,
        newProvider,
        newModel,
        newBaseUrl,
      );
      setNewName("");
      setNewProvider("");
      setNewModel("");
      setNewBaseUrl("");
      const models = await window.hermesAPI.listModels();
      setSavedModels(models);
      showStatus("Model added", "success");
    } catch {
      showStatus("Failed to add model", "error");
    } finally {
      setAddingModel(false);
    }
  }, [newName, newProvider, newModel, newBaseUrl]);

  // ------------------------------------------------------------------
  // Remove a model entry
  // ------------------------------------------------------------------

  const handleRemoveModel = useCallback(async (id: string) => {
    try {
      await window.hermesAPI.removeModel(id);
      const models = await window.hermesAPI.listModels();
      setSavedModels(models);
      showStatus("Model removed", "success");
    } catch {
      showStatus("Failed to remove model", "error");
    }
  }, []);

  // ------------------------------------------------------------------
  // Add custom provider
  // ------------------------------------------------------------------

  const handleAddCustomProvider = useCallback(async () => {
    if (!customSlug || !customBaseUrl) return;
    try {
      // Save API key if provided
      if (customKey) {
        await window.hermesAPI.setEnv(
          `${customSlug.toUpperCase()}_API_KEY`,
          customKey,
          profile,
        );
      }
      // Save base URL so discovery can find it
      await window.hermesAPI.setEnv(
        `${customSlug.toUpperCase()}_BASE_URL`,
        customBaseUrl,
        profile,
      );

      // Register as a dynamic provider so it shows in the grid
      const label = customLabel || customSlug;
      setCustomProviders((prev) => {
        const exists = prev.some((p) => p.slug === customSlug);
        if (exists) return prev;
        return [
          ...prev,
          {
            slug: customSlug,
            label,
            envKey: `${customSlug.toUpperCase()}_API_KEY`,
            envBaseUrlKey: `${customSlug.toUpperCase()}_BASE_URL`,
            description: customBaseUrl,
          },
        ];
      });

      setCustomSlug("");
      setCustomLabel("");
      setCustomBaseUrl("");
      setCustomKey("");

      // Auto-discover models from the custom endpoint
      const result = await window.hermesAPI.discoverProviderModels(
        customSlug,
        customBaseUrl || undefined,
        customKey || undefined,
        profile,
      );

      if (result.status === "ok" && result.models.length > 0) {
        // Save discovered models
        const existing = await window.hermesAPI.listModels();
        let added = 0;
        for (const modelId of result.models) {
          const alreadyExists = existing.some(
            (m) => m.model === modelId && m.provider === customSlug,
          );
          if (alreadyExists) continue;
          try {
            await window.hermesAPI.addModel(
              modelId,
              customSlug,
              modelId,
              customBaseUrl || "",
            );
            added++;
          } catch {
            // skip individual failures
          }
        }
        const label2 = result.source === "fallback" ? " (from catalog)" : "";
        showStatus(
          added > 0
            ? `Provider added + ${added} model(s) discovered${label2}`
            : `Provider "${customSlug}" configured — add models below`,
          "success",
        );
        const models = await window.hermesAPI.listModels();
        setSavedModels(models);
      } else {
        // Discovery failed or returned empty — pre-fill the Add Model form
        setNewProvider(customSlug);
        setNewBaseUrl(customBaseUrl);
        showStatus(
          `Provider "${customSlug}" added. No models auto-discovered — enter model ID below.`,
          "success",
        );
      }
    } catch {
      showStatus("Failed to configure custom provider", "error");
    }
  }, [customSlug, customLabel, customBaseUrl, customKey, profile]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  if (loading) {
    return (
      <div className="schedules-empty">
        <p className="schedules-empty-text">Loading...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="schedules-empty">
        <p className="schedules-empty-text" style={{ color: "var(--color-error)" }}>
          {loadError}
        </p>
        <button className="btn-sm btn-primary" style={{ marginTop: 12 }} onClick={loadData}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="model-apis-panel">
      {statusMsg && (
        <div
          className={`config-status ${
            statusMsg.type === "error" ? "config-status-error" : ""
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      <div className="model-apis-autosave-hint">
        Changes on this tab save automatically — no need to click Save.
      </div>

      {/* ── Provider API Keys ─────────────────────────────────────── */}
      <div className="config-section-header">
        <span className="config-section-label">Provider API Keys</span>
        <div className="config-section-line" />
      </div>
      <p className="config-field-desc" style={{ marginBottom: 12 }}>
        Set API keys for the providers you want to use. Keys are stored as
        environment variables and never leave your machine.
      </p>

      <div className="model-apis-provider-grid">
        {[...PROVIDERS, ...customProviders].map((p) => {
          const currentKey = envVars[p.envKey] || "";
          const currentBaseUrl = p.envBaseUrlKey
            ? envVars[p.envBaseUrlKey] || ""
            : "";
          return (
            <div key={p.slug} className="model-apis-provider-card">
              <div className="model-apis-provider-header">
                <span className="model-apis-provider-name">{p.label}</span>
                <span className="model-apis-provider-desc">
                  {p.description}
                </span>
              </div>

              <div className="model-apis-provider-fields">
                <input
                  className="input config-input"
                  type="password"
                  placeholder={
                    currentKey
                      ? "API key set (••••••••)"
                      : `${p.envKey}`
                  }
                  value={currentKey}
                  onChange={(e) =>
                    setEnvVars((prev) => ({
                      ...prev,
                      [p.envKey]: e.target.value,
                    }))
                  }
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== (savedEnvRef.current[p.envKey] || "")) {
                      handleSaveEnv(p.envKey, v);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = e.currentTarget.value;
                      handleSaveEnv(p.envKey, v);
                    }
                  }}
                />

                {p.envBaseUrlKey && (
                  <input
                    className="input config-input"
                    type="text"
                    placeholder={`Base URL (defaults to ${p.label} API)`}
                    value={currentBaseUrl}
                    onChange={(e) =>
                      setEnvVars((prev) => ({
                        ...prev,
                        [p.envBaseUrlKey!]: e.target.value,
                      }))
                    }
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (savedEnvRef.current[p.envBaseUrlKey!] || "")) {
                        handleSaveEnv(p.envBaseUrlKey!, v);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const v = e.currentTarget.value;
                        handleSaveEnv(p.envBaseUrlKey!, v);
                      }
                    }}
                  />
                )}
              </div>

              <div className="model-apis-provider-actions">
                {saving === p.envKey ? (
                  <span className="model-apis-saving">Saving...</span>
                ) : (
                  <button
                    className="btn-sm btn-secondary"
                    onClick={() => handleDiscover(p.slug)}
                  >
                    Discover Models
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Custom Provider ───────────────────────────────────────── */}
      <div className="config-section-header">
        <span className="config-section-label">Custom Provider</span>
        <div className="config-section-line" />
      </div>
      <p className="config-field-desc" style={{ marginBottom: 12 }}>
        Add a self-hosted or custom provider with its own endpoint and
        optional API key.
      </p>

      <div className="model-apis-custom-row">
        <input
          className="input config-input"
          type="text"
          placeholder="Provider slug (e.g. my-server)"
          value={customSlug}
          onChange={(e) => setCustomSlug(e.target.value)}
        />
        <input
          className="input config-input"
          type="text"
          placeholder="Display name (e.g. My Server)"
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
        />
        <input
          className="input config-input"
          type="text"
          placeholder="Base URL (e.g. http://localhost:11434/v1)"
          value={customBaseUrl}
          onChange={(e) => setCustomBaseUrl(e.target.value)}
        />
        <input
          className="input config-input"
          type="password"
          placeholder="API key (optional)"
          value={customKey}
          onChange={(e) => setCustomKey(e.target.value)}
        />
        <button
          className="btn-sm btn-primary"
          onClick={handleAddCustomProvider}
          disabled={!customSlug || !customBaseUrl}
        >
          Add Provider
        </button>
      </div>

      {/* ── Local Models ──────────────────────────────────────────── */}
      <div className="config-section-header">
        <span className="config-section-label">Local Models</span>
        <div className="config-section-line" />
      </div>
      <p className="config-field-desc" style={{ marginBottom: 12 }}>
        Run models locally via Ollama, LM Studio, or any OpenAI-compatible
        server. Set the base URL to your local endpoint (e.g.{" "}
        <code>http://localhost:11434/v1</code> for Ollama).
      </p>

      <div className="model-apis-local-hint">
        <div className="model-apis-local-item">
          <strong>Ollama</strong>
          <span>Install Ollama, pull a model, then set base URL to{" "}
            <code>http://localhost:11434/v1</code> and provider to{" "}
            <code>ollama-cloud</code>.
          </span>
        </div>
        <div className="model-apis-local-item">
          <strong>LM Studio</strong>
          <span>Start the local server in LM Studio, then set base URL to{" "}
            <code>http://localhost:1234/v1</code>.
          </span>
        </div>
        <div className="model-apis-local-item">
          <strong>Custom OpenAI-compatible</strong>
          <span>Any server with an OpenAI-compatible API works. Set the base
            URL and provider slug above.
          </span>
        </div>
      </div>

      {/* ── Saved Models ──────────────────────────────────────────── */}
      <div className="config-section-header">
        <span className="config-section-label">
          Saved Models ({savedModels.length})
        </span>
        <div className="config-section-line" />
      </div>

      {/* Add model form */}
      <div className="model-apis-add-row">
        <input
          className="input config-input"
          type="text"
          placeholder="Display name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <select
          className="input config-input"
          value={newProvider}
          onChange={(e) => setNewProvider(e.target.value)}
          style={{ minWidth: 150 }}
        >
          <option value="">Select provider...</option>
          {[...PROVIDERS, ...customProviders].map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.label} ({p.slug})
            </option>
          ))}
        </select>
        <input
          className="input config-input"
          type="text"
          placeholder="Model ID (e.g. gpt-4o)"
          value={newModel}
          onChange={(e) => setNewModel(e.target.value)}
        />
        <input
          className="input config-input"
          type="text"
          placeholder="Base URL (optional)"
          value={newBaseUrl}
          onChange={(e) => setNewBaseUrl(e.target.value)}
        />
        <button
          className="btn-sm btn-primary"
          onClick={handleAddModel}
          disabled={!newName || !newProvider || !newModel || addingModel}
        >
          {addingModel ? "Adding..." : "Add Model"}
        </button>
      </div>

      {savedModels.length === 0 ? (
        <div className="schedules-empty" style={{ marginTop: 16 }}>
          <p className="schedules-empty-text">
            No saved models. Add one above or use Discover Models on a
            provider card.
          </p>
        </div>
      ) : (
        <div className="model-apis-model-list">
          {savedModels.map((m) => (
            <div key={m.id} className="model-apis-model-item">
              <div className="model-apis-model-info">
                <span className="model-apis-model-name">{m.name}</span>
                <span className="model-apis-model-detail">
                  {m.provider} / {m.model}
                </span>
                {m.baseUrl && (
                  <span className="model-apis-model-url">{m.baseUrl}</span>
                )}
              </div>
              <button
                className="btn-ghost model-apis-model-remove"
                onClick={() => handleRemoveModel(m.id)}
                title="Remove model"
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
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ModelApisPanel;
