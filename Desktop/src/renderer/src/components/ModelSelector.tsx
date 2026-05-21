import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronDown, Search } from "../assets/icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
}

interface ModelSelectorProps {
  profile?: string;
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  onSelect: (provider: string, model: string, baseUrl: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ModelSelector({
  profile,
  currentModel,
  currentProvider,
  currentBaseUrl,
  onSelect,
}: ModelSelectorProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<ModelEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load saved models + validate current selection still exists
  useEffect(() => {
    window.hermesAPI.listModels().then((list) => {
      setModels(list);
      // If the currently selected model no longer exists, clear it
      if (
        currentModel &&
        currentProvider &&
        !list.some(
          (m) => m.model === currentModel && m.provider === currentProvider,
        )
      ) {
        onSelect("", "", "");
      }
    }).catch(() => {});
  }, [profile]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus input + refresh model list when opened + validate selection
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      window.hermesAPI.listModels().then((list) => {
        setModels(list);
        if (
          currentModel &&
          currentProvider &&
          !list.some(
            (m) => m.model === currentModel && m.provider === currentProvider,
          )
        ) {
          onSelect("", "", "");
        }
      }).catch(() => {});
    }
  }, [open]);

  // Filter models by search query
  const filtered = query
    ? models.filter((m) => {
        const q = query.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.model.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q)
        );
      })
    : models;

  // Pick a "custom" free-text entry when the query doesn't match anything
  const showCustom = query && filtered.length === 0;

  const displayLabel = currentModel || "Select model";

  const handleSelect = useCallback(
    (entry: ModelEntry) => {
      onSelect(entry.provider, entry.model, entry.baseUrl);
      setOpen(false);
      setQuery("");
    },
    [onSelect],
  );

  const handleCustom = useCallback(() => {
    if (!query) return;
    onSelect("custom", query, currentBaseUrl || "");
    setOpen(false);
    setQuery("");
  }, [query, currentBaseUrl, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
      if (e.key === "Enter" && showCustom) {
        handleCustom();
      }
    },
    [showCustom, handleCustom],
  );

  return (
    <div
      className="model-selector"
      ref={containerRef}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Collapsed bar */}
      {!open && (
        <button
          className="model-selector-bar"
          onClick={() => setOpen(true)}
          title={`${currentProvider}/${currentModel}`}
        >
          <span className="model-selector-label">{displayLabel}</span>
          <ChevronDown size={14} />
        </button>
      )}

      {/* Expanded search + dropdown */}
      {open && (
        <div className="model-selector-dropdown">
          <div className="model-selector-search">
            <Search size={14} />
            <input
              ref={inputRef}
              type="text"
              className="model-selector-input"
              placeholder="Search models..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="model-selector-list">
            {filtered.map((m) => (
              <button
                key={m.id}
                className={`model-selector-item ${
                  m.model === currentModel && m.provider === currentProvider
                    ? "active"
                    : ""
                }`}
                onClick={() => handleSelect(m)}
              >
                <span className="model-selector-item-name">{m.name}</span>
                <span className="model-selector-item-provider">
                  {m.provider}
                </span>
              </button>
            ))}

            {showCustom && (
              <button
                className="model-selector-item model-selector-item-custom"
                onClick={handleCustom}
              >
                <span className="model-selector-item-name">
                  Use "{query}"
                </span>
                <span className="model-selector-item-provider">custom</span>
              </button>
            )}

            {!query && filtered.length === 0 && (
              <div className="model-selector-empty">
                No saved models. Add one in Settings → Config → Model APIs.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ModelSelector;
