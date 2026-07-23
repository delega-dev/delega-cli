import node_child_process from "node:child_process";
import node_fs from "node:fs";
import node_path from "node:path";
import { Command } from "commander";
import { apiCall, apiRequest } from "../api.js";
import { pathSegment } from "../path.js";
import { printTable } from "../ui.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface SyncConfig {
  project_id: string | null;
  repo: string | null;
  version: 1;
}

interface ApiTask {
  id: string;
  content: string;
  description?: string | null;
  project_id?: string | null;
  due_date?: string | null;
  priority?: number;
  labels?: string[] | string | null;
  completed?: number | boolean;
  status?: string;
  assigned_to_agent_id?: string | null;
  claimed_by_agent_id?: string | null;
  session_state?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface TaskContextResponse {
  context: Record<string, unknown>;
  version: number;
}

interface TaskLink {
  kind: "branch" | "commit" | "pr" | "url";
  repo: string | null;
  ref: string;
  url?: string | null;
}

export interface TaskSyncRecord {
  id?: string;
  content: string;
  description?: string | null;
  project_id?: string | null;
  due_date?: string | null;
  priority?: number;
  labels?: string[];
  completed?: boolean;
  status?: string;
  assigned_to_agent_id?: string | null;
  claimed_by_agent_id?: string | null;
  session_state?: string | null;
  context_version?: number;
  context?: Record<string, unknown>;
  links?: TaskLink[];
  created_at?: string;
  updated_at?: string;
}

interface SyncStatus {
  local_only: string[];
  remote_only: string[];
  changed: string[];
  clean: string[];
}

const SYNC_DIR = ".delega";
const SYNC_CONFIG = "config.json";
const TASKS_FILE = "tasks.jsonl";

// Server task ids are 32 lowercase hex chars. Locally authored records may have
// no id yet (created on push), but any id that *is* present must match.
const TASK_ID_RE = /^[a-f0-9]{32}$/;

export function taskPathSegment(id: string | number): string {
  return pathSegment(id);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function parseTasksJsonl(raw: string): TaskSyncRecord[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "invalid JSON";
        throw new Error(`Line ${index + 1} is invalid JSON in .delega/tasks.jsonl: ${detail}`);
      }
      if (!isPlainObject(parsed)) {
        throw new Error(`Line ${index + 1} must be a JSON object`);
      }
      if (typeof parsed.content !== "string" || !parsed.content.trim()) {
        throw new Error(`Line ${index + 1} must include content`);
      }
      if (parsed.id !== undefined && parsed.id !== null) {
        if (typeof parsed.id !== "string" || !TASK_ID_RE.test(parsed.id)) {
          throw new Error(`Line ${index + 1} has an invalid task id in .delega/tasks.jsonl`);
        }
      }
      return parsed as unknown as TaskSyncRecord;
    });
}

export function serializeTasksJsonl(records: TaskSyncRecord[]): string {
  return records
    .map(normalizeRecordForFile)
    .sort(compareRecords)
    .map((record) => stableStringify(record))
    .join("\n") + "\n";
}

export function diffSyncRecords(local: TaskSyncRecord[], remote: TaskSyncRecord[]): SyncStatus {
  const localById = new Map(local.filter((record) => record.id).map((record) => [record.id!, normalizeRecordForFile(record)]));
  const remoteById = new Map(remote.filter((record) => record.id).map((record) => [record.id!, normalizeRecordForFile(record)]));
  const localOnly: string[] = [];
  const remoteOnly: string[] = [];
  const changed: string[] = [];
  const clean: string[] = [];

  for (const [id, record] of localById) {
    const remoteRecord = remoteById.get(id);
    if (!remoteRecord) {
      localOnly.push(id);
    } else if (stableStringify(record) !== stableStringify(remoteRecord)) {
      changed.push(id);
    } else {
      clean.push(id);
    }
  }
  for (const id of remoteById.keys()) {
    if (!localById.has(id)) remoteOnly.push(id);
  }

  return {
    local_only: localOnly.sort(),
    remote_only: remoteOnly.sort(),
    changed: changed.sort(),
    clean: clean.sort(),
  };
}

function compareRecords(a: TaskSyncRecord, b: TaskSyncRecord): number {
  return (a.id ?? a.content).localeCompare(b.id ?? b.content);
}

function normalizeLabels(labels: ApiTask["labels"]): string[] {
  if (Array.isArray(labels)) return labels.map(String).sort();
  if (typeof labels === "string" && labels.trim()) {
    try {
      const parsed = JSON.parse(labels) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).sort();
    } catch {
      return labels.split(",").map((label) => label.trim()).filter(Boolean).sort();
    }
  }
  return [];
}

