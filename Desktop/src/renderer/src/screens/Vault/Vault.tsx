import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  FolderOpen,
  Folder,
  Search,
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
  FileText,
  AlertTriangle,
  CheckCircle,
  X,
  Loader,
  ArrowLeft,
  FilePlus,
  FolderPlus,
  Bold,
  Italic,
  Code,
  Link,
  List,
  Minus,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VaultBucket {
  id: string;
  name: string;
  description: string;
  path: string;
  doc_count: number;
  stale_count: number;
  is_stale: boolean;
  note_path: string;
}

interface TreeNode {
  name: string;
  relPath: string;
  fullPath: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

interface OpenFile {
  fullPath: string;
  relPath: string;
  name: string;
}

interface SearchResult {
  bucket_id: string;
  bucket_name: string;
  rel_path: string;
  title: string | null;
  match: string;
  depth: string;
}

type TabId = "explorer" | "buckets";
type EditorMode = "edit" | "preview";

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode;
  bucketPath: string;
  bucketId: string;
}

interface CreatingState {
  parentFullPath: string;
  type: "file" | "folder";
}

interface BucketNodeState {
  tree: TreeNode[] | null;
  bucketPath: string;
  loading: boolean;
  error: string | null;
}


// ---------------------------------------------------------------------------
// SyncIndicator
// ---------------------------------------------------------------------------

function SyncIndicator({
  staleCount,
  syncing,
  onSync,
}: {
  staleCount: number;
  syncing: boolean;
  onSync: () => void;
}): React.JSX.Element {
  if (syncing) {
    return (
      <span className="vault-sync-badge" style={{ opacity: 0.6 }}>
        <Loader size={12} className="vault-spin" />
        Syncing…
      </span>
    );
  }
  if (staleCount === 0) {
    return (
      <span className="vault-sync-badge vault-sync-ok">
        <CheckCircle size={12} />
        In sync
      </span>
    );
  }
  return (
    <button className="vault-sync-btn vault-sync-stale" onClick={onSync}>
      <AlertTriangle size={12} />
      {staleCount} stale
    </button>
  );
}

// ---------------------------------------------------------------------------
// WikiLink picker modal
// ---------------------------------------------------------------------------

