import { apiFetch } from "./hermes";
import type { DiscoverModelsResult } from "./model-discovery";

/**
 * Theta: operations that used to touch this machine's disk and now go to
 * the server, so the app behaves the same whether the server is local or
 * remote.
 */

/** Upload a file's bytes to the server workspace; returns the server path. */
export async function uploadAttachment(
  sessionId: string,
  filename: string,
  base64Bytes: string,
): Promise<string> {
  const { ok, data } = await apiFetch("/api/attachments", {
    method: "POST",
    body: { session_id: sessionId, filename, data: base64Bytes },
    timeoutMs: 120000,
  });
  const result = (data as { path?: string; detail?: string }) || {};
  if (!ok || !result.path) {
    throw new Error(result.detail || "Upload to the server failed");
  }
  return result.path;
}

/** List a provider's models on the server, using the server's own keys. */
export async function discoverProviderModelsViaServer(
  provider: string,
  baseUrl: string | undefined,
  apiKey: string | undefined,
  profile: string | undefined,
): Promise<DiscoverModelsResult> {
  const { ok, data } = await apiFetch("/api/providers/models", {
    method: "POST",
    body: { provider, base_url: baseUrl || "", api_key: apiKey || "" },
    params: profile ? { profile } : undefined,
    timeoutMs: 20000,
  });
  if (!ok || !data) return { models: [], status: "unknown-host", cached: false };
  return data as DiscoverModelsResult;
}
