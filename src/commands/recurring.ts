import { Command } from "commander";
import { apiCall } from "../api.js";
import { pathSegment } from "../path.js";
import { formatDateTime, formatId, label, printTable, priorityBadge } from "../ui.js";

interface Recurrence {
  id: string;
  content: string;
  description?: string | null;
  project_id?: string | null;
  labels?: string[] | string;
  priority: number;
  assigned_to_agent_id?: string | null;
  rule_type: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  timezone: string;
  anchor_day?: number | null;
  anchor_month?: number | null;
  anchor_weekday?: number | null;
  next_due_at: string;
  last_spawned_at?: string | null;
  active: number | boolean;
  skip_if_open: number | boolean;
}

function parsePriority(value: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1 || n > 4) {
    throw new Error("Priority must be 1, 2, 3, or 4.");
  }
  return n;
}

function parsePositiveInt(value: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) {
    throw new Error("Must be a positive integer.");
  }
  return n;
}

function parseAnchorWeekday(value: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 0 || n > 6) {
    throw new Error("Weekday must be 0-6, where Sunday is 0.");
  }
  return n;
}

function parseLabels(raw: string[] | string | undefined | null): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return raw.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function boolLabel(value: boolean | number): string {
  return value ? "yes" : "no";
}

function recurrenceRule(r: Recurrence): string {
  const parts: string[] = [r.rule_type];
  if (r.interval !== 1) parts.push(`/${r.interval}`);
  if (r.anchor_month) parts.push(`month ${r.anchor_month}`);
  if (r.anchor_day) parts.push(`day ${r.anchor_day}`);
  if (r.anchor_weekday !== undefined && r.anchor_weekday !== null) parts.push(`weekday ${r.anchor_weekday}`);
  return parts.join(" ");
}

function recurrencePathSegment(id: string): string {
  return pathSegment(id);
}

function printRecurrence(r: Recurrence): void {
  label("ID", r.id);
  label("Content", r.content);
  if (r.description) label("Description", r.description);
  label("Priority", priorityBadge(r.priority));
  const labels = parseLabels(r.labels);
  if (labels.length) label("Labels", labels.join(", "));
  label("Rule", recurrenceRule(r));
  label("Timezone", r.timezone);
  label("Next Due", formatDateTime(r.next_due_at));
  if (r.last_spawned_at) label("Last Spawned", formatDateTime(r.last_spawned_at));
  label("Active", boolLabel(r.active));
  label("Skip If Open", boolLabel(r.skip_if_open));
  if (r.project_id) label("Project", r.project_id);
  if (r.assigned_to_agent_id) label("Assigned To", r.assigned_to_agent_id);
}

function buildBody(opts: Record<string, any>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.description !== undefined) body.description = opts.description;
  if (opts.project !== undefined) body.project_id = opts.project;
  if (opts.labels !== undefined) body.labels = opts.labels.split(",").map((l: string) => l.trim()).filter(Boolean);
  if (opts.priority !== undefined) body.priority = opts.priority;
  if (opts.assignedTo !== undefined) body.assigned_to_agent_id = opts.assignedTo || null;
  if (opts.interval !== undefined) body.interval = opts.interval;
  if (opts.timezone !== undefined) body.timezone = opts.timezone;
  if (opts.anchorDay !== undefined) body.anchor_day = opts.anchorDay;
  if (opts.anchorMonth !== undefined) body.anchor_month = opts.anchorMonth;
  if (opts.anchorWeekday !== undefined) body.anchor_weekday = opts.anchorWeekday;
  if (opts.nextDueAt !== undefined) body.next_due_at = opts.nextDueAt;
  if (opts.skipIfOpen !== undefined) body.skip_if_open = opts.skipIfOpen;
  if (opts.active !== undefined) body.active = opts.active;
  return body;
}

const recurringList = new Command("list")
  .description("List recurring task templates")
  .option("--json", "Output raw JSON")
  .action(async (opts) => {
    const recurrences = await apiCall<Recurrence[]>("GET", "/recurrences");
    if (opts.json) {
      console.log(JSON.stringify(recurrences, null, 2));
      return;
    }
    if (!recurrences.length) {
      console.log("No recurrences found.");
      return;
    }
    printTable(
      ["ID", "Active", "Rule", "Next Due", "Content"],
      recurrences.map((r) => [
        formatId(r.id),
        boolLabel(r.active),
        recurrenceRule(r),
        formatDateTime(r.next_due_at),
        r.content.length > 42 ? `${r.content.slice(0, 39)}...` : r.content,
      ]),
    );
  });

