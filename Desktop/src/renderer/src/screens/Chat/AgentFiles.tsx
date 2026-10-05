import { memo, useEffect, useMemo, useState } from "react";
import { Download, Eye, FileText, Image as ImageIcon, PanelRight, X } from "lucide-react";
import { useOpenCanvas } from "./Canvas";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { extractFilePaths, formatSize, previewKind } from "./fileRefs";
import type { ToolStep } from "./types";

interface FileInfo {
  path: string;
  resolved: string;
  name: string;
  size: number;
  mime: string;
}

interface OpenPreview {
  file: FileInfo;
  dataUrl?: string;
  text?: string;
  error?: string;
}

function decodeText(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function ImageThumb({ file, onOpen }: { file: FileInfo; onOpen: (url: string) => void }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.hermesAPI.fileContent(file.resolved).then((c) => {
      if (alive && c) setUrl(`data:${c.mime};base64,${c.data}`);
    }).catch(() => {});
    return () => { alive = false; };
  }, [file.resolved]);
  if (!url) return <div className="agent-file-thumb agent-file-thumb-loading" />;
  return <img className="agent-file-thumb" src={url} alt={file.name} onClick={() => onOpen(url)} />;
}

/**
 * Theta: files a reply mentions or wrote, fetched from the server (workspace
 * and vault only) — previews for images/text/markdown, download for all.
 */
export const AgentFiles = memo(function AgentFiles({
  content,
  steps,
  live,
}: {
  content: string;
  steps?: ToolStep[];
  live: boolean;
}): React.JSX.Element | null {
  const paths = useMemo(() => extractFilePaths(content, steps), [content, steps]);
  const key = paths.join("|");
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [preview, setPreview] = useState<OpenPreview | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const openCanvas = useOpenCanvas();

  useEffect(() => {
    if (live || paths.length === 0) return;
    let alive = true;
    window.hermesAPI.filesInfo(paths).then((list) => {
      if (!alive) return;
      const seen = new Set<string>();
      setFiles(list.filter((f) => !seen.has(f.resolved) && seen.add(f.resolved)));
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live]);

  if (files.length === 0) return null;

  const open = async (file: FileInfo): Promise<void> => {
    const kind = previewKind(file.name, file.mime);
    setPreview({ file });
    const c = await window.hermesAPI.fileContent(file.resolved).catch(() => null);
    if (!c) { setPreview({ file, error: "Could not load the file from the server." }); return; }
    if (kind === "image") setPreview({ file, dataUrl: `data:${c.mime};base64,${c.data}` });
    else setPreview({ file, text: decodeText(c.data) });
  };

  const download = async (file: FileInfo): Promise<void> => {
    const r = await window.hermesAPI.saveFile(file.resolved);
    if (r.ok) setStatus(`Saved to ${r.savedTo}`);
    else if (!r.canceled) setStatus(r.error || "Download failed");
    if (r.ok || !r.canceled) setTimeout(() => setStatus(null), 4000);
  };

  return (
    <div className="agent-files">
      {files.map((f) => {
        const kind = previewKind(f.name, f.mime);
        return (
          <div key={f.resolved} className="agent-file">
            {kind === "image" ? (
              <ImageThumb file={f} onOpen={(url) => setPreview({ file: f, dataUrl: url })} />
            ) : null}
            <div className="agent-file-row">
              <span className="agent-file-icon">
                {kind === "image" ? <ImageIcon size={15} /> : <FileText size={15} />}
              </span>
              <span className="agent-file-name" title={f.resolved}>{f.name}</span>
              <span className="agent-file-size">{formatSize(f.size)}</span>
              {kind !== "none" && kind !== "image" && (
                <button className="agent-file-btn" onClick={() => open(f)} title="Preview">
                  <Eye size={14} />
                </button>
              )}
              {openCanvas && (kind === "markdown" || kind === "text") && (
                <button
                  className="agent-file-btn"
                  onClick={() => openCanvas({ path: f.resolved, name: f.name, mime: f.mime })}
                  title="Open in canvas (edit)"
                >
                  <PanelRight size={14} />
                </button>
              )}
              <button className="agent-file-btn" onClick={() => download(f)} title="Download">
                <Download size={14} />
              </button>
            </div>
          </div>
        );
      })}
      {status && <div className="agent-file-status">{status}</div>}

      {preview && (
        <div className="agent-file-modal-backdrop" onClick={() => setPreview(null)} role="dialog" aria-modal="true">
          <div className="agent-file-modal" onClick={(e) => e.stopPropagation()}>
            <div className="agent-file-modal-head">
              <span className="agent-file-name">{preview.file.name}</span>
              <button className="agent-file-btn" onClick={() => download(preview.file)} title="Download">
                <Download size={14} />
              </button>
              <button className="agent-file-btn" onClick={() => setPreview(null)} title="Close">
                <X size={15} />
              </button>
            </div>
            <div className="agent-file-modal-body">
              {preview.error ? (
                <div className="agent-file-status">{preview.error}</div>
              ) : preview.dataUrl ? (
                <img src={preview.dataUrl} alt={preview.file.name} className="agent-file-modal-image" />
              ) : preview.text !== undefined ? (
                previewKind(preview.file.name, preview.file.mime) === "markdown" ? (
                  <AgentMarkdown>{preview.text}</AgentMarkdown>
                ) : (
                  <pre className="agent-step-pre agent-file-modal-text">{preview.text}</pre>
                )
              ) : (
                <div className="agent-file-status">Loading…</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
