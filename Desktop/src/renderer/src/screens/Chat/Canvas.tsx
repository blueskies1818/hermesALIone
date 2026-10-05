import { createContext, memo, useCallback, useContext, useEffect, useState } from "react";
import { Download, Eye, Pencil, Save, X } from "lucide-react";
import { AgentMarkdown } from "../../components/AgentMarkdown";

/** A server-side text file opened in the canvas. */
export interface CanvasFile {
  path: string;
  name: string;
  mime: string;
}

export const CanvasContext = createContext<((file: CanvasFile) => void) | null>(null);

/** Open a file in the chat's canvas (no-op outside the chat screen). */
export function useOpenCanvas(): ((file: CanvasFile) => void) | null {
  return useContext(CanvasContext);
}

function decodeText(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Theta: side panel for documents and code the agent wrote. Loads the file
 * from the server, lets you edit (or preview Markdown) and saves it back.
 */
export const CanvasPanel = memo(function CanvasPanel({
  file,
  onClose,
}: {
  file: CanvasFile;
  onClose: () => void;
}): React.JSX.Element {
  const isMarkdown = /\.(md|markdown)$/i.test(file.name) || file.mime === "text/markdown";
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">(isMarkdown ? "preview" : "edit");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = text !== null && text !== saved;

  useEffect(() => {
    let alive = true;
    setText(null);
    setStatus(null);
    setMode(isMarkdown ? "preview" : "edit");
    window.hermesAPI.fileContent(file.path).then((c) => {
      if (!alive) return;
      if (!c) { setStatus("Could not load the file from the server."); return; }
      const body = decodeText(c.data);
      setText(body);
      setSaved(body);
    }).catch(() => alive && setStatus("Could not load the file from the server."));
    return () => { alive = false; };
  }, [file.path, isMarkdown]);

  const save = useCallback(async () => {
    if (text === null || !dirty) return;
    setSaving(true);
    const r = await window.hermesAPI.saveFileContent(file.path, text);
    setSaving(false);
    if (r.ok) { setSaved(text); setStatus("Saved"); setTimeout(() => setStatus(null), 2000); }
    else setStatus(r.error || "Save failed");
  }, [dirty, file.path, text]);

  const close = (): void => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  return (
    <aside className="canvas-panel">
      <div className="canvas-head">
        <span className="canvas-title" title={file.path}>
          {file.name}{dirty ? " •" : ""}
        </span>
        {isMarkdown && (
          <div className="canvas-segment">
            <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>
              <Eye size={13} /> Preview
            </button>
            <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}>
              <Pencil size={13} /> Edit
            </button>
          </div>
        )}
        <button className="canvas-btn" onClick={save} disabled={!dirty || saving} title="Save (Ctrl+S)">
          <Save size={14} />
        </button>
        <button className="canvas-btn" onClick={() => window.hermesAPI.saveFile(file.path)} title="Download">
          <Download size={14} />
        </button>
        <button className="canvas-btn" onClick={close} title="Close">
          <X size={15} />
        </button>
      </div>
      {status && <div className="canvas-status">{status}</div>}
      <div className="canvas-body">
        {text === null ? (
          !status && <div className="canvas-status">Loading…</div>
        ) : mode === "preview" ? (
          <div className="canvas-preview"><AgentMarkdown>{text}</AgentMarkdown></div>
        ) : (
          <textarea
            className="canvas-editor"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
            }}
          />
        )}
      </div>
    </aside>
  );
});
