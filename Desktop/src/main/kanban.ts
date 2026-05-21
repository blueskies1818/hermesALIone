import { apiFetch } from "./hermes";

export interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
  tenant: string | null;
  workspace_kind: string;
  workspace_path: string | null;
  created_by: string | null;
  created_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  skills: string[];
  max_retries: number | null;
}

export interface KanbanBoard {
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  is_current: boolean;
  archived?: boolean;
  total: number;
  counts: Record<string, number>;
  db_path?: string;
}

export interface KanbanRun {
  id: number;
  task_id: string;
  profile: string | null;
  status: string | null;
  outcome: string | null;
  summary: string | null;
  error: string | null;
  started_at: number | null;
  ended_at: number | null;
  last_heartbeat_at: number | null;
}

export interface KanbanComment {
  id: number;
  task_id: string;
  author: string | null;
  body: string;
  created_at: number;
}

export interface KanbanEvent {
  id: number;
  task_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: number;
  run_id: number | null;
}

export interface KanbanTaskDetail {
  task: KanbanTask;
  comments: KanbanComment[];
  events: KanbanEvent[];
  parents: string[];
  children: string[];
  runs: KanbanRun[];
  latest_summary: string | null;
}

export interface KanbanResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  stdout?: string;
}

function profileParams(profile?: string): Record<string, string> {
  return profile && profile !== "default" ? { profile } : {};
}

async function apiKanban<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
): Promise<KanbanResult<T>> {
  const { ok, status, data } = await apiFetch(path, { method, body, params });
  if (!ok) {
    return { success: false, error: (data as any)?.detail || `HTTP ${status}` };
  }
  return { success: true, data: (data as any)?.data as T };
}

export async function listBoards(
  includeArchived = false,
  profile?: string,
): Promise<KanbanResult<KanbanBoard[]>> {
  return apiKanban<KanbanBoard[]>("GET", "/api/kanban/boards", undefined, {
    ...profileParams(profile),
    includeArchived: String(includeArchived),
  });
}

export async function currentBoard(
  profile?: string,
): Promise<KanbanResult<string>> {
  const res = await apiKanban<string>("GET", "/api/kanban/boards/current", undefined, profileParams(profile));
  return res;
}

export async function switchBoard(
  slug: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("POST", `/api/kanban/boards/${encodeURIComponent(slug)}/switch`, undefined, profileParams(profile));
}

export async function createBoard(
  slug: string,
  name?: string,
  switchAfter = false,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("POST", "/api/kanban/boards", {
    slug,
    name: name || slug,
    switchAfter,
  });
}

export async function removeBoard(
  slug: string,
  hardDelete = false,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("DELETE", `/api/kanban/boards/${encodeURIComponent(slug)}`, undefined, {
    ...profileParams(profile),
    hardDelete: String(hardDelete),
  });
}

export async function listTasks(
  opts: {
    status?: string;
    assignee?: string;
    tenant?: string;
    includeArchived?: boolean;
    profile?: string;
  } = {},
): Promise<KanbanResult<KanbanTask[]>> {
  const params: Record<string, string> = profileParams(opts.profile);
  if (opts.status) params.status = opts.status;
  if (opts.assignee) params.assignee = opts.assignee;
  if (opts.tenant) params.tenant = opts.tenant;
  if (opts.includeArchived) params.includeArchived = "true";
  return apiKanban<KanbanTask[]>("GET", "/api/kanban/tasks", undefined, params);
}

export async function getTask(
  taskId: string,
  profile?: string,
): Promise<KanbanResult<KanbanTaskDetail>> {
  return apiKanban<KanbanTaskDetail>("GET", `/api/kanban/tasks/${encodeURIComponent(taskId)}`, undefined, profileParams(profile));
}

export interface CreateTaskInput {
  title: string;
  body?: string;
  assignee?: string;
  priority?: number;
  tenant?: string;
  workspace?: string;
  triage?: boolean;
  skills?: string[];
  maxRetries?: number;
}

export async function createTask(
  input: CreateTaskInput,
  profile?: string,
): Promise<KanbanResult<{ id: string }>> {
  return apiKanban<{ id: string }>("POST", "/api/kanban/tasks", {
    title: input.title,
    body: input.body || "",
    assignee: input.assignee || "",
    priority: input.priority ?? 0,
    tenant: input.tenant || "",
    workspace: input.workspace || "",
    triage: input.triage ?? false,
    skills: input.skills || [],
    maxRetries: input.maxRetries ?? 3,
    profile: profile || "default",
  });
}

export async function assignTask(
  taskId: string,
  assignee: string | null,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("POST", `/api/kanban/tasks/${encodeURIComponent(taskId)}/assign`, {
    taskId,
    assignee: assignee || "",
    profile: profile || "default",
  });
}

export async function completeTask(
  taskId: string,
  result?: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("POST", `/api/kanban/tasks/${encodeURIComponent(taskId)}/complete`, {
    taskId,
    result: result || "",
    profile: profile || "default",
  });
}

export async function blockTask(
  taskId: string,
  reason?: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("POST", `/api/kanban/tasks/${encodeURIComponent(taskId)}/block`, {
    taskId,
    reason: reason || "",
    profile: profile || "default",
  });
}

export async function unblockTask(
  taskId: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("POST", `/api/kanban/tasks/${encodeURIComponent(taskId)}/unblock`, {
    taskId,
    profile: profile || "default",
  });
}

export async function archiveTask(
  taskId: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("POST", `/api/kanban/tasks/${encodeURIComponent(taskId)}/archive`, {
    taskId,
    profile: profile || "default",
  });
}

export async function specifyTask(
  taskId: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("POST", `/api/kanban/tasks/${encodeURIComponent(taskId)}/specify`, {
    taskId,
    profile: profile || "default",
  });
}

export async function reclaimTask(
  taskId: string,
  reason?: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("POST", `/api/kanban/tasks/${encodeURIComponent(taskId)}/reclaim`, {
    taskId,
    reason: reason || "",
    profile: profile || "default",
  });
}

export async function commentTask(
  taskId: string,
  body: string,
  profile?: string,
): Promise<KanbanResult<void>> {
  return apiKanban("POST", `/api/kanban/tasks/${encodeURIComponent(taskId)}/comment`, {
    taskId,
    body,
    profile: profile || "default",
  });
}

export async function dispatchOnce(
  dryRun = false,
  profile?: string,
): Promise<KanbanResult<unknown>> {
  return apiKanban("POST", "/api/kanban/dispatch", undefined, {
    ...profileParams(profile),
    dryRun: String(dryRun),
  });
}