function normalizeLinks(links: TaskLink[] | undefined): TaskLink[] {
  return [...(links ?? [])]
    .map((link) => ({
      kind: link.kind,
      repo: link.repo ?? null,
      ref: link.ref,
      url: link.url ?? null,
    }))
    .sort((a, b) => `${a.kind}:${a.repo ?? ""}:${a.ref}`.localeCompare(`${b.kind}:${b.repo ?? ""}:${b.ref}`));
}

function normalizeRecordForFile(record: TaskSyncRecord): TaskSyncRecord {
  return {
    id: record.id,
    content: record.content,
    description: record.description ?? null,
    project_id: record.project_id ?? null,
    due_date: record.due_date ?? null,
    priority: record.priority ?? 1,
    labels: [...(record.labels ?? [])].map(String).sort(),
    completed: Boolean(record.completed),
    status: record.status ?? (record.completed ? "completed" : "open"),
    assigned_to_agent_id: record.assigned_to_agent_id ?? null,
    claimed_by_agent_id: record.claimed_by_agent_id ?? null,
    session_state: record.session_state ?? null,
    context_version: record.context_version ?? 0,
    context: isPlainObject(record.context) ? record.context : {},
    links: normalizeLinks(record.links),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function taskToSyncRecord(task: ApiTask, context: TaskContextResponse, links: TaskLink[]): TaskSyncRecord {
  return normalizeRecordForFile({
    id: task.id,
    content: task.content,
    description: task.description ?? null,
    project_id: task.project_id ?? null,
    due_date: task.due_date ?? null,
    priority: task.priority ?? 1,
    labels: normalizeLabels(task.labels),
    completed: Boolean(task.completed),
    status: task.status ?? (task.completed ? "completed" : "open"),
    assigned_to_agent_id: task.assigned_to_agent_id ?? null,
    claimed_by_agent_id: task.claimed_by_agent_id ?? null,
    session_state: task.session_state ?? null,
    context_version: context.version,
    context: context.context,
    links,
    created_at: task.created_at,
    updated_at: task.updated_at,
  });
}

function runGit(args: string[], cwd: string): string | null {
  try {
    return node_child_process.execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function findRepoRoot(cwd = process.cwd()): string {
  return runGit(["rev-parse", "--show-toplevel"], cwd) || cwd;
}

function syncDir(repoRoot: string): string {
  return node_path.join(repoRoot, SYNC_DIR);
}

function syncConfigPath(repoRoot: string): string {
  return node_path.join(syncDir(repoRoot), SYNC_CONFIG);
}

function tasksFilePath(repoRoot: string): string {
  return node_path.join(syncDir(repoRoot), TASKS_FILE);
}

function inferRepoSlug(repoRoot: string): string | null {
  const remote = runGit(["config", "--get", "remote.origin.url"], repoRoot);
  if (!remote) return null;
  const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  return match?.[1] ?? null;
}

function readSyncConfig(repoRoot: string): SyncConfig {
  const configPath = syncConfigPath(repoRoot);
  if (!node_fs.existsSync(configPath)) {
    throw new Error("No .delega/config.json found. Run: delega sync init");
  }
  const parsed = JSON.parse(node_fs.readFileSync(configPath, "utf-8")) as Partial<SyncConfig>;
  return {
    project_id: parsed.project_id ?? null,
    repo: parsed.repo ?? null,
    version: 1,
  };
}

function writeSyncConfig(repoRoot: string, config: SyncConfig): void {
  node_fs.mkdirSync(syncDir(repoRoot), { recursive: true });
  node_fs.writeFileSync(syncConfigPath(repoRoot), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function readLocalTasks(repoRoot: string): TaskSyncRecord[] {
  const filePath = tasksFilePath(repoRoot);
  if (!node_fs.existsSync(filePath)) return [];
  return parseTasksJsonl(node_fs.readFileSync(filePath, "utf-8"));
}

function writeLocalTasks(repoRoot: string, records: TaskSyncRecord[]): void {
  node_fs.mkdirSync(syncDir(repoRoot), { recursive: true });
  node_fs.writeFileSync(tasksFilePath(repoRoot), serializeTasksJsonl(records), "utf-8");
}

async function fetchRemoteTasks(config: SyncConfig): Promise<TaskSyncRecord[]> {
  const params = new URLSearchParams();
  if (config.project_id) params.set("project_id", config.project_id);
  params.set("limit", "500");
  const taskPath = params.toString() ? `/tasks?${params.toString()}` : "/tasks";
  const tasks = await apiCall<ApiTask[]>("GET", taskPath);
  const records: TaskSyncRecord[] = [];
  for (const task of tasks) {
    const [context, links] = await Promise.all([
      apiCall<TaskContextResponse>("GET", `/tasks/${taskPathSegment(task.id)}/context`),
      apiCall<TaskLink[]>("GET", `/tasks/${taskPathSegment(task.id)}/links`),
    ]);
    records.push(taskToSyncRecord(task, context, links));
  }
  return records.sort(compareRecords);
}

function writableTaskBody(record: TaskSyncRecord): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content: record.content,
    description: record.description ?? null,
    priority: record.priority ?? 1,
    labels: record.labels ?? [],
    due_date: record.due_date ?? null,
  };
  if (record.project_id) body.project_id = record.project_id;
  if (record.assigned_to_agent_id !== undefined) body.assigned_to_agent_id = record.assigned_to_agent_id;
  return body;
}

function contextChanged(local: TaskSyncRecord, remoteContext: TaskContextResponse): boolean {
  return stableStringify(local.context ?? {}) !== stableStringify(remoteContext.context ?? {});
}

function hasContext(record: TaskSyncRecord): boolean {
  return Object.keys(record.context ?? {}).length > 0;
}

async function createTaskFromRecord(record: TaskSyncRecord): Promise<ApiTask> {
  const task = await apiCall<ApiTask>("POST", "/tasks", writableTaskBody(record));
  if (hasContext(record)) {
    await apiCall<TaskContextResponse>("PATCH", `/tasks/${taskPathSegment(task.id)}/context?expected_version=0`, record.context ?? {});
  }
  return task;
}

async function updateExistingRecord(record: TaskSyncRecord): Promise<{ conflict?: { id: string; local: TaskSyncRecord; hosted: TaskContextResponse } }> {
  if (!record.id) throw new Error("Cannot update a task without an id");
  const encodedTaskId = taskPathSegment(record.id);
  const hostedContext = await apiCall<TaskContextResponse>("GET", `/tasks/${encodedTaskId}/context`);
  const expectedVersion = record.context_version ?? 0;
  if (hostedContext.version !== expectedVersion) {
    return { conflict: { id: record.id, local: record, hosted: hostedContext } };
  }

  await apiCall<ApiTask>("PUT", `/tasks/${encodedTaskId}`, writableTaskBody(record));
  if (contextChanged(record, hostedContext)) {
    const result = await apiRequest<TaskContextResponse>(
      "PATCH",
      `/tasks/${encodedTaskId}/context?expected_version=${expectedVersion}`,
      record.context ?? {},
    );
    if (!result.ok && result.status === 409) {
      return { conflict: { id: record.id, local: record, hosted: result.data as TaskContextResponse } };
    }
    if (!result.ok) {
      const data = result.data as { error?: string; message?: string };
      throw new Error(data.error || data.message || `Failed to update context for ${record.id}`);
    }
  }
  return {};
}

function currentGitLinks(repoRoot: string, repo: string | null): TaskLink[] {
  const links: TaskLink[] = [];
  const branch = runGit(["branch", "--show-current"], repoRoot);
  const head = runGit(["rev-parse", "HEAD"], repoRoot);
  if (branch) links.push({ kind: "branch", repo, ref: branch, url: repo ? `https://github.com/${repo}/tree/${encodeURIComponent(branch)}` : null });
  if (head) links.push({ kind: "commit", repo, ref: head, url: repo ? `https://github.com/${repo}/commit/${head}` : null });
  return links;
}

async function attachLinks(taskId: string, links: TaskLink[]): Promise<number> {
  let created = 0;
  const encodedTaskId = taskPathSegment(taskId);
  for (const link of links) {
    const result = await apiRequest("POST", `/tasks/${encodedTaskId}/links`, link);
    if (!result.ok) {
      const data = result.data as { error?: string; message?: string };
      throw new Error(data.error || data.message || `Failed to link task ${taskId}`);
    }
    if (result.status === 201) created += 1;
  }
  return created;
}

const syncInit = new Command("init")
  .description("Initialize Delega sync metadata in this git repo")
  .option("--project <id>", "Map this repo to a Delega project")
  .option("--repo <owner/name>", "Repository slug for link filtering")
  .option("--json", "Output raw JSON")
  .action((opts: { project?: string; repo?: string; json?: boolean }) => {
    const repoRoot = findRepoRoot();
    const config: SyncConfig = {
      project_id: opts.project ?? null,
      repo: opts.repo ?? inferRepoSlug(repoRoot),
      version: 1,
    };
    writeSyncConfig(repoRoot, config);
    if (!node_fs.existsSync(tasksFilePath(repoRoot))) {
      writeLocalTasks(repoRoot, []);
    }
    const result = { config_path: syncConfigPath(repoRoot), tasks_path: tasksFilePath(repoRoot), ...config };
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log("Initialized Delega sync.");
    console.log(`Config: ${result.config_path}`);
    console.log(`Tasks:  ${result.tasks_path}`);
    if (config.repo) console.log(`Repo:   ${config.repo}`);
    if (config.project_id) console.log(`Project: ${config.project_id}`);
  });

const syncPull = new Command("pull")
  .description("Write hosted tasks to .delega/tasks.jsonl")
  .option("--json", "Output raw JSON")
  .action(async (opts: { json?: boolean }) => {
    const repoRoot = findRepoRoot();
    const config = readSyncConfig(repoRoot);
    const records = await fetchRemoteTasks(config);
    writeLocalTasks(repoRoot, records);
    const result = { pulled: records.length, tasks_path: tasksFilePath(repoRoot) };
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Pulled ${records.length} task${records.length === 1 ? "" : "s"} into .delega/tasks.jsonl.`);
  });

const syncStatus = new Command("status")
  .description("Show drift between .delega/tasks.jsonl and hosted tasks")
  .option("--json", "Output raw JSON")
  .action(async (opts: { json?: boolean }) => {
    const repoRoot = findRepoRoot();
    const config = readSyncConfig(repoRoot);
    const [local, remote] = await Promise.all([Promise.resolve(readLocalTasks(repoRoot)), fetchRemoteTasks(config)]);
    const status = diffSyncRecords(local, remote);
    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    printTable(["Bucket", "Count"], [
      ["local_only", String(status.local_only.length)],
      ["remote_only", String(status.remote_only.length)],
      ["changed", String(status.changed.length)],
      ["clean", String(status.clean.length)],
    ]);
  });

const syncPush = new Command("push")
  .description("Push local .delega/tasks.jsonl edits to hosted Delega")
  .option("--no-auto-link", "Do not attach current git branch/HEAD to touched tasks")
  .option("--json", "Output raw JSON")
  .action(async (opts: { autoLink?: boolean; json?: boolean }) => {
    const repoRoot = findRepoRoot();
    const config = readSyncConfig(repoRoot);
    const localRecords = readLocalTasks(repoRoot);
    const autoLinks = opts.autoLink === false ? [] : currentGitLinks(repoRoot, config.repo);
    const conflicts: Array<{ id: string; local_version: number; hosted_version: number; hosted_context: Record<string, unknown> }> = [];
    let created = 0;
    let updated = 0;
    let linked = 0;

    for (const record of localRecords) {
      const normalized = normalizeRecordForFile(record);
      let taskId = normalized.id;
      if (!taskId) {
        const createdTask = await createTaskFromRecord(normalized);
        taskId = createdTask.id;
        normalized.id = taskId;
        created += 1;
      } else {
        const result = await updateExistingRecord(normalized);
        if (result.conflict) {
          conflicts.push({
            id: result.conflict.id,
            local_version: normalized.context_version ?? 0,
            hosted_version: result.conflict.hosted.version,
            hosted_context: result.conflict.hosted.context,
          });
          continue;
        }
        updated += 1;
      }

      const links = [...normalizeLinks(normalized.links), ...autoLinks];
      if (taskId && links.length) {
        linked += await attachLinks(taskId, links);
      }
    }

    if (conflicts.length) {
      const result = { ok: false, created, updated, linked, conflicts };
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }

    const refreshed = await fetchRemoteTasks(config);
    writeLocalTasks(repoRoot, refreshed);
    const result = { ok: true, created, updated, linked };
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Pushed ${created + updated} task${created + updated === 1 ? "" : "s"} (${created} created, ${updated} updated).`);
    if (linked) console.log(`Attached ${linked} git link${linked === 1 ? "" : "s"}.`);
  });

export const syncCommand = new Command("sync")
  .description("Mirror Delega tasks into this repo as deterministic JSONL")
  .addCommand(syncInit)
  .addCommand(syncPull)
  .addCommand(syncPush)
  .addCommand(syncStatus);
