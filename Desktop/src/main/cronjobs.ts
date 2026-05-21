import { apiFetch } from "./hermes";

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  state: "active" | "paused" | "completed";
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  repeat: { times: number | null; completed: number } | null;
  deliver: string[];
  skills: string[];
  script: string | null;
}

function normalizeJob(job: Record<string, unknown>): CronJob | null {
  if (!job.id) return null;
  const enabled = job.enabled !== false;
  let state: CronJob["state"] = "active";
  if (job.state === "paused" || !enabled) state = "paused";
  else if (job.state === "completed") state = "completed";
  const schedule = job.schedule as { value?: string } | string | undefined;
  return {
    id: String(job.id),
    name: (job.name as string) || "(unnamed)",
    schedule:
      (job.schedule_display as string) ||
      (typeof schedule === "object" ? schedule?.value : schedule) ||
      "?",
    prompt: (job.prompt as string) || "",
    state,
    enabled,
    next_run_at: (job.next_run_at as string) || null,
    last_run_at: (job.last_run_at as string) || null,
    last_status: (job.last_status as string) || null,
    last_error: (job.last_error as string) || null,
    repeat: (job.repeat as CronJob["repeat"]) || null,
    deliver: Array.isArray(job.deliver)
      ? (job.deliver as string[])
      : job.deliver
        ? [job.deliver as string]
        : ["local"],
    skills:
      (job.skills as string[]) || (job.skill ? [job.skill as string] : []),
    script: (job.script as string) || null,
  };
}

export async function listCronJobs(
  includeDisabled = true,
  profile?: string,
): Promise<CronJob[]> {
  const params: Record<string, string> = {};
  if (profile && profile !== "default") params.profile = profile;
  if (!includeDisabled) params.include_disabled = "false";

  const { ok, data } = await apiFetch("/api/cron/jobs", { params });
  if (!ok) {
    console.error("[CRON] list failed:", (data as any)?.detail);
    return [];
  }
  const raw = (data as any)?.jobs || [];
  const jobs: CronJob[] = [];
  for (const job of raw) {
    const normalized = normalizeJob(job);
    if (!normalized) continue;
    if (!includeDisabled && !normalized.enabled) continue;
    jobs.push(normalized);
  }
  return jobs;
}

export async function createCronJob(
  schedule: string,
  prompt?: string,
  name?: string,
  deliver?: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const { ok, data } = await apiFetch("/api/cron/jobs", {
    method: "POST",
    body: {
      name: name || "",
      schedule,
      prompt: prompt || "",
      deliver: deliver || "local",
      profile: profile || "default",
    },
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "Create failed" };
  return { success: true };
}

export async function removeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  const { ok, data } = await apiFetch(`/api/cron/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    params: profile && profile !== "default" ? { profile } : undefined,
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "Delete failed" };
  return { success: true };
}

export async function pauseCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  const { ok, data } = await apiFetch(`/api/cron/jobs/${encodeURIComponent(jobId)}/pause`, {
    method: "POST",
    params: profile && profile !== "default" ? { profile } : undefined,
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "Pause failed" };
  return { success: true };
}

export async function resumeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  const { ok, data } = await apiFetch(`/api/cron/jobs/${encodeURIComponent(jobId)}/resume`, {
    method: "POST",
    params: profile && profile !== "default" ? { profile } : undefined,
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "Resume failed" };
  return { success: true };
}

export async function triggerCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  const { ok, data } = await apiFetch(`/api/cron/jobs/${encodeURIComponent(jobId)}/trigger`, {
    method: "POST",
    params: profile && profile !== "default" ? { profile } : undefined,
  });
  if (!ok) return { success: false, error: (data as any)?.detail || "Trigger failed" };
  return { success: true };
}
