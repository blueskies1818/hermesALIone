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
  Maximize2,
  Crosshair,
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
  onFocus,
  onClose,
}: {
  menu: ContextMenuState;
  onNewFile: (parentFullPath: string) => void;
  onNewFolder: (parentFullPath: string) => void;
  onDelete: (node: TreeNode) => void;
  onFocus: (node: TreeNode) => void;
  onClose: () => void;
}): React.JSX.Element {
  const isDir = menu.node.type === "dir";
  const isRoot = isDir && menu.node.relPath === "";
  const parentDir = isDir ? menu.node.fullPath : menu.node.fullPath.replace(/[\\/][^\\/]+$/, "");

  return (
    <div
      className="vault-ctx-menu"
      style={{ top: menu.y, left: menu.x }}
      onMouseLeave={onClose}
    >
      {isDir && (
        <>
          <button className="vault-ctx-item" onClick={() => { onFocus(menu.node); onClose(); }}>
            <Crosshair size={13} /> Focus in graph
          </button>
          <div className="vault-ctx-sep" />
        </>
      )}
      <button className="vault-ctx-item" onClick={() => { onNewFile(parentDir); onClose(); }}>
        <FilePlus size={13} /> New file here
      </button>
      <button className="vault-ctx-item" onClick={() => { onNewFolder(parentDir); onClose(); }}>
        <FolderPlus size={13} /> New folder here
      </button>
      {!isRoot && (
        <>
          <div className="vault-ctx-sep" />
          <button className="vault-ctx-item vault-ctx-danger" onClick={() => { onDelete(menu.node); onClose(); }}>
            <Trash2 size={13} /> Delete {isDir ? "folder" : "file"}
          </button>
        </>
      )}
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
// Force-directed node graph
// ---------------------------------------------------------------------------

// Mid-tone palette: readable on both the light and the dark theme.
const BUCKET_COLORS = [
  "#14b8a6", "#6366f1", "#f97316", "#e11d48",
  "#0ea5e9", "#a855f7", "#22c55e", "#d97706",
];

/** Normalise Windows/posix separators so paths from different APIs compare equal. */
function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** True when `path` is `root` itself or lies inside it. */
function isWithin(path: string, root: string): boolean {
  const a = normPath(path).toLowerCase();
  const b = normPath(root).toLowerCase();
  return a === b || a.startsWith(b + "/");
}

type GKind = "bucket" | "dir" | "file";

interface GNode {
  id: string; label: string; bucketId: string; kind: GKind;
  fullPath: string; relPath: string;
  x: number; y: number; vx: number; vy: number; pinned: boolean;
}
interface GEdge { source: string; target: string; kind: "tree" | "link"; }

interface GraphFocus { fullPath: string; label: string; bucketId: string; }

interface ThemeColors {
  text: string; muted: string; border: string; bg: string; grid: string; dark: boolean;
}

function readThemeColors(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.getAttribute("data-theme") !== "light";
  return {
    text: v("--text-primary", dark ? "#ececec" : "#111111"),
    muted: v("--text-secondary", dark ? "#b4b4b4" : "#555555"),
    border: v("--border-bright", dark ? "rgba(255,255,255,0.1)" : "#d4d4d4"),
    bg: v("--bg-secondary", dark ? "#171717" : "#f8f8f8"),
    grid: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)",
    dark,
  };
}

/** Build hub nodes (project, folders), file nodes and the tree edges joining them. */
function buildGraph(
  buckets: VaultBucket[],
  bucketTrees: Record<string, BucketNodeState>,
  focus: GraphFocus | null,
): { nodes: Omit<GNode, "x"|"y"|"vx"|"vy"|"pinned">[]; edges: GEdge[] } {
  const nodes: Omit<GNode, "x"|"y"|"vx"|"vy"|"pinned">[] = [];
  const edges: GEdge[] = [];
  const keep = (fullPath: string): boolean => !focus || isWithin(fullPath, focus.fullPath);

  const walk = (items: TreeNode[], bucketId: string, parentId: string): void => {
    for (const n of items) {
      if (n.type === "dir") {
        if (keep(n.fullPath) || (focus && isWithin(focus.fullPath, n.fullPath))) {
          const visible = keep(n.fullPath);
          if (visible) {
            nodes.push({ id: n.fullPath, label: n.name, bucketId, kind: "dir", fullPath: n.fullPath, relPath: n.relPath });
            if (parentId) edges.push({ source: n.fullPath, target: parentId, kind: "tree" });
          }
          walk(n.children ?? [], bucketId, visible ? n.fullPath : "");
        }
      } else if (keep(n.fullPath)) {
        nodes.push({ id: n.fullPath, label: n.name.replace(/\.md$/i, ""), bucketId, kind: "file", fullPath: n.fullPath, relPath: n.relPath });
        if (parentId) edges.push({ source: n.fullPath, target: parentId, kind: "tree" });
      }
    }
  };

  for (const b of buckets) {
    const state = bucketTrees[b.id];
    if (!state?.tree || !state.bucketPath) continue;
    if (focus && focus.bucketId !== b.id) continue;
    const showHub = keep(state.bucketPath);
    if (showHub) {
      nodes.push({ id: state.bucketPath, label: b.name, bucketId: b.id, kind: "bucket", fullPath: state.bucketPath, relPath: "" });
    }
    walk(state.tree, b.id, showHub ? state.bucketPath : "");
  }
  return { nodes, edges };
}

function nodeRadius(kind: GKind): number {
  return kind === "bucket" ? 13 : kind === "dir" ? 8.5 : 5.5;
}

function VaultGraph({ buckets, bucketTrees, focus, onFocus, onOpenFile }: {
  buckets: VaultBucket[];
  bucketTrees: Record<string, BucketNodeState>;
  focus: GraphFocus | null;
  onFocus: (focus: GraphFocus | null) => void;
  onOpenFile: (node: TreeNode) => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodeCount, setNodeCount] = useState(0);
  const simRef = useRef<{
    nodes: GNode[]; edges: GEdge[]; links: GEdge[];
    pan: {x:number;y:number}; zoom: number;
    target: {x:number;y:number;zoom:number} | null; fitFrames: number;
    hoverId: string|null; dragId: string|null; dragOffset: {x:number;y:number};
    isPanning: boolean; panStart: {x:number;y:number};
    didDrag: boolean; alpha: number;
    raf: number; w: number; h: number; theme: ThemeColors | null; themeAge: number;
  }>({ nodes:[], edges:[], links:[], pan:{x:0,y:0}, zoom:1, target:null, fitFrames:0,
       hoverId:null, dragId:null, dragOffset:{x:0,y:0}, isPanning:false, panStart:{x:0,y:0},
       didDrag:false, alpha:1, raf:0, w:800, h:600, theme:null, themeAge:0 });

  const colorMap = useRef(new Map<string, string>());
  useEffect(() => {
    colorMap.current = new Map(buckets.map((b, i) => [b.id, BUCKET_COLORS[i % BUCKET_COLORS.length]]));
  }, [buckets]);

  // Rebuild nodes/edges whenever the trees or the focus change.
  useEffect(() => {
    const sim = simRef.current;
    const existing = new Map(sim.nodes.map(n => [n.id, n]));
    const { nodes, edges } = buildGraph(buckets, bucketTrees, focus);
    const byId = new Map<string, GNode>();
    const fresh: GNode[] = [];
    for (const p of nodes) {
      const prev = existing.get(p.id);
      // New nodes start near their parent so the layout grows outward.
      const parentEdge = edges.find(e => e.source === p.id);
      const parent = parentEdge ? (byId.get(parentEdge.target) ?? existing.get(parentEdge.target)) : undefined;
      const node: GNode = prev
        ? { ...prev, ...p }
        : { ...p, x: (parent?.x ?? 0) + (Math.random() - 0.5) * 60, y: (parent?.y ?? 0) + (Math.random() - 0.5) * 60,
            vx: 0, vy: 0, pinned: false };
      fresh.push(node); byId.set(node.id, node);
    }
    sim.nodes = fresh;
    sim.edges = edges;
    sim.alpha = 1;
    sim.fitFrames = 90; // glide the camera to fit the new set
    setNodeCount(fresh.filter(n => n.kind === "file").length);
  }, [buckets, bucketTrees, focus]);

  // Wikilinks between notes (resolved by the backend per bucket).
  useEffect(() => {
    const sim = simRef.current;
    let cancelled = false;
    Promise.all(buckets.map(async b => {
      try {
        const r = await window.hermesAPI.vault.getLinks(b.id);
        if (!r.ok) return [] as GEdge[];
        const base = bucketTrees[b.id]?.bucketPath;
        if (!base) return [] as GEdge[];
        const edges: GEdge[] = [];
        for (const l of r.links) {
          if (!l.toPath) continue;
          const source = `${normPath(base)}/${normPath(l.fromPath)}`.toLowerCase();
          const target = `${normPath(base)}/${normPath(l.toPath)}`.toLowerCase();
          if (source !== target) edges.push({ source, target, kind: "link" });
        }
        return edges;
      } catch { return [] as GEdge[]; }
    })).then(all => { if (!cancelled) { sim.links = all.flat(); sim.alpha = Math.max(sim.alpha, 0.5); } });
    return () => { cancelled = true; };
  }, [buckets, bucketTrees]);

  // Simulation + rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sim = simRef.current;

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth; const h = canvas.offsetHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      sim.w = w; sim.h = h;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const keyOf = (n: GNode): string => normPath(n.fullPath).toLowerCase();

    function resolvedLinks(): [GNode, GNode][] {
      const byKey = new Map(sim.nodes.map(n => [keyOf(n), n]));
      const out: [GNode, GNode][] = [];
      for (const e of sim.links) {
        const s = byKey.get(e.source), t = byKey.get(e.target);
        if (s && t) out.push([s, t]);
      }
      return out;
    }

    function tick(links: [GNode, GNode][]): void {
      const { nodes, edges } = sim;
      if (nodes.length === 0 || sim.alpha < 0.002) return;
      const a = sim.alpha;
      const fx = new Float32Array(nodes.length);
      const fy = new Float32Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
          const d2 = dx * dx + dy * dy + 1; const d = Math.sqrt(d2);
          const rep = (nodes[i].kind === "file" ? 1 : 2.2) * (nodes[j].kind === "file" ? 1 : 2.2);
          const f = 2200 * rep / d2; const ux = dx / d, uy = dy / d;
          fx[i] -= f * ux; fy[i] -= f * uy; fx[j] += f * ux; fy[j] += f * uy;
        }
      }
      const idx = new Map(nodes.map((n, i) => [n.id, i]));
      const spring = (si: number, ti: number, rest: number, k: number): void => {
        const dx = nodes[ti].x - nodes[si].x, dy = nodes[ti].y - nodes[si].y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = k * (d - rest); const ux = dx / d, uy = dy / d;
        fx[si] += f * ux; fy[si] += f * uy; fx[ti] -= f * ux; fy[ti] -= f * uy;
      };
      for (const e of edges) {
        const si = idx.get(e.source), ti = idx.get(e.target);
        if (si == null || ti == null) continue;
        spring(si, ti, nodes[ti].kind === "bucket" ? 90 : 60, 0.06);
      }
      for (const [s, t] of links) {
        const si = idx.get(s.id), ti = idx.get(t.id);
        if (si != null && ti != null) spring(si, ti, 120, 0.02);
      }
      for (let i = 0; i < nodes.length; i++) {
        fx[i] -= 0.012 * nodes[i].x; fy[i] -= 0.012 * nodes[i].y;
      }
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.pinned) continue;
        n.vx = (n.vx + fx[i] * a) * 0.78; n.vy = (n.vy + fy[i] * a) * 0.78;
        n.x += n.vx; n.y += n.vy;
      }
      sim.alpha *= 0.994;
    }

    function updateCamera(): void {
      const { nodes } = sim;
      if (sim.fitFrames > 0 && nodes.length > 0) {
        sim.fitFrames -= 1;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodes) {
          minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
          minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
        }
        const pad = 90;
        const zoom = Math.max(0.2, Math.min(2.2,
          Math.min(sim.w / (maxX - minX + pad * 2), sim.h / (maxY - minY + pad * 2))));
        sim.target = { x: -((minX + maxX) / 2) * zoom, y: -((minY + maxY) / 2) * zoom, zoom };
      }
      if (sim.target) {
        const t = sim.target;
        sim.zoom += (t.zoom - sim.zoom) * 0.12;
        sim.pan.x += (t.x - sim.pan.x) * 0.12;
        sim.pan.y += (t.y - sim.pan.y) * 0.12;
        if (sim.fitFrames === 0 && Math.abs(t.zoom - sim.zoom) < 0.001 && Math.abs(t.x - sim.pan.x) < 0.5) sim.target = null;
      }
    }

    function draw(ctx: CanvasRenderingContext2D, links: [GNode, GNode][]): void {
      if (!sim.theme || sim.themeAge++ > 30) { sim.theme = readThemeColors(); sim.themeAge = 0; }
      const theme = sim.theme;
      const { nodes, edges, pan, zoom, hoverId, w, h } = sim;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w * dpr, h * dpr);
      ctx.scale(dpr, dpr);

      // Dot grid (screen space, follows pan/zoom)
      const step = 26 * zoom;
      if (step > 8) {
        ctx.fillStyle = theme.grid;
        const ox = ((w / 2 + pan.x) % step + step) % step;
        const oy = ((h / 2 + pan.y) % step + step) % step;
        for (let x = ox; x < w; x += step) {
          for (let y = oy; y < h; y += step) { ctx.fillRect(x, y, 1.2, 1.2); }
        }
      }

      ctx.translate(w / 2 + pan.x, h / 2 + pan.y);
      ctx.scale(zoom, zoom);

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const neighbours = new Set<string>();
      if (hoverId) {
        neighbours.add(hoverId);
        for (const e of edges) {
          if (e.source === hoverId) neighbours.add(e.target);
          if (e.target === hoverId) neighbours.add(e.source);
        }
        for (const [s, t] of links) {
          if (s.id === hoverId) neighbours.add(t.id);
          if (t.id === hoverId) neighbours.add(s.id);
        }
      }
      const dimmed = (id: string): boolean => hoverId !== null && !neighbours.has(id);
      const colorOf = (n: GNode): string => colorMap.current.get(n.bucketId) ?? BUCKET_COLORS[0];

      // Structure edges: note → folder → project, in the project colour
      ctx.lineCap = "round";
      for (const e of edges) {
        const s = nodeMap.get(e.source), t = nodeMap.get(e.target);
        if (!s || !t) continue;
        const lit = hoverId !== null && (s.id === hoverId || t.id === hoverId);
        ctx.globalAlpha = dimmed(s.id) && dimmed(t.id) ? 0.12 : lit ? 0.9 : 0.42;
        ctx.strokeStyle = colorOf(t);
        ctx.lineWidth = (lit ? 2 : 1.25) / zoom;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      }
      // Wikilinks between notes: dashed, theme coloured
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      for (const [s, t] of links) {
        const lit = hoverId !== null && (s.id === hoverId || t.id === hoverId);
        ctx.globalAlpha = dimmed(s.id) && dimmed(t.id) ? 0.12 : lit ? 0.95 : 0.55;
        ctx.strokeStyle = theme.muted;
        ctx.lineWidth = (lit ? 1.8 : 1.1) / zoom;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      }
      ctx.setLineDash([]);

      // Nodes: hubs first so notes sit on top
      const order = [...nodes].sort((a, b) => (a.kind === "file" ? 1 : 0) - (b.kind === "file" ? 1 : 0));
      for (const n of order) {
        const hov = n.id === hoverId;
        const col = colorOf(n);
        const r = (nodeRadius(n.kind) + (hov ? 2 : 0)) / Math.sqrt(zoom);
        ctx.globalAlpha = dimmed(n.id) ? 0.25 : 1;
        if (hov) {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3);
          g.addColorStop(0, col + "55"); g.addColorStop(1, col + "00");
          ctx.beginPath(); ctx.arc(n.x, n.y, r * 3, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        if (n.kind === "file") {
          ctx.fillStyle = col; ctx.fill();
          ctx.strokeStyle = theme.bg; ctx.lineWidth = 1.5 / zoom; ctx.stroke();
        } else {
          ctx.fillStyle = theme.bg; ctx.fill();
          ctx.strokeStyle = col; ctx.lineWidth = (n.kind === "bucket" ? 3 : 2) / zoom; ctx.stroke();
          ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.42, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        }
      }

      // Labels with a halo in the background colour for legibility
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      for (const n of order) {
        const hov = n.id === hoverId;
        const isHub = n.kind !== "file";
        if (!hov && !isHub && zoom < 0.7 && !neighbours.has(n.id)) continue;
        if (dimmed(n.id) && !isHub) continue;
        const size = (n.kind === "bucket" ? 13 : n.kind === "dir" ? 11.5 : 11) / zoom;
        const weight = n.kind === "bucket" ? 600 : hov || n.kind === "dir" ? 500 : 400;
        ctx.font = `${weight} ${size}px "Google Sans", system-ui, sans-serif`;
        const label = n.label.length > 42 && !hov ? n.label.slice(0, 40) + "…" : n.label;
        const y = n.y + (nodeRadius(n.kind) / Math.sqrt(zoom) + 5 / zoom);
        ctx.globalAlpha = dimmed(n.id) ? 0.35 : 1;
        ctx.strokeStyle = theme.bg; ctx.lineWidth = 4 / zoom;
        ctx.strokeText(label, n.x, y);
        ctx.fillStyle = hov || isHub ? theme.text : theme.muted;
        ctx.fillText(label, n.x, y);
      }
      ctx.globalAlpha = 1;
    }

    function loop(): void {
      const ctx = canvas!.getContext("2d");
      if (ctx) {
        const links = resolvedLinks();
        tick(links); updateCamera(); draw(ctx, links);
      }
      sim.raf = requestAnimationFrame(loop);
    }
    sim.raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(sim.raf); ro.disconnect(); };
  }, []);

  const toGraph = useCallback((cx: number, cy: number) => {
    const canvas = canvasRef.current; if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect(), sim = simRef.current;
    return { x: (cx - r.left - sim.w / 2 - sim.pan.x) / sim.zoom, y: (cy - r.top - sim.h / 2 - sim.pan.y) / sim.zoom };
  }, []);

  const hitNode = useCallback((gx: number, gy: number): GNode | null => {
    const sim = simRef.current;
    let best: GNode | null = null; let bestD = Infinity;
    for (const n of sim.nodes) {
      const r = (nodeRadius(n.kind) + 5) / Math.sqrt(sim.zoom);
      const d = (n.x - gx) ** 2 + (n.y - gy) ** 2;
      if (d <= r * r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const sim = simRef.current; const gp = toGraph(e.clientX, e.clientY);
    if (sim.dragId) {
      const n = sim.nodes.find(n => n.id === sim.dragId);
      if (n) { n.x = gp.x + sim.dragOffset.x; n.y = gp.y + sim.dragOffset.y; n.vx = 0; n.vy = 0; }
      sim.didDrag = true; sim.alpha = Math.max(sim.alpha, 0.3); return;
    }
    if (sim.isPanning) {
      sim.pan.x = e.clientX - sim.panStart.x; sim.pan.y = e.clientY - sim.panStart.y;
      sim.didDrag = true; return;
    }
    const hit = hitNode(gp.x, gp.y); sim.hoverId = hit?.id ?? null;
    if (canvasRef.current) canvasRef.current.style.cursor = hit ? "pointer" : "grab";
  }, [toGraph, hitNode]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const sim = simRef.current; const gp = toGraph(e.clientX, e.clientY);
    sim.didDrag = false; sim.target = null; sim.fitFrames = 0;
    const hit = hitNode(gp.x, gp.y);
    if (hit) { sim.dragId = hit.id; sim.dragOffset = { x: hit.x - gp.x, y: hit.y - gp.y }; hit.pinned = true; }
    else { sim.isPanning = true; sim.panStart = { x: e.clientX - sim.pan.x, y: e.clientY - sim.pan.y }; }
  }, [toGraph, hitNode]);

  const onMouseUp = useCallback(() => {
    const sim = simRef.current;
    if (sim.dragId) { const n = sim.nodes.find(n => n.id === sim.dragId); if (n) n.pinned = false; sim.dragId = null; }
    sim.isPanning = false;
  }, []);

  const onMouseLeave = useCallback(() => { onMouseUp(); simRef.current.hoverId = null; }, [onMouseUp]);

  const focusNode = useCallback((n: GNode) => {
    onFocus({ fullPath: n.fullPath, label: n.label, bucketId: n.bucketId });
  }, [onFocus]);

  const onClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const sim = simRef.current; if (sim.didDrag) return;
    const gp = toGraph(e.clientX, e.clientY); const hit = hitNode(gp.x, gp.y);
    if (!hit) return;
    if (hit.kind === "file") {
      onOpenFile({ name: hit.label + ".md", relPath: hit.relPath, fullPath: hit.fullPath, type: "file", children: undefined });
    }
  }, [toGraph, hitNode, onOpenFile]);

  const onDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const gp = toGraph(e.clientX, e.clientY); const hit = hitNode(gp.x, gp.y);
    if (hit && hit.kind !== "file") focusNode(hit);
  }, [toGraph, hitNode, focusNode]);

  // Right-click: focus a project/folder; on empty space, step back out.
  const onContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const gp = toGraph(e.clientX, e.clientY); const hit = hitNode(gp.x, gp.y);
    if (hit && hit.kind !== "file" && hit.fullPath !== focus?.fullPath) { focusNode(hit); return; }
    if (focus) onFocus(null);
  }, [toGraph, hitNode, focus, focusNode, onFocus]);

  // Wheel zoom around the cursor (non-passive to allow preventDefault)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      const sim = simRef.current;
      sim.target = null; sim.fitFrames = 0;
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left - sim.w / 2, my = e.clientY - r.top - sim.h / 2;
      const next = Math.max(0.15, Math.min(5, sim.zoom * (e.deltaY > 0 ? 0.9 : 1.11)));
      sim.pan.x = mx - (mx - sim.pan.x) * (next / sim.zoom);
      sim.pan.y = my - (my - sim.pan.y) * (next / sim.zoom);
      sim.zoom = next;
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  const zoomBy = (factor: number): void => {
    const sim = simRef.current; sim.fitFrames = 0;
    const zoom = Math.max(0.15, Math.min(5, sim.zoom * factor));
    sim.target = { x: sim.pan.x * (zoom / sim.zoom), y: sim.pan.y * (zoom / sim.zoom), zoom };
  };
  const fit = (): void => { simRef.current.fitFrames = 45; };

  if (buckets.length === 0) return (
    <div className="vault-note-placeholder">
      <FileText size={32} style={{ opacity: 0.2 }} />
      <span>No knowledge bases — create one in the Knowledge Bases tab</span>
    </div>
  );

  const crumbs: { label: string; target: GraphFocus | null }[] = [{ label: "All projects", target: null }];
  if (focus) {
    const bucket = buckets.find(b => b.id === focus.bucketId);
    const base = bucketTrees[focus.bucketId]?.bucketPath ?? "";
    if (bucket && base) {
      crumbs.push({ label: bucket.name, target: { fullPath: base, label: bucket.name, bucketId: bucket.id } });
      const rel = normPath(focus.fullPath).slice(normPath(base).length).split("/").filter(Boolean);
      let acc = normPath(base);
      for (const part of rel) {
        acc = `${acc}/${part}`;
        crumbs.push({ label: part, target: { fullPath: acc, label: part, bucketId: bucket.id } });
      }
    }
  }

  return (
    <div className="vault-graph-wrap">
      <canvas ref={canvasRef} className="vault-graph-canvas"
        onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave} onClick={onClick} onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />

      <div className="vault-graph-crumbs">
        {crumbs.map((c, i) => (
          <span key={i} className="vault-graph-crumb-wrap">
            {i > 0 && <span className="vault-graph-crumb-sep">/</span>}
            <button
              className={`vault-graph-crumb${i === crumbs.length - 1 ? " vault-graph-crumb-current" : ""}`}
              onClick={() => onFocus(c.target)}
              disabled={i === crumbs.length - 1}
            >{c.label}</button>
          </span>
        ))}
        {focus && (
          <button className="vault-graph-crumb-back" onClick={() => onFocus(null)} title="Zoom back out">
            <ArrowLeft size={12} /> Back
          </button>
        )}
      </div>

      <div className="vault-graph-controls">
        <button className="vault-graph-ctrl" onClick={() => zoomBy(1.25)} title="Zoom in"><Plus size={14} /></button>
        <button className="vault-graph-ctrl" onClick={() => zoomBy(0.8)} title="Zoom out"><Minus size={14} /></button>
        <button className="vault-graph-ctrl" onClick={fit} title="Fit to view"><Maximize2 size={13} /></button>
      </div>

      {nodeCount === 0 && (
        <div className="vault-graph-empty">
          <FileText size={28} style={{ opacity: 0.2 }} />
          <span>{focus ? "Nothing in this folder yet" : "Add files to your knowledge bases to see the graph"}</span>
        </div>
      )}

      <div className="vault-graph-legend">
        {buckets.filter(b => !focus || b.id === focus.bucketId).map(b => (
          <button key={b.id} className="vault-graph-legend-item"
            onClick={() => {
              const base = bucketTrees[b.id]?.bucketPath;
              if (base) onFocus({ fullPath: base, label: b.name, bucketId: b.id });
            }}
            title={`Focus ${b.name}`}>
            <span className="vault-graph-legend-dot" style={{ background: colorMap.current.get(b.id) ?? BUCKET_COLORS[0] }} />
            {b.name}
          </button>
        ))}
        <span className="vault-graph-legend-key"><span className="vault-graph-key-solid" /> in folder</span>
        <span className="vault-graph-legend-key"><span className="vault-graph-key-dashed" /> linked</span>
      </div>
      <div className="vault-graph-hint">Right-click a folder to focus · right-click empty space to zoom out</div>
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
  const [graphFocus, setGraphFocus] = useState<GraphFocus | null>(null);

  // Focusing shows the graph, so close any open note first.
  const focusGraph = useCallback((focus: GraphFocus | null) => {
    setGraphFocus(focus);
    if (focus) setOpenFile(null);
  }, []);

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
                    onContextMenu={(e) => {
                      if (!bucketPath) return;
                      handleContextMenu(e, { name: bucket.name, relPath: "", fullPath: bucketPath, type: "dir" }, bucket.id, bucketPath);
                    }}
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

        {/* Editor panel — graph when idle, editor when file open */}
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
            <VaultGraph
              buckets={buckets}
              bucketTrees={bucketTrees}
              focus={graphFocus}
              onFocus={focusGraph}
              onOpenFile={openFileNode}
            />
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
            onFocus={(node) => focusGraph({
              fullPath: node.fullPath,
              label: node.relPath === "" ? (buckets.find((b) => b.id === ctxMenu.bucketId)?.name ?? node.name) : node.name,
              bucketId: ctxMenu.bucketId,
            })}
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
