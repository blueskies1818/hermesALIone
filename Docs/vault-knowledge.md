# Vault — Bucketed Knowledge Management

The Hermes Vault is a multi-bucket, filesystem-backed knowledge base with full-text search, a force-directed node graph, wikilink traversal, and an Obsidian-compatible note format.

## Architecture

```
~/.hermes/vault/
├── vault.db              ← SQLite FTS5 search index + metadata
├── index.json            ← Human-readable bucket registry
├── <bucket>/
│   ├── bucket.json       ← Bucket metadata (name, description)  [optional]
│   └── **/*.md           ← Markdown notes with YAML frontmatter
└── ...
```

### Three-Layer Design

| Layer | Location | Purpose |
|--------|----------|---------|
| **Python Backend** | `Agent/tools/vault_tool.py`, `vault_db.py` | SQLite FTS5 index, file I/O, search, wikilink parsing |
| **Electron IPC** | `Desktop/src/main/vault.ts` | Bridges renderer to Python backend via HTTP API calls |
| **React UI** | `Desktop/src/renderer/src/screens/Vault/Vault.tsx` | File explorer, node graph, markdown editor, search, bucket management |

## Bucketed Knowledge Model

Each "bucket" is a named, independent knowledge base — a subdirectory under the vault root with its own files and metadata. Buckets can be nested with `/` in the path (e.g., `work/project-alpha`).

### Bucket Registry (`index.json`)
Maps bucket slugs to metadata: display name, description, and filesystem path.

### Bucket Auto-Discovery
Every time the UI requests the bucket list, `_auto_discover_buckets()` scans the vault directory and automatically registers any subdirectory that is not yet in the database — whether or not it has a `bucket.json`. This means:

- Files written directly by the agent via `write_file` become visible in the UI on the next refresh, without requiring a manual `vault_create_bucket` call.
- `bucket.json` is optional. Plain directories are registered using the folder name as both ID and display name.

To guarantee visibility after writing files, agents should still call `vault_reindex` so the FTS5 index reflects the new content.

### SQLite Database (`vault.db`)

| Table | Purpose |
|-------|---------|
| `buckets` | Bucket metadata (id, name, path, description) |
| `documents` | Note metadata (path, title, mtime, `is_stale` flag, frontmatter) |
| `tags` | Tags extracted from YAML frontmatter |
| `links` | Wikilink graph — `[[Target Title]]` references between notes |
| `fts_docs` | FTS5 virtual table for full-text search |

### Freshness Tracking
- Documents are marked `is_stale` when on-disk `mtime` > indexed `modified_at`
- `vault_reindex(force=false)` only re-parses stale/new files (selective sync)
- `vault_reindex(force=true)` rebuilds the entire FTS5 index
- Deleted files are detected and their DB rows removed

## Full-Text Search

FTS5-powered search with configurable result depth:

| Mode | Description |
|------|-------------|
| **snippet** (default) | FTS5 highlighted fragment (~160 chars) |
| **summary** | First 500 characters of matching note |
| **full** | Entire document (subject to token budget) |

Search can filter by bucket and accepts a token budget to control response size.

## Wikilink Graph

Notes can reference each other using `[[Note Title]]` syntax (Obsidian-compatible). The vault parser:

1. Extracts all `[[...]]` links during indexing
2. Stores source → target relationships in the `links` table
3. Enables link traversal via `get_bucket_links()`
4. The UI provides a wikilink picker modal for inserting links
5. Wikilinks are rendered as edges in the force-directed node graph

## YAML Frontmatter

Each note can declare metadata via frontmatter:

```yaml
---
title: My Note Title
tags: [tag1, tag2]
related: [other-note]
---
```

If no `title` is present, the first `# Heading` is used as fallback.

## Desktop UI

The Vault screen (`Vault.tsx`) has two tabs:

### Explorer Tab

**Node Graph (idle state)**

When no file is open, the right panel shows a live, interactive force-directed node graph of all documents across all knowledge bases:

- **Nodes**: each `.md` file is a node, colored by bucket (up to 8 distinct colors, cycling)
- **Edges**: wikilinks (`[[...]]`) between notes are drawn as connecting lines
- **Physics**: Coulomb repulsion keeps nodes apart, Hooke springs pull linked nodes together, gravity draws nodes toward center. Velocity is damped each tick for stable settling.
- **Interaction**:
  - **Drag a node** to reposition it (unpins on release so it continues simulating)
  - **Drag on canvas background** to pan the view
  - **Scroll / pinch** to zoom in and out
  - **Click a node** to open that file in the editor
  - **Hover** shows a glow and full label
