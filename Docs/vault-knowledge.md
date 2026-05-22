# Vault — Bucketed Knowledge Management

The Hermes Vault is a multi-bucket, filesystem-backed knowledge base with full-text search, wikilink graph traversal, and an Obsidian-compatible note format.

## Architecture

```
~/.hermes/vault/
├── vault.db              ← SQLite FTS5 search index + metadata
├── index.json            ← Human-readable bucket registry
├── <bucket>/
│   ├── bucket.json       ← Bucket metadata (name, description)
│   └── **/*.md           ← Markdown notes with YAML frontmatter
└── ...
```

### Three-Layer Design

| Layer | Location | Purpose |
|--------|----------|---------|
| **Python Backend** | `Agent/tools/vault_tool.py`, `vault_db.py` | SQLite FTS5 index, file I/O, search, wikilink parsing |
| **Electron IPC** | `Desktop/src/main/vault.ts` | Bridges renderer to Python backend via HTTP API calls |
| **React UI** | `Desktop/src/renderer/src/screens/Vault/Vault.tsx` | File explorer, markdown editor, search, bucket management |

## Bucketed Knowledge Model

Each "bucket" is a named, independent knowledge base — a subdirectory under the vault root with its own files and metadata. Buckets can be nested with `/` in the path (e.g., `work/project-alpha`).

### Bucket Registry (`index.json`)
Maps bucket slugs to metadata: display name, description, and filesystem path.

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

The Vault screen (`Vault.tsx`, ~1200 lines) has two tabs:

### Explorer Tab
- Buckets listed as sections with full file tree (always expanded)
- Per-bucket actions: new file, new folder
- Drag-and-drop to move files between/within buckets
- Right-click context menu on files (new, delete, rename)
- Inline markdown editor with Edit/Preview toggle
- Formatting toolbar (bold, italic, headings, code, lists, wikilinks)
- Wikilink picker modal — search and insert note references
- Search bar with debounced FTS5 results (350ms debounce)
- Sync indicator showing stale document count

### Knowledge Bases Tab
- Card grid of all buckets with name, description, document count, stale status
- Create new bucket form: name, description, custom folder path
- Inline edit of bucket name/description
- Two-step confirm delete
- "Sync Changed" — selective reindex of stale documents
- "Full Reindex" — complete FTS5 index rebuild

## Agent Tools

The vault registers 5 tools in the `vault` toolset:

| Tool | Description |
|------|-------------|
| `vault_list_buckets` | List all knowledge bases with document counts |
| `vault_browse` | List files in a bucket (filterable by path prefix) |
| `vault_search` | FTS5 full-text search across buckets |
| `vault_create_bucket` | Create a new knowledge base |
| `vault_reindex` | Sync database with vault files on disk |

**Design note**: The agent reads/writes notes using standard file tools (`read_file`, `write_file`, `patch`) directly on vault paths. Vault tools only handle DB-dependent operations: discovery, search, bucket management, and freshness tracking.

## Obsidian Integration

The vault is Obsidian-compatible by design:

- **File format**: Standard `.md` files with YAML frontmatter
- **Wikilinks**: `[[Note Title]]` syntax (same as Obsidian)
- **Skill**: `Agent/skills/note-taking/obsidian/SKILL.md` — an Obsidian skill that uses file tools to interact with an Obsidian vault directory
- **Env var**: `OBSIDIAN_VAULT_PATH` — configurable vault location (falls back to `~/Documents/Obsidian Vault`)

The obsidian skill and hermes-vault skill share the same wikilink format, making notes portable between Obsidian and the Hermes vault. The obsidian skill is available on all platforms (linux, macos, windows).

## IPC API

```typescript
// Bucket management
window.hermesAPI.getVaultStatus(): Promise<VaultStatus>
window.hermesAPI.listVaultBuckets(): Promise<Bucket[]>
window.hermesAPI.createVaultBucket(name, desc, path?): Promise<void>
window.hermesAPI.deleteVaultBucket(id): Promise<void>
window.hermesAPI.updateVaultBucket(id, updates): Promise<void>

// File operations
window.hermesAPI.treeVaultBucket(bucketId?): Promise<TreeNode>
window.hermesAPI.readVaultFile(bucketId, path): Promise<string>
window.hermesAPI.writeVaultFile(bucketId, path, content): Promise<void>
window.hermesAPI.createVaultFile(bucketId, path): Promise<void>
window.hermesAPI.createVaultFolder(bucketId, path): Promise<void>
window.hermesAPI.deleteVaultItem(bucketId, path): Promise<void>
window.hermesAPI.moveVaultItem(bucketId, src, dst): Promise<void>

// Search & maintenance
window.hermesAPI.searchVault(query, bucketId?, limit?, tokens?, depth?): Promise<SearchResult[]>
window.hermesAPI.reindexVault(bucketId?): Promise<void>
window.hermesAPI.getVaultBucketLinks(): Promise<Link[]>
```
