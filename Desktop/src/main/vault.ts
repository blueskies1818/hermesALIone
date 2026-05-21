/**
 * vault.ts — Desktop IPC handlers for the Hermes multi-bucket knowledge vault.
 *
 * All operations are proxied to the Python backend via apiFetch.
 * No direct filesystem or SQLite access — keeps the app portable.
 */

import { apiFetch } from "./hermes";

// ---------------------------------------------------------------------------
// Re-exported types (consumed by index.ts IPC handlers)
// ---------------------------------------------------------------------------

export interface VaultBucket {
  id: string;
  name: string;
  description: string;
  path: string;
  doc_count: number;
  stale_count: number;
  is_stale: boolean;
  note_path: string;
}

export interface VaultEntry {
  rel_path: string;
  filename: string;
  title: string | null;
  chars: number;
  is_stale: boolean;
  full_path: string;
}

export interface VaultSearchResult {
  bucket_id: string;
  bucket_name: string;
  rel_path: string;
  title: string | null;
  match: string;
  depth: string;
}

export interface VaultStatus {
  total_docs: number;
  stale_docs: number;
  buckets: Array<{ id: string; name: string; doc_count: number; stale_count: number }>;
}

export interface ReindexResult {
  ok: boolean;
  mode: "selective" | "full";
  buckets_processed: number;
  total_indexed: number;
  total_deleted: number;
  details: Array<{
    bucket_id: string;
    bucket_name: string;
    indexed: number;
    skipped: number;
    deleted: number;
  }>;
}

export interface TreeNode {
  name: string;
  relPath: string;
  fullPath: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiData<T>(data: unknown): T {
  return data as T;
}

function errResult(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Bucket operations
// ---------------------------------------------------------------------------

export async function getVaultStatus(): Promise<VaultStatus> {
  const { ok, data } = await apiFetch("/api/vault/status");
  if (!ok) return { total_docs: 0, stale_docs: 0, buckets: [] };
  return apiData<VaultStatus>(data);
}

export async function listVaultBuckets(): Promise<VaultBucket[]> {
  const { ok, data } = await apiFetch("/api/vault/buckets");
  if (!ok) return [];
  const res = apiData<{ ok: boolean; buckets?: VaultBucket[] }>(data);
  return res.buckets ?? [];
}

export async function createVaultBucket(
  name: string,
  description = "",
  customPath?: string,
): Promise<{ ok: boolean; bucket_id: string; path: string; error?: string }> {
  const { ok, data } = await apiFetch("/api/vault/buckets", {
    method: "POST",
    body: { name, description, path: customPath ?? null },
  });
  if (!ok) return { ok: false, bucket_id: "", path: "", error: String((data as any)?.detail ?? "Failed") };
  return apiData<{ ok: boolean; bucket_id: string; path: string }>(data);
}

export async function deleteVaultBucket(bucketId: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch(`/api/vault/buckets/${encodeURIComponent(bucketId)}`, {
    method: "DELETE",
  });
  if (!ok) return errResult(String((data as any)?.detail ?? "Failed"));
  return apiData<{ ok: boolean }>(data);
}

export async function updateVaultBucket(
  bucketId: string,
  name: string,
  description: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch(`/api/vault/buckets/${encodeURIComponent(bucketId)}`, {
    method: "PATCH",
    body: { name, description },
  });
  if (!ok) return errResult(String((data as any)?.detail ?? "Failed"));
  return apiData<{ ok: boolean }>(data);
}

// ---------------------------------------------------------------------------
// Tree / file operations
// ---------------------------------------------------------------------------

export async function treeVaultBucket(bucketId: string): Promise<{
  ok: boolean;
  tree: TreeNode[];
  bucketPath: string;
  error?: string;
}> {
  const { ok, data } = await apiFetch(`/api/vault/buckets/${encodeURIComponent(bucketId)}/tree`);
  if (!ok) return { ok: false, tree: [], bucketPath: "", error: String((data as any)?.detail ?? "Failed") };
  return apiData<{ ok: boolean; tree: TreeNode[]; bucketPath: string }>(data);
}

export async function readVaultFile(
  fullPath: string,
): Promise<{ ok: boolean; content: string; error?: string }> {
  const { ok, data } = await apiFetch("/api/vault/files", {
    params: { path: fullPath },
  });
  if (!ok) return { ok: false, content: "", error: String((data as any)?.detail ?? "Failed") };
  return apiData<{ ok: boolean; content: string }>(data);
}

export async function writeVaultFile(
  fullPath: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/vault/files", {
    method: "POST",
    body: { path: fullPath, content },
  });
  if (!ok) return errResult(String((data as any)?.detail ?? "Failed"));
  return apiData<{ ok: boolean }>(data);
}

