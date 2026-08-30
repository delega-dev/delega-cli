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
  since: string;
}

export interface FleetWorkingItem {
  id: string;
  content: string;
  claimedBy: string;
  detail: string;
  leaseExpiresAt: string;
  leaseRemainingSeconds: number | null;
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
  };
  quiet: boolean;
  waitingInput: FleetAttentionItem[];
  errored: Omit<FleetAttentionItem, "question" | "options">[];
  working: FleetWorkingItem[];
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

function leaseRemainingSeconds(task: FleetTask, now: Date): number | null {
  if (!task.lease_expires_at) return null;
  const expires = Date.parse(task.lease_expires_at);
  if (Number.isNaN(expires)) return null;
  return Math.round((expires - now.getTime()) / 1000);
}

// Derive the full fleet snapshot from one open-tasks listing. Pure so the
// test fixtures can exercise it without the API.
export function deriveFleetStatus(tasks: FleetTask[], now: Date): FleetStatus {
  const open = tasks.filter((t) => t.status !== "completed");
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

  return {
    generatedAt: now.toISOString(),
    counts: {
      open: open.length,
      unclaimed: open.length - claimed.length,
      claimed: claimed.length,
      working: working.length,
      waitingInput: waiting.length,
      errored: errored.length,
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
        since: t.updated_at ?? "",
      };
    }),
    errored: errored.map((t) => ({
      id: t.id,
      content: t.content,
      detail: (t.session_state_detail ?? "").trim(),
      claimedBy: claimedBy(t),
      since: t.updated_at ?? "",
    })),
    working: working.map((t) => ({
      id: t.id,
      content: t.content,
      claimedBy: claimedBy(t),
      detail: (t.session_state_detail ?? "").trim(),
      leaseExpiresAt: t.lease_expires_at ?? "",
      leaseRemainingSeconds: leaseRemainingSeconds(t, now),
    })),
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

const fleetStatus = new Command("status")
  .description("One-glance fleet snapshot: who is blocked on you, errored, or working")
  .option("--json", "Output raw JSON (for scripting and widgets)")
  .addHelpText("after", `
Examples:
  $ delega fleet status                   Summary plus any attention items
  $ delega fleet status --json            Snapshot as JSON
  $ delega fleet status --json | jq .quiet   true when nothing needs attention
`)
  .action(async (opts) => {
    const tasks = await apiCall<FleetTask[]>("GET", "/tasks");
    const status = deriveFleetStatus(Array.isArray(tasks) ? tasks : [], new Date());

    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    const c = status.counts;
    console.log(
      `${c.claimed} claimed · ${c.waitingInput} waiting on you · ` +
        `${c.errored} errored · ${c.working} working · ${c.unclaimed} unclaimed`,
    );

    if (status.quiet) {
      console.log("Fleet is quiet.");
      return;
    }

    const rows: string[][] = [
      ...status.waitingInput.map((item) => [
        "WAITING",
        formatId(item.id),
        item.claimedBy ? formatId(item.claimedBy) : "—",
        truncate(item.question || item.detail || item.content, 60),
      ]),
      ...status.errored.map((item) => [
        "ERRORED",
        formatId(item.id),
        item.claimedBy ? formatId(item.claimedBy) : "—",
        truncate(item.detail || item.content, 60),
      ]),
      ...status.working.map((item) => [
        "working",
        formatId(item.id),
        item.claimedBy ? formatId(item.claimedBy) : "—",
        truncate(item.content, 60),
      ]),
    ];
    printTable(["State", "Task", "Agent", "Detail"], rows);
  });

export const fleetCommand = new Command("fleet")
  .description("Fleet-level views across agents and tasks")
  .addCommand(fleetStatus);