function WikiLinkPicker({
  allTrees,
  onPick,
  onClose,
}: {
  allTrees: TreeNode[];
  onPick: (name: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");

  const allFiles: TreeNode[] = [];
  function collectFiles(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (n.type === "file") allFiles.push(n);
      else if (n.children) collectFiles(n.children);
    }
  }
  collectFiles(allTrees);

  const filtered = query.trim()
    ? allFiles.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : allFiles;

  return (
    <div className="vault-modal-overlay" onClick={onClose}>
      <div className="vault-modal vault-wikilink-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vault-modal-header">
          <span>Link to file</span>
          <button onClick={onClose}><X size={14} /></button>
        </div>
        <input
          className="vault-input"
          autoFocus
          placeholder="Search files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="vault-wikilink-list">
          {filtered.length === 0 ? (
            <div className="vault-empty-small">No files found</div>
          ) : (
            filtered.map((f) => (
              <button
                key={f.relPath}
                className="vault-wikilink-item"
                onClick={() => onPick(f.name.replace(/\.md$/i, ""))}
              >
                <FileText size={13} />
                {f.name.replace(/\.md$/i, "")}
                <span className="vault-wikilink-path">{f.relPath}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function TreeContextMenu({
  menu,
  onNewFile,
  onNewFolder,
  onDelete,
  onClose,
}: {
  menu: ContextMenuState;
  onNewFile: (parentFullPath: string) => void;
  onNewFolder: (parentFullPath: string) => void;
  onDelete: (node: TreeNode) => void;
  onClose: () => void;
}): React.JSX.Element {
  const isDir = menu.node.type === "dir";
  const parentDir = isDir ? menu.node.fullPath : menu.node.fullPath.replace(/\/[^/]+$/, "");

  return (
    <div
      className="vault-ctx-menu"
      style={{ top: menu.y, left: menu.x }}
      onMouseLeave={onClose}
    >
      <button className="vault-ctx-item" onClick={() => { onNewFile(parentDir); onClose(); }}>
        <FilePlus size={13} /> New file here
      </button>
      <button className="vault-ctx-item" onClick={() => { onNewFolder(parentDir); onClose(); }}>
        <FolderPlus size={13} /> New folder here
      </button>
      <div className="vault-ctx-sep" />
      <button className="vault-ctx-item vault-ctx-danger" onClick={() => { onDelete(menu.node); onClose(); }}>
        <Trash2 size={13} /> Delete {isDir ? "folder" : "file"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree node (always expanded — no collapse)
// ---------------------------------------------------------------------------

function VaultTreeItem({
  node,
  depth,
  openPath,
  onOpen,
  onContextMenu,
  dragOverPath,
  setDragOverPath,
  onDrop,
  creating,
  creatingName,
  setCreatingName,
  onCreateConfirm,
  onCreateCancel,
}: {
  node: TreeNode;
  depth: number;
  openPath: string | null;
  onOpen: (node: TreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  dragOverPath: string | null;
  setDragOverPath: (p: string | null) => void;
  onDrop: (fromPath: string, toDir: string) => void;
  creating: CreatingState | null;
  creatingName: string;
  setCreatingName: (v: string) => void;
  onCreateConfirm: () => void;
  onCreateCancel: () => void;
}): React.JSX.Element {
  const isActive = openPath === node.fullPath;
  const isDragOver = dragOverPath === node.fullPath;

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.fullPath);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (node.type !== "dir") return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(node.fullPath);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (node.type !== "dir") return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
    const fromPath = e.dataTransfer.getData("text/plain");
    if (fromPath) onDrop(fromPath, node.fullPath);
  };

  const isCreatingHere = creating !== null && creating.parentFullPath === node.fullPath;

  const handleClick = () => {
    if (node.type === "file") onOpen(node);
  };

  return (
    <>
      <div
        className={[
          "vault-tree-item",
          `vault-tree-${node.type}`,
          isActive ? "vault-tree-item-active" : "",
          isDragOver ? "vault-tree-drag-over" : "",
        ].filter(Boolean).join(" ")}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOverPath(null)}
        onDrop={handleDrop}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        {node.type === "dir" ? (
          <Folder size={13} className="vault-tree-icon vault-tree-icon-dir" />
        ) : (
          <FileText size={13} className="vault-tree-icon" />
        )}
        <span className="vault-tree-name">
          {node.type === "file" ? node.name.replace(/\.md$/i, "") : node.name}
        </span>
      </div>

      {/* Dir children — always shown, no collapse */}
      {node.type === "dir" && (
        <div>
          {isCreatingHere && (
            <div className="vault-tree-create-row" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
              {creating!.type === "file" ? <FileText size={12} /> : <Folder size={12} />}
              <input
                className="vault-tree-create-input"
                autoFocus
                placeholder={creating!.type === "file" ? "note-name.md" : "folder-name"}
                value={creatingName}
                onChange={(e) => setCreatingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCreateConfirm();
                  if (e.key === "Escape") onCreateCancel();
                }}
                onBlur={onCreateCancel}
              />
            </div>
          )}
          {node.children?.map((child) => (
            <VaultTreeItem
              key={child.relPath}
              node={child}
              depth={depth + 1}
              openPath={openPath}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              dragOverPath={dragOverPath}
              setDragOverPath={setDragOverPath}
              onDrop={onDrop}
              creating={creating}
              creatingName={creatingName}
              setCreatingName={setCreatingName}
              onCreateConfirm={onCreateConfirm}
              onCreateCancel={onCreateCancel}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// File editor
// ---------------------------------------------------------------------------

function VaultEditor({
  file,
  content,
  dirty,
  mode,
  saving,
  allTrees,
  onModeChange,
  onContentChange,
  onSave,
  onClose,
}: {
  file: OpenFile;
  content: string;
  dirty: boolean;
  mode: EditorMode;
  saving: boolean;
  allTrees: TreeNode[];
  onModeChange: (m: EditorMode) => void;
  onContentChange: (c: string) => void;
  onSave: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showLinkPicker, setShowLinkPicker] = useState(false);

  const applyFormat = useCallback(
    (before: string, after = "") => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = content.slice(start, end);
      const newContent = content.slice(0, start) + before + selected + after + content.slice(end);
      onContentChange(newContent);
      requestAnimationFrame(() => {
        el.focus();
        const newStart = start + before.length;
        el.setSelectionRange(newStart, newStart + selected.length);
      });
    },
    [content, onContentChange],
  );

  const insertAtCursor = useCallback(
    (text: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = el.selectionStart;
      const newContent = content.slice(0, pos) + text + content.slice(pos);
      onContentChange(newContent);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(pos + text.length, pos + text.length);
      });
    },
    [content, onContentChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); onSave(); }
    if (e.key === "Tab") { e.preventDefault(); applyFormat("  "); }
  };

  const filename = file.name.replace(/\.md$/i, "");

  return (
    <div className="vault-editor">
      <div className="vault-editor-bar">
        <button className="vault-editor-back" onClick={onClose} title="Back to tree">
          <ArrowLeft size={14} />
        </button>
        <span className="vault-editor-filename">
          {filename}
          {dirty && <span className="vault-editor-dirty">•</span>}
        </span>
        <div className="vault-editor-mode-toggle">
          <button
            className={`vault-ed-tab${mode === "edit" ? " vault-ed-tab-active" : ""}`}
            onClick={() => onModeChange("edit")}
          >Edit</button>
          <button
            className={`vault-ed-tab${mode === "preview" ? " vault-ed-tab-active" : ""}`}
            onClick={() => onModeChange("preview")}
          >Preview</button>
        </div>
        <button
          className={`vault-editor-save${dirty ? " vault-editor-save-dirty" : ""}`}
          onClick={onSave}
          disabled={saving || !dirty}
          title="Save (Ctrl+S)"
        >
          {saving ? <Loader size={13} className="vault-spin" /> : null}
          {saving ? "Saving…" : dirty ? "Save •" : "Saved"}
        </button>
      </div>

      {mode === "edit" && (
        <div className="vault-toolbar">
          <button className="vault-tb-btn" title="Bold" onMouseDown={(e) => { e.preventDefault(); applyFormat("**", "**"); }}><Bold size={13} /></button>
          <button className="vault-tb-btn" title="Italic" onMouseDown={(e) => { e.preventDefault(); applyFormat("_", "_"); }}><Italic size={13} /></button>
          <div className="vault-tb-sep" />
          <button className="vault-tb-btn vault-tb-label" title="H1" onMouseDown={(e) => { e.preventDefault(); applyFormat("# "); }}>H1</button>
          <button className="vault-tb-btn vault-tb-label" title="H2" onMouseDown={(e) => { e.preventDefault(); applyFormat("## "); }}>H2</button>
          <button className="vault-tb-btn vault-tb-label" title="H3" onMouseDown={(e) => { e.preventDefault(); applyFormat("### "); }}>H3</button>
          <div className="vault-tb-sep" />
          <button className="vault-tb-btn" title="Inline code" onMouseDown={(e) => { e.preventDefault(); applyFormat("`", "`"); }}><Code size={13} /></button>
          <button className="vault-tb-btn vault-tb-label" title="Code block" onMouseDown={(e) => { e.preventDefault(); applyFormat("```\n", "\n```"); }}>{"{ }"}</button>
          <div className="vault-tb-sep" />
          <button className="vault-tb-btn" title="Bullet list" onMouseDown={(e) => { e.preventDefault(); applyFormat("- "); }}><List size={13} /></button>
          <button className="vault-tb-btn" title="HR" onMouseDown={(e) => { e.preventDefault(); insertAtCursor("\n---\n"); }}><Minus size={13} /></button>
          <div className="vault-tb-sep" />
          <button className="vault-tb-btn" title="Link" onMouseDown={(e) => { e.preventDefault(); applyFormat("[", "](url)"); }}><Link size={13} /></button>
          <button className="vault-tb-btn vault-tb-wikilink" title="Insert wikilink" onMouseDown={(e) => { e.preventDefault(); setShowLinkPicker(true); }}>[[…]]</button>
        </div>
      )}

      <div className="vault-editor-area">
        {mode === "edit" ? (
          <textarea
            ref={textareaRef}
            className="vault-raw-editor"
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
        ) : (
          <div className="vault-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>

      {showLinkPicker && (
        <WikiLinkPicker
          allTrees={allTrees}
          onPick={(name) => { insertAtCursor(`[[${name}]]`); setShowLinkPicker(false); }}
          onClose={() => setShowLinkPicker(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Explorer
// ---------------------------------------------------------------------------

function ExplorerTab({
  buckets,
  searchQuery,
  searchResults,
  searching,
  onBucketsChanged,
}: {
  buckets: VaultBucket[];
  searchQuery: string;
  searchResults: SearchResult[] | null;
  searching: boolean;
  onBucketsChanged: () => void;
}): React.JSX.Element {
  const [bucketTrees, setBucketTrees] = useState<Record<string, BucketNodeState>>({});
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [editContent, setEditContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [creatingName, setCreatingName] = useState("");
  const [deletingNode, setDeletingNode] = useState<TreeNode | null>(null);

  // Load all bucket trees on mount
  const loadBucketTree = useCallback(async (bucket: VaultBucket) => {
    setBucketTrees((prev) => ({
      ...prev,
      [bucket.id]: { tree: null, bucketPath: "", loading: true, error: null },
    }));
    const result = await window.hermesAPI.vault.tree(bucket.id);
    if (result.ok) {
      setBucketTrees((prev) => ({
        ...prev,
        [bucket.id]: { tree: result.tree, bucketPath: result.bucketPath, loading: false, error: null },
      }));
    } else {
      setBucketTrees((prev) => ({
        ...prev,
        [bucket.id]: { tree: [], bucketPath: "", loading: false, error: result.error ?? "Failed to load" },
      }));
    }
  }, []);

  useEffect(() => {
    buckets.forEach((b) => loadBucketTree(b));
  }, [buckets, loadBucketTree]);

  const getBucketForPath = useCallback(
    (fullPath: string): { bucket: VaultBucket; bucketPath: string } | null => {
      for (const bucket of buckets) {
        const state = bucketTrees[bucket.id];
        if (state?.bucketPath && fullPath.startsWith(state.bucketPath)) {
          return { bucket, bucketPath: state.bucketPath };
        }
      }
      return null;
    },
    [buckets, bucketTrees],
  );

  const openFileNode = useCallback(async (node: TreeNode) => {
    const result = await window.hermesAPI.vault.readFile(node.fullPath);
    if (result.ok) {
      setOpenFile({ fullPath: node.fullPath, relPath: node.relPath, name: node.name });
      setEditContent(result.content);
      setDirty(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!openFile || !dirty) return;
    setSaving(true);
    try {
      await window.hermesAPI.vault.writeFile(openFile.fullPath, editContent);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [openFile, dirty, editContent]);

  const handleDrop = useCallback(
    async (fromPath: string, toDir: string) => {
      await window.hermesAPI.vault.moveItem(fromPath, toDir);
      if (openFile && (openFile.fullPath === fromPath || openFile.fullPath.startsWith(fromPath + "/"))) {
        setOpenFile(null);
      }
      const hit = getBucketForPath(fromPath) ?? getBucketForPath(toDir);
      if (hit) loadBucketTree(hit.bucket);
      onBucketsChanged();
    },
    [openFile, getBucketForPath, loadBucketTree, onBucketsChanged],
  );

  const startCreating = useCallback(
    (parentFullPath: string, type: "file" | "folder") => {
      setCreating({ parentFullPath, type });
      setCreatingName("");
    },
    [],
  );

  const confirmCreate = useCallback(async () => {
    if (!creating || !creatingName.trim()) return;
    const { parentFullPath, type } = creating;
    const hit = getBucketForPath(parentFullPath);
    if (!hit) return;
    let name = creatingName.trim();

    if (type === "file") {
      if (!name.toLowerCase().endsWith(".md")) name += ".md";
      const fullPath = `${parentFullPath}/${name}`;
      const result = await window.hermesAPI.vault.createFile(fullPath);
      if (!result.ok) { setCreating(null); return; }
      setCreating(null);
      await loadBucketTree(hit.bucket);
      openFileNode({ name, relPath: fullPath.replace(hit.bucketPath + "/", ""), fullPath, type: "file" });
    } else {
      const fullPath = `${parentFullPath}/${name}`;
      const result = await window.hermesAPI.vault.createFolder(fullPath);
      setCreating(null);
      if (result.ok) await loadBucketTree(hit.bucket);
    }
    onBucketsChanged();
  }, [creating, creatingName, getBucketForPath, loadBucketTree, openFileNode, onBucketsChanged]);

  const cancelCreate = useCallback(() => { setCreating(null); setCreatingName(""); }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: TreeNode, bucketId: string, bucketPath: string) => {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, node, bucketPath, bucketId });
    },
    [],
  );

  const handleDelete = useCallback(
    async (node: TreeNode) => {
      if (deletingNode?.fullPath !== node.fullPath) { setDeletingNode(node); return; }
      setDeletingNode(null);
      await window.hermesAPI.vault.deleteItem(node.fullPath, node.type === "dir");
      if (openFile && (openFile.fullPath === node.fullPath || openFile.fullPath.startsWith(node.fullPath + "/"))) {
        setOpenFile(null);
      }
      const hit = getBucketForPath(node.fullPath);
      if (hit) { await loadBucketTree(hit.bucket); onBucketsChanged(); }
    },
    [deletingNode, openFile, getBucketForPath, loadBucketTree, onBucketsChanged],
  );

  const allBucketTrees = Object.values(bucketTrees).flatMap((s) => s.tree ?? []);

  return (
    <div className="vault-explorer">
      <div className="vault-explorer-panels vault-explorer-panels-2col">
        {/* IDE File tree */}
        <div className="vault-panel-tree vault-panel-tree-full">
          {/* Title overlay — floats over tree content */}
          <div className="vault-tree-title-overlay" aria-hidden>
            <span className="vault-tree-title-text">Vault</span>
            <span className="vault-tree-title-sub">Multi-bucket knowledge base</span>
          </div>

          {/* Scrollable tree body */}
          <div className="vault-tree-scroll-body">
          {buckets.length === 0 ? (
            <div className="vault-empty-small">No knowledge bases yet — create one in the Knowledge Bases tab</div>
          ) : searchResults !== null ? (
            <div className="vault-tree-body">
              <div className="vault-panel-label" style={{ padding: "6px 8px" }}>
                Results ({searchResults.length}){searching && <Loader size={11} className="vault-spin" style={{ marginLeft: 6 }} />}
              </div>
              {searchResults.length === 0 ? (
                <div className="vault-empty-small">No results</div>
              ) : (
                searchResults.map((r, i) => {
                  const bkt = buckets.find((b) => b.id === r.bucket_id);
                  const bState = bkt && bucketTrees[bkt.id];
                  return (
                    <button
                      key={i}
                      className="vault-file-item"
                      onClick={() => {
                        if (bkt && bState?.bucketPath) {
                          openFileNode({
                            name: r.rel_path.split("/").pop() || r.rel_path,
                            relPath: r.rel_path,
                            fullPath: `${bState.bucketPath}/${r.rel_path}`,
                            type: "file",
                          });
                        }
                      }}
                    >
                      <FileText size={13} />
                      <div className="vault-file-item-info">
                        <span className="vault-file-item-title">{r.title || r.rel_path}</span>
                        <span className="vault-file-item-meta">{r.bucket_name} · {r.match.slice(0, 60)}…</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            buckets.map((bucket) => {
              const bState = bucketTrees[bucket.id];
              const bucketPath = bState?.bucketPath ?? "";
              const rootCreating = creating && creating.parentFullPath === bucketPath && bucketPath !== "";

              return (
                <div key={bucket.id} className="vault-bucket-root-section">
                  {/* Bucket header */}
                  <div
                    className="vault-bucket-root-row"
                    onDragOver={(e) => { if (bucketPath) e.preventDefault(); }}
                    onDrop={(e) => {
                      if (!bucketPath) return;
                      e.preventDefault();
                      const from = e.dataTransfer.getData("text/plain");
                      if (from) handleDrop(from, bucketPath);
                    }}
                  >
                    <BookOpen size={13} className="vault-bucket-root-icon" />
                    <span className="vault-bucket-root-name">{bucket.name}</span>
                    {bucket.is_stale && <AlertTriangle size={11} className="vault-stale-icon" />}
                    <span className="vault-bucket-root-count">{bucket.doc_count}</span>
                    <button
                      className="vault-tree-action-btn"
                      title="New file"
                      onClick={() => startCreating(bucketPath, "file")}
                    ><FilePlus size={12} /></button>
                    <button
                      className="vault-tree-action-btn"
                      title="New folder"
                      onClick={() => startCreating(bucketPath, "folder")}
                    ><FolderPlus size={12} /></button>
                  </div>

                  {/* Bucket contents — always visible */}
                  <div className="vault-bucket-root-children">
                    {bState?.loading ? (
                      <div className="vault-loading-small"><Loader size={14} className="vault-spin" /></div>
                    ) : bState?.error ? (
                      <div className="vault-empty-small" style={{ color: "var(--error)" }}>{bState.error}</div>
                    ) : (
                      <div className="vault-tree-body">
                        {rootCreating && (
                          <div className="vault-tree-create-row" style={{ paddingLeft: 8 }}>
                            {creating!.type === "file" ? <FileText size={12} /> : <Folder size={12} />}
                            <input
                              className="vault-tree-create-input"
                              autoFocus
                              placeholder={creating!.type === "file" ? "note-name.md" : "folder-name"}
                              value={creatingName}
                              onChange={(e) => setCreatingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") confirmCreate();
                                if (e.key === "Escape") cancelCreate();
                              }}
                              onBlur={cancelCreate}
                            />
                          </div>
                        )}
                        {(!bState?.tree || bState.tree.length === 0) && !rootCreating ? (
                          <div className="vault-empty-small">Empty — add a file to get started</div>
                        ) : (
                          bState?.tree?.map((node) => (
                            <VaultTreeItem
                              key={node.relPath}
                              node={node}
                              depth={0}
                              openPath={openFile?.fullPath ?? null}
                              onOpen={openFileNode}
                              onContextMenu={(e, n) => handleContextMenu(e, n, bucket.id, bucketPath)}
                              dragOverPath={dragOverPath}
                              setDragOverPath={setDragOverPath}
                              onDrop={handleDrop}
                              creating={creating}
                              creatingName={creatingName}
                              setCreatingName={setCreatingName}
                              onCreateConfirm={confirmCreate}
                              onCreateCancel={cancelCreate}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          </div>{/* end vault-tree-scroll-body */}
        </div>

        {/* Editor panel */}
        <div className="vault-panel-editor">
          {openFile ? (
            <VaultEditor
              file={openFile}
              content={editContent}
              dirty={dirty}
              mode={editorMode}
              saving={saving}
              allTrees={allBucketTrees}
              onModeChange={setEditorMode}
              onContentChange={(c) => { setEditContent(c); setDirty(true); }}
              onSave={handleSave}
              onClose={() => setOpenFile(null)}
            />
          ) : (
            <div className="vault-note-placeholder">
              <FileText size={32} style={{ opacity: 0.2 }} />
              <span>Select a file to open it</span>
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <>
          <div className="vault-ctx-overlay" onClick={() => setCtxMenu(null)} />
          <TreeContextMenu
            menu={ctxMenu}
            onNewFile={(p) => startCreating(p, "file")}
            onNewFolder={(p) => startCreating(p, "folder")}
            onDelete={(node) => { setCtxMenu(null); handleDelete(node); }}
            onClose={() => setCtxMenu(null)}
          />
        </>
      )}

      {/* Delete confirmation */}
      {deletingNode && (
        <div className="vault-modal-overlay" onClick={() => setDeletingNode(null)}>
          <div className="vault-modal vault-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vault-modal-header">
              <AlertTriangle size={16} style={{ color: "var(--error)" }} />
              <span>Confirm Delete</span>
            </div>
            <p className="vault-confirm-msg">
              Delete{" "}
              <strong>
                {deletingNode.type === "dir" ? "folder" : "file"} "{deletingNode.name.replace(/\.md$/i, "")}"
              </strong>
              {deletingNode.type === "dir" ? " and all its contents" : ""}? This cannot be undone.
            </p>
            <div className="vault-confirm-btns">
              <button className="btn btn-secondary vault-btn-sm" onClick={() => setDeletingNode(null)}>Cancel</button>
              <button className="btn vault-btn-sm vault-btn-danger" onClick={() => handleDelete(deletingNode)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Bucket Manager
// ---------------------------------------------------------------------------

function BucketManagerTab({
  buckets,
  syncing,
  onSync,
  onForceReindex,
  onBucketsChanged,
}: {
  buckets: VaultBucket[];
  syncing: boolean;
  onSync: () => void;
  onForceReindex: () => void;
  onBucketsChanged: () => void;
}): React.JSX.Element {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPath, setNewPath] = useState("");
  const [pathManual, setPathManual] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toSlug(s: string): string {
    return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_/]/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  }

  const handleNameChange = (val: string) => {
    setNewName(val);
    if (!pathManual) setNewPath(toSlug(val));
  };

  const handlePathChange = (val: string) => {
    setNewPath(val);
    setPathManual(val.trim() !== "");
  };

  const resetCreate = () => {
    setNewName(""); setNewDesc(""); setNewPath(""); setPathManual(false); setShowCreate(false);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true); setError(null);
    try {
      const result = await window.hermesAPI.vault.createBucket(newName.trim(), newDesc.trim(), newPath.trim() || undefined);
      if (result.ok) { resetCreate(); onBucketsChanged(); }
      else setError(result.error || "Failed to create bucket");
    } catch (err) { setError(String(err)); }
    finally { setCreating(false); }
  };

  const startEdit = (b: VaultBucket) => {
    setEditingId(b.id); setEditName(b.name); setEditDesc(b.description);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setError(null);
    try {
      const result = await window.hermesAPI.vault.updateBucket(editingId, editName.trim(), editDesc.trim());
      if (result.ok) { setEditingId(null); onBucketsChanged(); }
      else setError(result.error || "Failed to update bucket");
    } catch (err) { setError(String(err)); }
  };

  const handleDelete = async (id: string) => {
    if (deletingId !== id) { setDeletingId(id); return; }
    setError(null);
    try {
      const result = await window.hermesAPI.vault.deleteBucket(id);
      if (result.ok) { setDeletingId(null); onBucketsChanged(); }
      else setError(result.error || "Failed to delete bucket");
    } catch (err) { setError(String(err)); }
  };

  return (
    <div className="vault-bucket-manager">
      {error && (
        <div className="vault-error-banner">
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}
      <div className="vault-manager-actions">
        <button className="btn btn-primary vault-btn-sm" onClick={() => setShowCreate(true)}><Plus size={14} /> New Knowledge Base</button>
        <button className="btn btn-secondary vault-btn-sm" onClick={onSync} disabled={syncing}><RefreshCw size={14} className={syncing ? "vault-spin" : ""} /> Sync Changed</button>
        <button className="btn btn-secondary vault-btn-sm" onClick={onForceReindex} disabled={syncing}><RefreshCw size={14} /> Full Reindex</button>
      </div>

      {showCreate && (
        <div className="vault-create-form">
          <div className="vault-create-form-header">
            <span>New Knowledge Base</span>
            <button onClick={resetCreate}><X size={14} /></button>
          </div>
          <input className="vault-input" placeholder="Name (e.g. Research Notes)" value={newName} onChange={(e) => handleNameChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} autoFocus />
          <input className="vault-input" placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
          <div className="vault-path-field">
            <label className="vault-path-label">Folder path</label>
            <div className="vault-path-input-row">
              <span className="vault-path-prefix">vault/</span>
              <input className="vault-input vault-path-input" placeholder={toSlug(newName) || "folder-name"} value={newPath} onChange={(e) => handlePathChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
            </div>
            <span className="vault-path-hint">Use <code>/</code> to nest (e.g. <code>research/ai</code>)</span>
          </div>
          <div className="vault-create-form-btns">
            <button className="btn btn-primary vault-btn-sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? <Loader size={13} className="vault-spin" /> : <Plus size={13} />} Create
            </button>
            <button className="btn btn-secondary vault-btn-sm" onClick={resetCreate}>Cancel</button>
          </div>
        </div>
      )}

      {buckets.length === 0 ? (
        <div className="schedules-empty">
          <p className="schedules-empty-text">No knowledge bases yet</p>
          <p className="schedules-empty-hint">Create your first bucket to start building your knowledge vault.</p>
        </div>
      ) : (
        <div className="vault-cards-grid">
          {buckets.map((b) => (
            <div key={b.id} className={`vault-bucket-card${b.is_stale ? " vault-bucket-card-stale" : ""}`}>
              {editingId === b.id ? (
                <div className="vault-card-edit">
                  <input className="vault-input" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()} autoFocus />
                  <input className="vault-input" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()} placeholder="Description" />
                  <div className="vault-card-edit-btns">
                    <button className="btn btn-primary vault-btn-sm" onClick={handleSaveEdit}>Save</button>
                    <button className="btn btn-secondary vault-btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="vault-card-header">
                    <BookOpen size={18} className="vault-card-icon" />
                    <div className="vault-card-info">
                      <span className="vault-card-name">{b.name}</span>
                      {b.description && <span className="vault-card-desc">{b.description}</span>}
                    </div>
                  </div>
                  <div className="vault-card-stats">
                    <span className="vault-card-stat">{b.doc_count} notes</span>
                    {b.is_stale ? (
                      <span className="vault-card-stale"><AlertTriangle size={12} /> {b.stale_count} stale</span>
                    ) : (
                      <span className="vault-card-fresh"><CheckCircle size={12} /> Up to date</span>
                    )}
                  </div>
                  <div className="vault-card-path">{b.id}/</div>
                  <div className="vault-card-actions">
                    <button className="vault-card-btn" onClick={() => startEdit(b)} title="Edit"><Edit2 size={13} /></button>
                    <button
                      className={`vault-card-btn${deletingId === b.id ? " vault-card-btn-danger" : ""}`}
                      onClick={() => handleDelete(b.id)}
                      title={deletingId === b.id ? "Click again to confirm" : "Delete"}
                    >
                      <Trash2 size={13} />
                      {deletingId === b.id && <span style={{ fontSize: 11 }}>Confirm</span>}
                    </button>
                    {deletingId === b.id && (
                      <button className="vault-card-btn" onClick={() => setDeletingId(null)} title="Cancel"><X size={13} /></button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Vault component
// ---------------------------------------------------------------------------

interface VaultProps {
  profile?: string;
}

function Vault({ profile: _profile }: VaultProps): React.JSX.Element {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>("explorer");
  const [buckets, setBuckets] = useState<VaultBucket[]>([]);
  const [totalStale, setTotalStale] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Search lives at top level so the bar stays above the tabs
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadBuckets = useCallback(async () => {
    try {
      const list = await window.hermesAPI.vault.listBuckets();
      setBuckets(list);
      setTotalStale(list.reduce((s, b) => s + b.stale_count, 0));
    } catch { setBuckets([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadBuckets(); }, [loadBuckets]);

  const handleSync = useCallback(async (force = false) => {
    setSyncing(true); setSyncMessage(null);
    try {
      const result = await window.hermesAPI.vault.reindex(undefined, force);
      setSyncMessage(`Indexed ${result.total_indexed} · Removed ${result.total_deleted}`);
      await loadBuckets();
      setTimeout(() => setSyncMessage(null), 4000);
    } catch { setSyncMessage("Sync failed"); }
    finally { setSyncing(false); }
  }, [loadBuckets]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const results = await window.hermesAPI.vault.search(q, undefined, 20, 4000, "snippet");
      setSearchResults(results);
      if (activeTab !== "explorer") setActiveTab("explorer");
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, [activeTab]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!q.trim()) { setSearchResults(null); return; }
    searchTimerRef.current = setTimeout(() => doSearch(q), 350);
  };

  if (loading) {
    return (
      <div className="vault-container">
        <div className="schedules-loading"><div className="loading-spinner" /></div>
      </div>
    );
  }

  return (
    <div className="vault-container">
      {/* Top search bar — always visible, sync indicator overlaid on right */}
      <div className="vault-topbar">
        <div className="vault-topbar-search">
          <Search size={14} className="vault-search-icon" />
          <input
            className="vault-search-input"
            placeholder={`Search ${t("navigation.vault").toLowerCase()}…`}
            value={searchQuery}
            onChange={handleSearchChange}
          />
          {searchQuery && (
            <button className="vault-search-clear" onClick={() => { setSearchQuery(""); setSearchResults(null); }}>
              <X size={12} />
            </button>
          )}
          {searching && <Loader size={12} className="vault-spin vault-search-spinner" />}
        </div>
        <div className="vault-topbar-right">
          {syncMessage && <span className="vault-sync-msg">{syncMessage}</span>}
          <SyncIndicator staleCount={totalStale} syncing={syncing} onSync={() => handleSync(false)} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="vault-tabs">
        <button
          className={`vault-tab${activeTab === "explorer" ? " vault-tab-active" : ""}`}
          onClick={() => setActiveTab("explorer")}
        >
          <FolderOpen size={14} /> Explorer
        </button>
        <button
          className={`vault-tab${activeTab === "buckets" ? " vault-tab-active" : ""}`}
          onClick={() => setActiveTab("buckets")}
        >
          <BookOpen size={14} /> Knowledge Bases
          {totalStale > 0 && <span className="vault-tab-badge">{totalStale}</span>}
        </button>
      </div>

      <div className="vault-tab-content">
        {activeTab === "explorer" ? (
          <ExplorerTab
            buckets={buckets}
            searchQuery={searchQuery}
            searchResults={searchResults}
            searching={searching}
            onBucketsChanged={loadBuckets}
          />
        ) : (
          <BucketManagerTab
            buckets={buckets}
            syncing={syncing}
            onSync={() => handleSync(false)}
            onForceReindex={() => handleSync(true)}
            onBucketsChanged={loadBuckets}
          />
        )}
      </div>
    </div>
  );
}

export default Vault;
