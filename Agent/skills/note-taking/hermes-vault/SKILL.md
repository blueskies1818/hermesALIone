---
name: hermes-vault
description: "Manage the Hermes multi-bucket knowledge vault — search, navigate, and organise knowledge bases at ~/.hermes/vault/."
version: 1.0.0
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [knowledge-base, notes, rag, vault, obsidian, search]
    related_skills: [obsidian, research-paper-writing, systematic-debugging]
    requires_tools: [vault_list_buckets, vault_browse, vault_search, vault_create_bucket, vault_reindex]
    config:
      - key: vault.path
        description: Path to the Hermes vault root directory
        default: "~/.hermes/vault"
        prompt: Vault directory path
---

# Hermes Vault — Multi-Bucket Knowledge Base

## Overview

The Hermes vault is a local knowledge management system living at `~/.hermes/vault/`. It organises notes into **buckets** — named knowledge bases, each a subdirectory. The vault is the source of truth; the database tracks metadata and enables fast search.

**Core principle: the vault DB follows the filesystem. Files on disk are always authoritative.**

---

## Vault Structure

```
~/.hermes/vault/
├── vault.db              ← search index + metadata (auto-managed)
├── index.json            ← bucket registry (you maintain this)
├── research/             ← example bucket
│   ├── bucket.json
│   ├── transformers-overview.md
│   └── topics/
│       └── attention-mechanism.md
└── personal/
    ├── bucket.json
    └── journal-2026-05.md
```

`index.json` maps bucket slugs to their paths and descriptions:
```json
{
  "updated_at": "2026-05-21T14:00:00",
  "buckets": {
    "research": { "path": "research", "description": "Research papers and notes" }
  }
}
```

---

## Reading and Writing Notes

**Use the existing file toolset directly — do NOT use vault tools for file I/O.**

```
# Read a note
read_file path=~/.hermes/vault/research/transformers-overview.md

# Write a new note
write_file path=~/.hermes/vault/research/new-topic.md content="..."

# Update part of a note
patch path=~/.hermes/vault/research/new-topic.md ...
```

After writing or editing notes, call `vault_reindex` so the search index stays current.

---

## Discovering What Exists

Always orient before acting:

1. `vault_list_buckets` — see all knowledge bases, their doc counts, and stale status
2. `vault_browse bucket=<id>` — list files in a bucket; filter with `path=` prefix
3. `vault_search query=<terms>` — find content by keyword before committing to a full read

Only call `read_file` once you have identified the specific note you need.

---

## Maintaining `index.json`

`index.json` is the human-readable bucket registry. Update it directly using `write_file` or `patch` whenever you create, rename, or delete a bucket. The format is:

```json
{
  "updated_at": "YYYY-MM-DDTHH:MM:SS",
  "buckets": {
    "<bucket-id>": {
      "path": "<relative-path-under-vault>",
      "description": "<purpose of this KB>"
    }
  }
}
```

The `path` field decouples the bucket slug from its directory — e.g. bucket `python-async` can live at `python/async/` for a clean nested structure. If `path` is absent, the bucket id is used as the path.

`vault_create_bucket` and `vault_reindex` both sync `index.json` automatically. You only need to edit it manually when reorganising bucket paths.

---

## Note Authoring Conventions

Notes are standard Markdown files. Use YAML frontmatter for structure:

```markdown
---
title: Attention Mechanism in Transformers
tags: [transformers, attention, deep-learning]
created: 2026-05-21
related: [[Transformer Architecture]], [[Self-Attention]]
---

# Attention Mechanism in Transformers

Content here...
```

**Conventions:**
- Filename: kebab-case slug of the title (e.g. `attention-mechanism.md`)
- Wikilinks: `[[Note Title]]` for cross-references — the DB tracks these as links
- Tags: list in frontmatter; used for filtering and related-note discovery
- One topic per note; split large notes into linked sub-notes

---

## Search Strategy and Token Budgets

`vault_search` accepts two parameters that control how much content comes back:

| Parameter | Default | Options |
|---|---|---|
| `result_depth` | `"snippet"` | `"snippet"` / `"summary"` / `"full"` |
| `token_budget` | `4000` | any integer (500–32000) |

**When to use each depth:**

- **`"snippet"`** — quick discovery across many results; use for broad cross-bucket queries. Low token cost.
- **`"summary"`** — first 500 chars of each match; good for deciding whether a note is worth a full read.
- **`"full"`** — entire document returned inline (subject to `token_budget`). Use when you already know the note is relevant and want its content without a separate `read_file` call.

**Token budget guidance:**
- Broad discovery (all buckets): `token_budget=2000–4000`
- Targeted single-bucket with summaries: `token_budget=4000–8000`
- Full-content retrieval of a few specific notes: `token_budget=8000–16000`

**Query syntax** (FTS5):
- `transformers attention` — matches notes containing both words
- `"exact phrase"` — phrase search
- `transformers AND NOT CNN` — boolean operators
- `embed*` — prefix wildcard

---

## Freshness and Reindexing

The DB tracks whether each file's on-disk content matches what is indexed (`is_stale` flag). `vault_list_buckets` shows `stale_count` per bucket.

**When to reindex:**
- After writing or editing notes in a session → `vault_reindex` (selective, default)
- After bulk restructuring or moving files → `vault_reindex force=true` (full rebuild)
- When search results seem wrong or missing → `vault_reindex force=true`

Selective reindex (default) only re-parses files whose mtime changed since the last index — fast and safe to call routinely.

---

## Bucket Management

**Creating a bucket:**
```
vault_create_bucket name="Python Notes" description="Python language reference"
```
Then write notes to `~/.hermes/vault/python-notes/`.

**Organising buckets:**
- Keep buckets focused — one topic area per bucket
- Use subdirectories within a bucket for structure (they show up in `vault_browse`)
- Flat vs. nested: flat is fine for small KBs; nested folders for large ones

**Deleting a bucket:**
1. Remove the directory using the terminal tool or file tools
2. Update `index.json` to remove the bucket entry (use `patch`)
3. Call `vault_reindex` — it will clean up orphaned DB rows automatically

---

## Workflow Reference

| Task | How |
|---|---|
| Orient in the vault | `vault_list_buckets` |
| Find a file | `vault_browse bucket=<id>` |
| Search by content | `vault_search query=<terms>` |
| Read a note | `read_file path=~/.hermes/vault/<bucket>/<note>.md` |
| Write a new note | `write_file path=~/.hermes/vault/<bucket>/<note>.md` |
| Update a note | `patch path=~/.hermes/vault/<bucket>/<note>.md` |
| Create a new KB | `vault_create_bucket name=<name>` |
| Sync DB after writes | `vault_reindex` |
| Full rebuild | `vault_reindex force=true` |
