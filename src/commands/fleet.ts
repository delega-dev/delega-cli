import { Command } from "commander";
import { apiCall } from "../api.js";
import { formatId, printTable } from "../ui.js";

// The subset of the task payload fleet status derives from. Kept local (like
// tasks.ts's Task) rather than shared: the derivation only depends on these
// fields, and a narrower type keeps the fixtures in test/fleet.test.mjs honest.
export interface FleetTask {
  id: string;
  content: string;
  status?: string;
  claimed_by_agent_id?: string | null;
  lease_expires_at?: string | null;
  session_state?: string | null;
  session_state_detail?: string | null;
  updated_at?: string;
  due_date?: string | null;
  superseded_at?: string | null;
}

export interface ParsedDetail {
  question: string;
  options: string[];
}

export interface FleetAttentionItem {
  id: string;
  content: string;
  question: string;
  options: string[];
  detail: string;
  claimedBy: string;
  claimedByName: string;
  since: string;
}

export interface FleetWorkingItem {
  id: string;
  content: string;
  claimedBy: string;
  claimedByName: string;
  detail: string;
  leaseExpiresAt: string;
  leaseRemainingSeconds: number | null;
}

export interface FleetDueItem {
  id: string;
  content: string;
  dueDate: string;
  daysOverdue: number;
  claimedBy: string;
  claimedByName: string;
}

export interface FleetStatus {
  generatedAt: string;
  counts: {
    open: number;
    unclaimed: number;
    claimed: number;
    working: number;
    waitingInput: number;
    errored: number;
    overdue: number;
    dueSoon: number;
  };
  quiet: boolean;
  waitingInput: FleetAttentionItem[];
  errored: Omit<FleetAttentionItem, "question" | "options">[];
  working: FleetWorkingItem[];
  overdue: FleetDueItem[];
  dueSoon: FleetDueItem[];
}

// Parse the "QUESTION: <one line> / OPTIONS: <a / b / …>" convention used in
// waiting_input state details. Best-effort: a detail that does not follow the
// convention yields an empty question and no options, and callers fall back to
// the raw detail string, which is always carried alongside.
export function parseStateDetail(detail: string | null | undefined): ParsedDetail {
  const text = (detail ?? "").trim();
  if (!text) return { question: "", options: [] };

  const match = /QUESTION:\s*(.*?)(?:\s*\/\s*OPTIONS:\s*(.*))?$/s.exec(text);
  if (!match || !match[1]) return { question: "", options: [] };

  const question = match[1].trim();
  const options = (match[2] ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return { question, options };
}

function claimedBy(task: FleetTask): string {
  return task.claimed_by_agent_id ?? "";
}

// Map agent ids to human labels. Names are decoration on this payload, so a
// missing or failed agents listing degrades to empty names, never an error.
export function agentNameMap(
  agents: Array<{ id?: string; name?: string; display_name?: string }> | null | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const agent of agents ?? []) {
    if (!agent || !agent.id) continue;
    const label = agent.display_name || agent.name || "";
    if (label) map[String(agent.id)] = String(label);
  }
  return map;
}

function leaseRemainingSeconds(task: FleetTask, now: Date): number | null {
  if (!task.lease_expires_at) return null;
  const expires = Date.parse(task.lease_expires_at);
  if (Number.isNaN(expires)) return null;
  return Math.round((expires - now.getTime()) / 1000);
}

// Whole days between a YYYY-MM-DD due date and `now`'s local date; positive
// means overdue, negative means still in the future. null for absent/bad dates.
export function daysOverdue(dueDate: string | null | undefined, now: Date): number | null {
  const raw = String(dueDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const due = new Date(raw + "T00:00:00");
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - due.getTime()) / 86400000);
}

// The list endpoint sorts by priority and returns one page (default 100 rows,
// at most 500) with completed tasks included unless told otherwise. A single
// unfiltered GET /tasks therefore only ever sees the top of the backlog, and
// once more than a page of tasks share the top priority every claim that sorts
// below it silently disappears from the snapshot. Fleet status must instead
// ask for open tasks only and walk every page.
export const FLEET_PAGE_SIZE = 500; // the API's maximum page size

// Hard ceiling on pages walked per snapshot so a misbehaving server that
// never returns a short page cannot turn one poll into an unbounded loop.
export const FLEET_MAX_PAGES = 40;

export type FleetFetcher = (path: string) => Promise<unknown>;

export function openTasksPath(offset: number, pageSize = FLEET_PAGE_SIZE): string {
  return `/tasks?completed=false&limit=${pageSize}&offset=${offset}`;
}

// Collect every open task by paging GET /tasks?completed=false until a short
// page. completed=false also drops superseded records server-side, which a
// client-side status check cannot see. Rows are de-duplicated by id because a
// task created or completed mid-walk shifts the offsets of the pages after it.
export async function fetchOpenTasks(
  fetcher: FleetFetcher,
  pageSize = FLEET_PAGE_SIZE,
): Promise<FleetTask[]> {
  const tasks: FleetTask[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < FLEET_MAX_PAGES; page++) {
    const data = await fetcher(openTasksPath(page * pageSize, pageSize));
    const rows = Array.isArray(data) ? (data as FleetTask[]) : [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      if (row.id) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      tasks.push(row);
    }
    if (rows.length < pageSize) break;
  }
  return tasks;
}

