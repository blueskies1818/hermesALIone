import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useI18n } from "../../components/useI18n";
import ModelApisPanel from "./ModelApisPanel";

interface ConfigProps {
  profile?: string;
  visible?: boolean;
}

interface SchemaField {
  type?: string;
  default?: unknown;
  description?: string;
  category?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  secret?: boolean;
}

type SchemaMap = Record<string, SchemaField>;

function getNested(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setNested(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(obj));
  const parts = path.split(".");
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return clone;
}

const CATEGORY_LABELS: Record<string, string> = {
  model_apis: "Model APIs",
  general: "General",
  agent: "Agent",
  terminal: "Terminal",
  display: "Display",
  delegation: "Delegation",
  memory: "Memory",
  compression: "Compression",
  security: "Security",
  browser: "Browser",
  voice: "Voice",
  tts: "TTS",
  stt: "STT",
  logging: "Logging",
  discord: "Discord",
  auxiliary: "Auxiliary",
  bedrock: "Bedrock",
  curator: "Curator",
  kanban: "Kanban",
  model_catalog: "Models",
  openrouter: "OpenRouter",
  sessions: "Sessions",
  tool_loop_guardrails: "Guardrails",
  tool_output: "Tool Output",
  updates: "Updates",
};

function Config({ profile: _profile, visible }: ConfigProps): React.JSX.Element {
  const { t } = useI18n();

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [schema, setSchema] = useState<SchemaMap | null>(null);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<Record<string, unknown> | null>(null);
  const [configPath, setConfigPath] = useState<string>("config.yaml");
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlText, setYamlText] = useState("");
  const [yamlLoading, setYamlLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");
  const [statusMsg, setStatusMsg] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<
    { mode: "yaml-toggle" } | null
  >(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSavedForm = useRef<string>("");
  const lastSavedYaml = useRef<string>("");

  // Reload from backend
  const reloadConfig = useCallback(() => {
    window.hermesAPI.getFullConfig().then((cfg) => {
      setConfig(cfg);
      lastSavedForm.current = JSON.stringify(cfg);
    }).catch(() => {});
    window.hermesAPI
      .getConfigSchema()
      .then((resp) => {
        setSchema(resp.fields as SchemaMap);
        setCategoryOrder(resp.category_order ?? []);
      })
      .catch(() => {});
    window.hermesAPI.getConfigDefaults().then(setDefaults).catch(() => {});
    window.hermesAPI
      .getConfigRaw()
      .then((raw) => {
        if (raw) setConfigPath("config.yaml");
        setYamlText(raw);
        lastSavedYaml.current = raw;
        setYamlLoading(false);
      })
      .catch(() => {});
  }, []);

  // Initial load
  useEffect(() => {
    window.hermesAPI.getFullConfig().then((cfg) => {
      setConfig(cfg);
      lastSavedForm.current = JSON.stringify(cfg);
    }).catch(() => {});
    window.hermesAPI
      .getConfigSchema()
      .then((resp) => {
        setSchema(resp.fields as SchemaMap);
        setCategoryOrder(resp.category_order ?? []);
      })
      .catch(() => {});
    window.hermesAPI.getConfigDefaults().then(setDefaults).catch(() => {});
  }, []);

  // Refresh when tab becomes visible
  useEffect(() => {
    if (visible) {
      reloadConfig();
    }
  }, [visible, reloadConfig]);

  useEffect(() => {
    if (categoryOrder.length > 0 && !activeCategory) {
      setActiveCategory(categoryOrder[0]);
    }
  }, [categoryOrder, activeCategory]);

  useEffect(() => {
    if (yamlMode && !yamlText) {
      setYamlLoading(true);
      window.hermesAPI
        .getConfigRaw()
        .then((raw) => {
          setYamlText(raw);
          lastSavedYaml.current = raw;
        })
        .catch(() => showStatus("Failed to load raw config", "error"))
        .finally(() => setYamlLoading(false));
    }
  }, [yamlMode]);

  function showStatus(text: string, type: "success" | "error") {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 3000);
  }

  const isDirty = yamlMode
    ? yamlText !== lastSavedYaml.current
    : JSON.stringify(config) !== lastSavedForm.current;

  function attemptToggleYaml() {
    if (isDirty) {
      setConfirmDiscard({ mode: "yaml-toggle" });
    } else {
      setYamlMode(!yamlMode);
    }
  }

  function discardAndProceed() {
    if (confirmDiscard?.mode === "yaml-toggle") {
      if (yamlMode) {
        // leaving YAML → form; reload form config from backend
        window.hermesAPI.getFullConfig().then((cfg) => {
          setConfig(cfg);
          lastSavedForm.current = JSON.stringify(cfg);
        }).catch(() => {});
      } else {
        // entering YAML; reload raw
        setYamlLoading(true);
        window.hermesAPI.getConfigRaw().then((raw) => {
          setYamlText(raw);
          lastSavedYaml.current = raw;
          setYamlLoading(false);
        }).catch(() => {
          setYamlLoading(false);
        });
      }
      setYamlMode(!yamlMode);
    }
    setConfirmDiscard(null);
  }

  const categories = useMemo(() => {
    const allCats: string[] = schema
      ? [
          ...new Set(
            Object.values(schema).map((s) =>
              String(s.category ?? "general"),
            ),
          ),
        ]
      : [];
    const ordered = categoryOrder.filter((c) => allCats.includes(c));
    const extra = allCats.filter((c) => !categoryOrder.includes(c)).sort();
    // Merge + dedup + ensure Model APIs is first
    const seen = new Set([...ordered, ...extra]);
    seen.add("model_apis");
    return [...seen];
  }, [schema, categoryOrder]);

  const effectiveCategory = activeCategory || categories[0] || "";

  const activeFields = useMemo(() => {
    if (!schema) return [];
    if (searchQuery.trim()) {
      const lower = searchQuery.toLowerCase();
      return Object.entries(schema).filter(([key, s]) => {
        const label = (key.split(".").pop() ?? key).replace(/_/g, " ");
        return (
          key.toLowerCase().includes(lower) ||
          label.toLowerCase().includes(lower) ||
          String(s.category ?? "").toLowerCase().includes(lower) ||
          String(s.description ?? "").toLowerCase().includes(lower)
        );
      });
    }
    return Object.entries(schema).filter(
      ([, s]) => String(s.category ?? "general") === effectiveCategory,
    );
  }, [schema, effectiveCategory, searchQuery]);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      await window.hermesAPI.saveFullConfig(config);
      lastSavedForm.current = JSON.stringify(config);
      showStatus("Config saved", "success");
    } catch (e) {
      showStatus(`Failed to save: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleYamlSave() {
    setSaving(true);
    try {
      await window.hermesAPI.saveConfigRaw(yamlText);
      lastSavedYaml.current = yamlText;
      showStatus("YAML config saved", "success");
      const cfg = await window.hermesAPI.getFullConfig();
      setConfig(cfg);
      lastSavedForm.current = JSON.stringify(cfg);
    } catch (e) {
      showStatus(`Failed to save YAML: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!defaults || !config) return;
    let next = config;
    for (const [key] of activeFields) {
      next = setNested(next, key, getNested(defaults, key));
    }
    setConfig(next);
    showStatus("Reset to defaults", "success");
  }

  function handleExport() {
    if (!config) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hermes-config.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string);
        setConfig(imported);
        showStatus("Config imported", "success");
      } catch {
        showStatus("Invalid JSON", "error");
      }
    };
    reader.readAsText(file);
  }

  function handleRefresh() {
    reloadConfig();
    showStatus("Reloaded from backend", "success");
  }

  function renderField(key: string, s: SchemaField) {
    const value = getNested(config!, key);
    const label = (key.split(".").pop() ?? key).replace(/_/g, " ");
    const desc = s.description ?? "";

    if (s.type === "boolean") {
      return (
        <div className="config-field">
          <label className="config-field-label">
            <input
              type="checkbox"
              className="config-checkbox"
              checked={!!value}
              onChange={(e) =>
                setConfig(setNested(config!, key, e.target.checked))
              }
            />
            <span>{label}</span>
          </label>
          {desc && <p className="config-field-desc">{desc}</p>}
        </div>
      );
    }

    if (s.enum && Array.isArray(s.enum)) {
      return (
        <div className="config-field">
          <label className="config-field-label-text">{label}</label>
          {desc && <p className="config-field-desc">{desc}</p>}
          <select
            className="input config-select"
            value={String(value ?? "")}
            onChange={(e) =>
              setConfig(setNested(config!, key, e.target.value))
            }
          >
            {s.enum.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (s.type === "integer" || s.type === "number") {
      return (
        <div className="config-field">
          <label className="config-field-label-text">{label}</label>
          {desc && <p className="config-field-desc">{desc}</p>}
          <input
            className="input config-input"
            type="number"
            value={value != null ? String(value) : ""}
            min={s.minimum}
            max={s.maximum}
            placeholder={s.default != null ? String(s.default) : ""}
            onChange={(e) => {
              const v =
                e.target.value === ""
                  ? undefined
                  : s.type === "integer"
                    ? parseInt(e.target.value, 10)
                    : parseFloat(e.target.value);
              setConfig(setNested(config!, key, v));
            }}
          />
        </div>
      );
    }

    return (
      <div className="config-field">
        <label className="config-field-label-text">{label}</label>
        {desc && <p className="config-field-desc">{desc}</p>}
        <input
          className="input config-input"
          type={s.secret ? "password" : "text"}
          value={value != null ? String(value) : ""}
          placeholder={s.default != null ? String(s.default) : ""}
          onChange={(e) =>
            setConfig(setNested(config!, key, e.target.value || undefined))
          }
        />
      </div>
    );
  }

  function renderFieldWithSections(
    fields: [string, SchemaField][],
    showCategoryBadge = false,
  ) {
    let lastSection = "";
    let lastCat = "";
    return fields.map(([key, s]) => {
      const parts = key.split(".");
      const section = parts.length > 1 ? parts[0] : "";
      const cat = String(s.category ?? "general");

      const showCatBadge = showCategoryBadge && cat !== lastCat;
      const showSection =
        !showCategoryBadge &&
        section &&
        section !== lastSection &&
        section !== effectiveCategory;
      lastSection = section;
      lastCat = cat;

      return (
        <div key={key}>
          {showCatBadge && (
            <div className="config-section-header">
              <span className="config-section-label">
                {CATEGORY_LABELS[cat] ?? cat}
              </span>
              <div className="config-section-line" />
            </div>
          )}
          {showSection && (
            <div className="config-section-header">
              <span className="config-section-label">
                {section.replace(/_/g, " ")}
              </span>
              <div className="config-section-line" />
            </div>
          )}
          {renderField(key, s)}
        </div>
      );
    });
  }

  if (!config || !schema) {
    return (
      <div className="schedules-container">
        <div className="schedules-empty">
          <p className="schedules-empty-text">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="schedules-container">
      {/* Header */}
      <div className="schedules-header">
        <div>
          <h2 className="schedules-title">{t("navigation.config")}</h2>
          <p className="schedules-subtitle">
            <code className="config-path-code">{configPath}</code>
          </p>
        </div>
        <div className="schedules-header-actions">
          {/* Form/YAML toggle + Save button group */}
          <div className="config-save-group">
            <button
              className={`btn-sm config-mode-btn ${
                !yamlMode ? "btn-primary" : "btn-secondary"
              }`}
              onClick={() => {
                if (yamlMode) attemptToggleYaml();
              }}
            >
              Form
            </button>
            <button
              className={`btn-sm config-mode-btn ${
                yamlMode ? "btn-primary" : "btn-secondary"
              }`}
              onClick={() => {
                if (!yamlMode) attemptToggleYaml();
              }}
            >
              YAML
            </button>
            <button
              className={`btn-sm config-save-btn ${
                !yamlMode && effectiveCategory === "model_apis"
                  ? "btn-secondary"
                  : "btn-primary"
              }`}
              onClick={yamlMode ? handleYamlSave : handleSave}
              disabled={
                yamlMode
                  ? saving || !isDirty
                  : effectiveCategory === "model_apis"
                    ? true
                    : saving || !isDirty
              }
            >
              {saving
                ? "Saving..."
                : !yamlMode && effectiveCategory === "model_apis"
                  ? "Auto-saved"
                  : "Save"}
            </button>
          </div>

          {/* Secondary actions */}
          <button
            className="btn-ghost"
            onClick={handleRefresh}
            title="Reload from backend"
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
          <button
            className="btn-ghost"
            onClick={handleExport}
            title="Export as JSON"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
          </button>
          <button
            className="btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            title="Import JSON"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={handleImport}
          />
          {!yamlMode && (
            <button
              className="btn-ghost"
              onClick={handleReset}
              title="Reset to defaults"
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
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Dirty indicator */}
      {isDirty && (
        <div className="config-status config-status-dirty">
          You have unsaved changes
        </div>
      )}

      {statusMsg && (
        <div
          className={`config-status-toast ${
            statusMsg.type === "error" ? "config-status-toast-error" : ""
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {yamlMode ? (
        <div className="config-yaml-editor">
          {yamlLoading ? (
            <div className="schedules-empty">
              <p className="schedules-empty-text">Loading...</p>
            </div>
          ) : (
            <textarea
              className="config-yaml-textarea"
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              spellCheck={false}
            />
          )}
        </div>
      ) : (
        <div className="config-layout">
          <aside className="config-sidebar">
            <div className="config-sidebar-search">
              <input
                className="input"
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="config-categories">
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`config-category-item ${
                    !searchQuery && effectiveCategory === cat
                      ? "config-category-active"
                      : ""
                  }`}
                  onClick={() => {
                    setSearchQuery("");
                    setActiveCategory(cat);
                  }}
                >
                  {CATEGORY_LABELS[cat] ?? cat}
                </button>
              ))}
            </div>
          </aside>

          <div className="config-fields">
            {!searchQuery && effectiveCategory === "model_apis" ? (
              <ModelApisPanel profile={_profile} />
            ) : (
              <>
                {searchQuery && (
                  <div className="config-search-header">
                    Search results ({activeFields.length})
                  </div>
                )}
                {activeFields.length === 0 ? (
                  <div className="schedules-empty">
                    <p className="schedules-empty-text">No fields found</p>
                  </div>
                ) : (
                  renderFieldWithSections(
                    activeFields,
                    searchQuery.trim().length > 0,
                  )
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirm discard dialog */}
      {confirmDiscard && (
        <div
          className="plugins-overlay"
          onClick={() => setConfirmDiscard(null)}
        >
          <div
            className="plugins-confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="plugins-confirm-title">Unsaved Changes</p>
            <p className="plugins-confirm-desc">
              You have unsaved changes. Discard them and switch mode?
            </p>
            <div className="plugins-confirm-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmDiscard(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={discardAndProceed}
              >
                Discard & Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Config;