const recurringCreate = new Command("create")
  .description("Create a recurring task template")
  .argument("<content>", "Task content")
  .requiredOption("--rule <type>", "Rule type: daily, weekly, monthly, yearly")
  .option("--interval <n>", "Rule interval", parsePositiveInt, 1)
  .option("--timezone <tz>", "IANA timezone", "UTC")
  .option("--anchor-day <n>", "Day of month for monthly/yearly rules", parsePositiveInt)
  .option("--anchor-month <n>", "Month for yearly rules", parsePositiveInt)
  .option("--anchor-weekday <n>", "Weekday for weekly rules, Sunday=0", parseAnchorWeekday)
  .option("--next-due-at <iso>", "Optional ISO timestamp for first due occurrence")
  .option("--description <text>", "Task description")
  .option("--priority <n>", "Priority 1-4", parsePriority, 1)
  .option("--labels <labels>", "Comma-separated labels")
  .option("--project <id>", "Project ID")
  .option("--assigned-to <id>", "Agent ID to assign spawned tasks to")
  .option("--no-skip-if-open", "Always spawn even if a prior instance is still open")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega recurring create "Replace furnace filter" --rule monthly --anchor-day 1 --timezone America/Chicago
  $ delega recurring create "Schedule wellness visit" --rule yearly --anchor-month 8 --anchor-day 6 --timezone America/Chicago
`)
  .action(async (content: string, opts) => {
    const rule = String(opts.rule);
    if (!["daily", "weekly", "monthly", "yearly"].includes(rule)) {
      throw new Error("Rule must be one of: daily, weekly, monthly, yearly.");
    }
    const body = {
      content,
      rule_type: rule,
      ...buildBody(opts),
    };
    const recurrence = await apiCall<Recurrence>("POST", "/recurrences", body);
    if (opts.json) {
      console.log(JSON.stringify(recurrence, null, 2));
      return;
    }
    console.log("Recurring task created:");
    console.log();
    printRecurrence(recurrence);
  });

const recurringUpdate = new Command("update")
  .description("Update a recurring task template")
  .argument("<id>", "Recurrence ID")
  .option("--content <text>", "Task content")
  .option("--description <text>", "Task description")
  .option("--rule <type>", "Rule type: daily, weekly, monthly, yearly")
  .option("--interval <n>", "Rule interval", parsePositiveInt)
  .option("--timezone <tz>", "IANA timezone")
  .option("--anchor-day <n>", "Day of month for monthly/yearly rules", parsePositiveInt)
  .option("--anchor-month <n>", "Month for yearly rules", parsePositiveInt)
  .option("--anchor-weekday <n>", "Weekday for weekly rules, Sunday=0", parseAnchorWeekday)
  .option("--next-due-at <iso>", "ISO timestamp for next due occurrence")
  .option("--priority <n>", "Priority 1-4", parsePriority)
  .option("--labels <labels>", "Comma-separated labels")
  .option("--project <id>", "Project ID")
  .option("--assigned-to <id>", "Agent ID to assign spawned tasks to")
  .option("--active", "Resume recurrence")
  .option("--inactive", "Pause recurrence")
  .option("--skip-if-open", "Skip spawning if a prior instance is still open")
  .option("--allow-overlap", "Always spawn even if a prior instance is still open")
  .option("--json", "Output raw JSON")
  .action(async (id: string, opts) => {
    if (opts.rule && !["daily", "weekly", "monthly", "yearly"].includes(String(opts.rule))) {
      throw new Error("Rule must be one of: daily, weekly, monthly, yearly.");
    }
    const body = buildBody(opts);
    if (opts.content !== undefined) body.content = opts.content;
    if (opts.rule !== undefined) body.rule_type = opts.rule;
    if (opts.inactive) body.active = false;
    if (opts.active) body.active = true;
    if (opts.allowOverlap) body.skip_if_open = false;
    const recurrence = await apiCall<Recurrence>("PUT", `/recurrences/${recurrencePathSegment(id)}`, body);
    if (opts.json) {
      console.log(JSON.stringify(recurrence, null, 2));
      return;
    }
    console.log("Recurrence updated:");
    console.log();
    printRecurrence(recurrence);
  });

const recurringDelete = new Command("delete")
  .description("Delete a recurring task template")
  .argument("<id>", "Recurrence ID")
  .option("-y, --yes", "Skip confirmation")
  .option("--json", "Output raw JSON")
  .action(async (id: string, opts) => {
    if (!opts.yes) {
      console.error("Refusing to delete without --yes.");
      process.exit(1);
    }
    const result = await apiCall<Record<string, unknown>>("DELETE", `/recurrences/${recurrencePathSegment(id)}`);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Recurrence ${id} deleted.`);
  });

export const recurringCommand = new Command("recurring")
  .description("Manage recurring task templates")
  .addCommand(recurringList)
  .addCommand(recurringCreate)
  .addCommand(recurringUpdate)
  .addCommand(recurringDelete);
