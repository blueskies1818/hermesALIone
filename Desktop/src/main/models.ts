import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { apiFetch } from "./hermes";
import DEFAULT_MODELS from "./default-models";
import { HERMES_HOME } from "./installer";

export interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiMode?: string | null;
  createdAt: number;
}

export async function listModels(): Promise<SavedModel[]> {
  const { ok, data } = await apiFetch("/api/models");
  if (!ok) return DEFAULT_MODELS.map((m, i) => ({ ...m, id: `__default__${i}`, createdAt: 0 }));

  const items = data as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) {
    return DEFAULT_MODELS.map((m, i) => ({ ...m, id: `__default__${i}`, createdAt: 0 }));
  }
  if (items.length === 0) return [];

  return items.map((m) => ({
    id: String(m.id || ""),
    name: String(m.name || ""),
    provider: String(m.provider || ""),
    model: String(m.model || ""),
    baseUrl: String(m.baseUrl || m.base_url || ""),
    apiMode: m.apiMode ? String(m.apiMode) : (m.api_mode ? String(m.api_mode) : null),
    createdAt: Number(m.createdAt || m.created_at || 0),
  }));
}

export async function addModel(
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
): Promise<SavedModel> {
  const { ok, data } = await apiFetch("/api/models", {
    method: "POST",
    body: { name, provider, model, baseUrl },
  });
  if (!ok) throw new Error("Failed to add model");
  const m = data as Record<string, unknown>;
  return {
    id: String(m.id || ""),
    name: String(m.name || ""),
    provider: String(m.provider || ""),
    model: String(m.model || ""),
    baseUrl: String(m.baseUrl || ""),
    apiMode: m.apiMode ? String(m.apiMode) : null,
    createdAt: Number(m.createdAt || 0),
  };
}

export async function removeModel(id: string): Promise<boolean> {
  if (!id) return false;
  const { ok } = await apiFetch(`/api/models/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!ok) throw new Error("Failed to remove model");
  return true;
}

export async function updateModel(
  id: string,
  fields: Partial<Pick<SavedModel, "name" | "provider" | "model" | "baseUrl">>,
): Promise<boolean> {
  if (!id) return false;
  const { ok } = await apiFetch(`/api/models/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: fields,
  });
  return ok;
}

// Local sync read for the CLI fallback path (sendMessageViaCli).
// Used only when the API server isn't reachable in local mode.
const MODELS_FILE = join(HERMES_HOME, "models.json");

export function readModels(): SavedModel[] {
  try {
    if (!existsSync(MODELS_FILE)) return [];
    const raw = JSON.parse(readFileSync(MODELS_FILE, "utf-8"));
    if (!Array.isArray(raw)) return [];
    return raw.map((m: Record<string, unknown>) => ({
      id: String(m.id || ""),
      name: String(m.name || ""),
      provider: String(m.provider || ""),
      model: String(m.model || ""),
      baseUrl: String(m.baseUrl || m.base_url || ""),
      apiMode: m.apiMode ? String(m.apiMode) : (m.api_mode ? String(m.api_mode) : null),
      createdAt: Number(m.createdAt || m.created_at || 0),
    }));
  } catch {
    return [];
  }
}