// Derive the full fleet snapshot from one open-tasks listing. Pure so the
// test fixtures can exercise it without the API.
export function deriveFleetStatus(
  tasks: FleetTask[],
  now: Date,
  names: Record<string, string> = {},
  dueSoonDays = 7,
): FleetStatus {
  // completed=false already excludes both server-side; the check here keeps
  // the derivation honest when handed an unfiltered listing.
  const open = tasks.filter((t) => t.status !== "completed" && !t.superseded_at);
  const claimed = open.filter((t) => t.claimed_by_agent_id);

  const byState = (state: string) =>
    claimed.filter((t) => t.session_state === state);

  const waiting = byState("waiting_input")
    .slice()
    .sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
  const errored = byState("errored")
    .slice()
    .sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
  const working = byState("working")
    .slice()
    .sort((a, b) =>
      (a.lease_expires_at ?? "9999").localeCompare(b.lease_expires_at ?? "9999"),
    );

  // Due-date views span ALL open tasks — a due backlog item is usually
  // unclaimed, which the claim-state lists never see.
  const dued = open
    .map((t) => ({ task: t, days: daysOverdue(t.due_date, now) }))
    .filter((entry): entry is { task: FleetTask; days: number } => entry.days !== null);
  const toDueItem = (entry: { task: FleetTask; days: number }): FleetDueItem => ({
    id: entry.task.id,
    content: entry.task.content,
    dueDate: String(entry.task.due_date).slice(0, 10),
    daysOverdue: entry.days,
    claimedBy: claimedBy(entry.task),
    claimedByName: names[claimedBy(entry.task)] ?? "",
  });
  const overdue = dued
    .filter((entry) => entry.days > 0)
    .sort((a, b) => b.days - a.days)
    .map(toDueItem);
  const dueSoon = dued
    .filter((entry) => entry.days <= 0 && -entry.days <= dueSoonDays)
    .sort((a, b) => b.days - a.days)
    .map(toDueItem);

  return {
    generatedAt: now.toISOString(),
    counts: {
      open: open.length,
      unclaimed: open.length - claimed.length,
      claimed: claimed.length,
      working: working.length,
      waitingInput: waiting.length,
      errored: errored.length,
      overdue: overdue.length,
      dueSoon: dueSoon.length,
    },
    quiet: working.length + waiting.length + errored.length === 0,
    waitingInput: waiting.map((t) => {
      const parsed = parseStateDetail(t.session_state_detail);
      return {
        id: t.id,
        content: t.content,
        question: parsed.question,
        options: parsed.options,
        detail: (t.session_state_detail ?? "").trim(),
        claimedBy: claimedBy(t),
        claimedByName: names[claimedBy(t)] ?? "",
        since: t.updated_at ?? "",
      };
    }),
    errored: errored.map((t) => ({
      id: t.id,
      content: t.content,
      detail: (t.session_state_detail ?? "").trim(),
      claimedBy: claimedBy(t),
      claimedByName: names[claimedBy(t)] ?? "",
      since: t.updated_at ?? "",
    })),
    working: working.map((t) => ({
      id: t.id,
      content: t.content,
      claimedBy: claimedBy(t),
      claimedByName: names[claimedBy(t)] ?? "",
      detail: (t.session_state_detail ?? "").trim(),
      leaseExpiresAt: t.lease_expires_at ?? "",
      leaseRemainingSeconds: leaseRemainingSeconds(t, now),
    })),
    overdue,
    dueSoon,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

const fleetStatus = new Command("status")
  .description("One-glance fleet snapshot: who is blocked on you, errored, or working")
  .option("--json", "Output raw JSON (for scripting and widgets)")
  .option("--due-soon-days <n>", "Window for the dueSoon list in days", "7")
  .addHelpText("after", `
Examples:
  $ delega fleet status                   Summary plus any attention items
  $ delega fleet status --json            Snapshot as JSON
  $ delega fleet status --json | jq .quiet   true when nothing needs attention
`)
  .action(async (opts) => {
    const [tasks, agents] = await Promise.all([
      fetchOpenTasks((path) => apiCall<FleetTask[]>("GET", path)),
      apiCall<Array<{ id?: string; name?: string; display_name?: string }>>("GET", "/agents")
        .catch(() => []),
    ]);
    const window = Number.parseInt(String(opts.dueSoonDays ?? "7"), 10);
    const status = deriveFleetStatus(
      Array.isArray(tasks) ? tasks : [],
      new Date(),
      agentNameMap(Array.isArray(agents) ? agents : []),
      Number.isFinite(window) && window > 0 ? window : 7,
    );

    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    const c = status.counts;
    console.log(
      `${c.claimed} claimed · ${c.waitingInput} waiting on you · ` +
        `${c.errored} errored · ${c.working} working · ` +
        `${c.overdue} overdue · ${c.dueSoon} due soon · ${c.unclaimed} unclaimed`,
    );

    if (status.quiet && status.overdue.length === 0) {
      console.log("Fleet is quiet.");
      return;
    }

    const rows: string[][] = [
      ...status.overdue.map((item) => [
        "OVERDUE",
        formatId(item.id),
        item.claimedByName || (item.claimedBy ? formatId(item.claimedBy) : "—"),
        truncate(`${item.daysOverdue}d overdue: ${item.content}`, 60),
      ]),
      ...status.waitingInput.map((item) => [
        "WAITING",
        formatId(item.id),
        item.claimedByName || (item.claimedBy ? formatId(item.claimedBy) : "—"),
        truncate(item.question || item.detail || item.content, 60),
      ]),
      ...status.errored.map((item) => [
        "ERRORED",
        formatId(item.id),
        item.claimedByName || (item.claimedBy ? formatId(item.claimedBy) : "—"),
        truncate(item.detail || item.content, 60),
      ]),
      ...status.working.map((item) => [
        "working",
        formatId(item.id),
        item.claimedByName || (item.claimedBy ? formatId(item.claimedBy) : "—"),
        truncate(item.content, 60),
      ]),
    ];
    printTable(["State", "Task", "Agent", "Detail"], rows);
  });

export const fleetCommand = new Command("fleet")
  .description("Fleet-level views across agents and tasks")
  .addCommand(fleetStatus);
