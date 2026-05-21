import { apiFetch, isRemoteMode, restartGateway } from "./hermes";

const LOCAL_BASE = "http://127.0.0.1:9119";

async function localFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${LOCAL_BASE}${path}`, init);
}

export async function getFullConfig(): Promise<Record<string, unknown>> {
  if (isRemoteMode()) {
    const { ok, data } = await apiFetch("/api/config");
    if (!ok) throw new Error("Failed to fetch config");
    return (data as Record<string, unknown>) || {};
  }
  const res = await localFetch("/api/config");
  if (!res.ok) throw new Error("Failed to fetch config");
  return await res.json();
}

export async function saveFullConfig(config: Record<string, unknown>): Promise<void> {
  if (isRemoteMode()) {
    const { ok, data } = await apiFetch("/api/config", {
      method: "PUT",
      body: { config },
    });
    if (!ok) throw new Error(String((data as any)?.detail) || "Failed to save config");
    return;
  }
  const res = await localFetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  if (!res.ok) throw new Error("Failed to save config");
}

export async function getConfigSchema(): Promise<{
  fields: Record<string, Record<string, unknown>>;
  category_order: string[];
}> {
  if (isRemoteMode()) {
    const { ok, data } = await apiFetch("/api/config/schema");
    if (!ok) throw new Error("Failed to fetch schema");
    return data as { fields: Record<string, Record<string, unknown>>; category_order: string[] };
  }
  const res = await localFetch("/api/config/schema");
  if (!res.ok) throw new Error("Failed to fetch schema");
  return await res.json();
}

export async function getConfigDefaults(): Promise<Record<string, unknown>> {
  if (isRemoteMode()) {
    const { ok, data } = await apiFetch("/api/config/defaults");
    if (!ok) throw new Error("Failed to fetch defaults");
    return (data as Record<string, unknown>) || {};
  }
  const res = await localFetch("/api/config/defaults");
  if (!res.ok) throw new Error("Failed to fetch defaults");
  return await res.json();
}

export async function getConfigRaw(): Promise<string> {
  if (isRemoteMode()) {
    const { ok, data } = await apiFetch("/api/config/raw");
    if (!ok) throw new Error("Failed to fetch raw config");
    return String((data as any)?.yaml || "");
  }
  const res = await localFetch("/api/config/raw");
  if (!res.ok) throw new Error("Failed to fetch raw config");
  const data = await res.json();
  return String((data as any)?.yaml || "");
}

export async function saveConfigRaw(yamlText: string): Promise<void> {
  if (isRemoteMode()) {
    const { ok, data } = await apiFetch("/api/config/raw", {
      method: "PUT",
      body: { yaml_text: yamlText },
    });
    if (!ok) throw new Error(String((data as any)?.detail) || "Failed to save raw config");
    return;
  }
  const res = await localFetch("/api/config/raw", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yaml_text: yamlText }),
  });
  if (!res.ok) throw new Error("Failed to save raw config");
}

export async function restartGatewayForConfig(): Promise<boolean> {
  try {
    if (isRemoteMode()) {
      await apiFetch("/api/gateway/restart", { method: "POST" });
      return true;
    }
    await restartGateway();
    return true;
  } catch {
    return false;
  }
}