export async function createVaultFile(fullPath: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/vault/files/create", {
    method: "POST",
    body: { path: fullPath },
  });
  if (!ok) return errResult(String((data as any)?.detail ?? "Failed"));
  return apiData<{ ok: boolean }>(data);
}

export async function createVaultFolder(fullPath: string): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/vault/files/mkdir", {
    method: "POST",
    body: { path: fullPath },
  });
  if (!ok) return errResult(String((data as any)?.detail ?? "Failed"));
  return apiData<{ ok: boolean }>(data);
}

export async function deleteVaultItem(
  fullPath: string,
  isDir: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/vault/files", {
    method: "DELETE",
    body: { path: fullPath, is_dir: isDir },
  });
  if (!ok) return errResult(String((data as any)?.detail ?? "Failed"));
  return apiData<{ ok: boolean }>(data);
}

export async function moveVaultItem(
  fromPath: string,
  toDir: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/vault/files/move", {
    method: "POST",
    body: { from_path: fromPath, to_dir: toDir },
  });
  if (!ok) return errResult(String((data as any)?.detail ?? "Failed"));
  return apiData<{ ok: boolean }>(data);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchVault(
  query: string,
  bucketId?: string,
  limit = 10,
  tokenBudget = 4000,
  resultDepth: "snippet" | "summary" | "full" = "snippet",
): Promise<VaultSearchResult[]> {
  const { ok, data } = await apiFetch("/api/vault/search", {
    method: "POST",
    body: {
      query,
      bucket: bucketId ?? null,
      limit,
      token_budget: tokenBudget,
      result_depth: resultDepth,
    },
  });
  if (!ok) return [];
  const res = apiData<{ ok: boolean; results?: VaultSearchResult[] }>(data);
  return res.results ?? [];
}

// ---------------------------------------------------------------------------
// Reindex
// ---------------------------------------------------------------------------

export async function reindexVault(
  bucketFilter?: string,
  force = false,
): Promise<ReindexResult> {
  const { ok, data } = await apiFetch("/api/vault/reindex", {
    method: "POST",
    body: { bucket: bucketFilter ?? null, force },
  });
  if (!ok) {
    return { ok: false, mode: "selective", buckets_processed: 0, total_indexed: 0, total_deleted: 0, details: [] };
  }
  return apiData<ReindexResult>(data);
}

// ---------------------------------------------------------------------------
// Links (wikilink graph)
// ---------------------------------------------------------------------------

export async function getBucketLinks(
  bucketId: string,
): Promise<{ ok: boolean; links: { fromPath: string; toPath: string | null; toTitle: string }[]; error?: string }> {
  const { ok, data } = await apiFetch(`/api/vault/buckets/${encodeURIComponent(bucketId)}/links`);
  if (!ok) return { ok: false, links: [], error: String((data as any)?.detail ?? "Failed") };
  return apiData<{ ok: boolean; links: { fromPath: string; toPath: string | null; toTitle: string }[] }>(data);
}

// ---------------------------------------------------------------------------
// Browse (DB-indexed file list — used by agent tools, not by the tree UI)
// ---------------------------------------------------------------------------

export async function browseVaultBucket(
  bucketId: string,
  pathPrefix?: string,
): Promise<VaultEntry[]> {
  const params: Record<string, string> = {};
  if (pathPrefix) params.path = pathPrefix;
  const { ok, data } = await apiFetch(
    `/api/vault/buckets/${encodeURIComponent(bucketId)}/tree`,
    { params },
  );
  if (!ok) return [];
  // tree endpoint returns tree nodes, not VaultEntry format — return empty for now
  // (browseVaultBucket is used by agent tools that call the Python vault_browse tool directly)
  void data;
  return [];
}