- **Legend**: bucket names and their colors shown in the bottom-left corner
- **Empty state**: if no files have been indexed yet, a message prompts the user to add files

**File Tree (left panel)**

- Buckets listed as sections with full recursive file tree (always expanded)
- Per-bucket toolbar: new file, new folder buttons
- Drag-and-drop to move files between/within buckets
- Right-click context menu on any file or folder (new file here, new folder here, delete)
- Inline name input for creating files/folders with Enter to confirm

**Markdown Editor (right panel, when a file is open)**

- Edit/Preview toggle — live markdown rendering via `react-markdown` + `remark-gfm`
- Formatting toolbar: bold, italic, H1/H2/H3, inline code, code block, bullet list, HR, link, wikilink picker
- `Ctrl+S` to save
- Dirty indicator (•) when unsaved changes exist
- Back arrow returns to the node graph

**Search**

- Debounced FTS5 search (350 ms) across all buckets
- Results replace the file tree with title + match snippet
- Clicking a result opens that file in the editor

**Sync Indicator**

- "In sync" badge (green) when all documents are current
- "N stale" button (yellow) opens a sync operation
- Spinner during active reindex

### Knowledge Bases Tab

- Card grid of all buckets with name, description, document count, stale status
- Create new bucket form: name, description, custom folder path (auto-slugged from name)
- Inline edit of bucket name/description
- Two-step confirm delete
- "Sync Changed" — selective reindex of stale documents
- "Full Reindex" — complete FTS5 index rebuild

## Agent Tools

The vault registers 5 tools in the `vault` toolset:

| Tool | Description |
|------|-------------|
| `vault_list_buckets` | List all knowledge bases with document counts (auto-discovers new folders) |
| `vault_browse` | List files in a bucket (filterable by path prefix) |
| `vault_search` | FTS5 full-text search across buckets |
| `vault_create_bucket` | Create a new knowledge base and register it in the database |
| `vault_reindex` | Sync database with vault files on disk |

**Design note**: The agent reads/writes notes using standard file tools (`read_file`, `write_file`, `patch`) directly on vault paths. Vault tools handle DB-dependent operations: discovery, search, bucket management, and freshness tracking. Call `vault_create_bucket` before writing to a new folder (so the UI recognizes it immediately), then `vault_reindex` after writing files so the FTS5 index reflects the new content.

## Obsidian Integration

The vault is Obsidian-compatible by design:

- **File format**: Standard `.md` files with YAML frontmatter
- **Wikilinks**: `[[Note Title]]` syntax (same as Obsidian)
- **Skill**: `Agent/skills/note-taking/obsidian/SKILL.md` — an Obsidian skill that uses file tools to interact with an Obsidian vault directory
- **Default vault path**: `~/.hermes/vault` (configurable via `OBSIDIAN_VAULT_PATH` in `~/.hermes/.env`)

The obsidian skill and hermes-vault skill share the same wikilink format, making notes portable between Obsidian and the Hermes vault. The obsidian skill is available on all platforms (linux, macos, windows).

## IPC API

All vault methods live under `window.hermesAPI.vault`:

```typescript
// Status & buckets
vault.getStatus(): Promise<VaultStatus>
vault.listBuckets(): Promise<Bucket[]>
vault.createBucket(name, description?, customPath?): Promise<{ ok, bucket_id, path, error? }>
vault.deleteBucket(bucketId): Promise<{ ok, error? }>
vault.updateBucket(bucketId, name, description): Promise<{ ok, error? }>

// File tree
vault.tree(bucketId): Promise<{ ok, tree: TreeNode[], bucketPath, error? }>

// File operations
vault.readFile(fullPath): Promise<{ ok, content, error? }>
vault.writeFile(fullPath, content): Promise<{ ok, error? }>
vault.createFile(fullPath): Promise<{ ok, error? }>
vault.createFolder(fullPath): Promise<{ ok, error? }>
vault.deleteItem(fullPath, isDir): Promise<{ ok, error? }>
vault.moveItem(fromPath, toDir): Promise<{ ok, error? }>

// Search & graph
vault.search(query, bucketId?, limit?, tokenBudget?, resultDepth?): Promise<SearchResult[]>
vault.reindex(bucketId?, force?): Promise<ReindexResult>
vault.getLinks(bucketId): Promise<{ ok, links: Link[], error? }>
```

### TreeNode shape
```typescript
interface TreeNode {
  name: string;
  relPath: string;
  fullPath: string;
  type: "file" | "dir";
  children?: TreeNode[];
}
```

### Link shape
```typescript
interface Link {
  fromPath: string;   // relative path of the source note
  toPath: string | null;  // relative path of the target (null if unresolved)
  toTitle: string;    // raw wikilink text
}
```
