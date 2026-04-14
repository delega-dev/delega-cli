import { Command } from "commander";
import { apiCall } from "../api.js";
import {
  printTable,
  formatDate,
  formatId,
  priorityBadge,
  statusBadge,
  label,
  confirm,
} from "../ui.js";

interface Task {
  id: string;
  content: string;
  status: string;
  priority: number;
  labels?: string[] | string;
  due_date?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  assigned_to_agent_id?: string;
  delegated_from_task_id?: string;
  parent_task_id?: string;
  subtasks?: Task[];
  comments?: Comment[];
}

interface Comment {
  id: string;
  content: string;
  created_at?: string;
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

const tasksList = new Command("list")
  .description("List tasks")
  .option("--completed", "Include completed tasks")
  .option("--limit <n>", "Limit results", parsePositiveInt)
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega tasks list                     List pending tasks
  $ delega tasks list --completed         Include completed tasks
  $ delega tasks list --limit 5           Show only 5 tasks
  $ delega tasks list --json              Output as JSON (for scripting)
  $ delega tasks list --json | jq '.[0]'  Get first task with jq
`)
  .action(async (opts) => {
    let path = "/tasks";
    const params: string[] = [];
    if (opts.completed) params.push("completed=true");
    if (opts.limit) params.push(`limit=${opts.limit}`);
    if (params.length > 0) path += "?" + params.join("&");

    const data = await apiCall<Task[]>("GET", path);

    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const tasks = Array.isArray(data) ? data : [];

    if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }

    const headers = ["ID", "Pri", "Status", "Delegated To", "Content"];
    const rows = tasks.map((t) => [
      formatId(t.id),
      priorityBadge(t.priority),
      statusBadge(t.status),
      t.assigned_to_agent_id ? formatId(t.assigned_to_agent_id) : "—",
      t.content.length > 40 ? t.content.slice(0, 37) + "..." : t.content,
    ]);

    printTable(headers, rows);
  });

const tasksCreate = new Command("create")
  .description("Create a new task")
  .argument("<content>", "Task content")
  .option("--priority <n>", "Priority 1-4 (default: 1)", parsePriority, 1)
  .option("--labels <labels>", "Comma-separated labels")
  .option("--due <date>", "Due date (YYYY-MM-DD)")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega tasks create "Fix login bug"
  $ delega tasks create "Deploy v2" --priority 1
  $ delega tasks create "Write tests" --labels "testing,backend"
  $ delega tasks create "Ship feature" --due 2025-12-31
  $ delega tasks create "Audit deps" --json          Get created task as JSON
`)
  .action(async (content: string, opts) => {
    const body: Record<string, unknown> = { content };
    if (opts.priority) body.priority = opts.priority;
    if (opts.labels) body.labels = opts.labels.split(",").map((l: string) => l.trim());
    if (opts.due) body.due_date = opts.due;

    const task = await apiCall<Task>("POST", "/tasks", body);

    if (opts.json) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }

    console.log(`Task created: ${task.id}`);
    console.log();
    label("Content", task.content);
    label("Priority", priorityBadge(task.priority));
    label("Status", statusBadge(task.status));
    if (task.due_date) label("Due", formatDate(task.due_date));
  });

const tasksShow = new Command("show")
  .description("Show task details")
  .argument("<id>", "Task ID")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega tasks show abc123
  $ delega tasks show abc123 --json       Get full task details as JSON
`)
  .action(async (id: string, opts) => {
    const task = await apiCall<Task>("GET", `/tasks/${id}`);

    if (opts.json) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }

    console.log();
    label("ID", task.id);
    label("Content", task.content);
    label("Status", statusBadge(task.status));
    label("Priority", priorityBadge(task.priority));
    let labels = task.labels;
    if (typeof labels === "string") {
      try {
        labels = JSON.parse(labels) as string[] | string;
      } catch {
        // Keep malformed labels as the raw string instead of crashing.
      }
    }
    if (Array.isArray(labels) && labels.length > 0) {
      label("Labels", labels.join(", "));
    } else if (typeof labels === "string" && labels) {
      label("Labels", labels);
    }
    if (task.due_date) label("Due", formatDate(task.due_date));
    if (task.assigned_to_agent_id) label("Delegated To", task.assigned_to_agent_id);
    if (task.delegated_from_task_id) label("Delegated From", task.delegated_from_task_id);
    if (task.parent_task_id) label("Parent Task", task.parent_task_id);
    label("Created", formatDate(task.created_at || ""));
    if (task.updated_at) label("Updated", formatDate(task.updated_at));
    if (task.completed_at) label("Completed", formatDate(task.completed_at));

    if (task.comments && task.comments.length > 0) {
      console.log();
      console.log("Comments:");
      for (const c of task.comments) {
        console.log(`  [${formatDate(c.created_at || "")}] ${c.content}`);
      }
    }
    console.log();
  });

const tasksComplete = new Command("complete")
  .description("Mark a task as completed")
  .argument("<id>", "Task ID")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega tasks complete abc123
  $ delega tasks complete abc123 --json   Get completed task as JSON
`)
  .action(async (id: string, opts) => {
    const task = await apiCall<Task>("POST", `/tasks/${id}/complete`);
    if (opts.json) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }
    console.log(`Task ${id} completed.`);
  });

const tasksDelete = new Command("delete")
  .description("Delete a task")
  .argument("<id>", "Task ID")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output raw JSON")
  .option("--dry-run", "Show what would be deleted without doing it")
  .addHelpText("after", `
Examples:
  $ delega tasks delete abc123
  $ delega tasks delete abc123 --yes      Skip confirmation (for scripts/agents)
  $ delega tasks delete abc123 --json     Output result as JSON
  $ delega tasks delete abc123 --dry-run  Preview without deleting
`)
  .action(async (id: string, opts) => {
    if (opts.dryRun) {
      const task = await apiCall<Task>("GET", `/tasks/${id}`);
      if (opts.json) {
        console.log(JSON.stringify({ dry_run: true, would_delete: task }, null, 2));
        return;
      }
      console.log(`Would delete task ${id}: ${task.content}`);
      return;
    }
    if (!opts.yes) {
      const ok = await confirm(`Delete task ${id}? (y/N) `);
      if (!ok) {
        console.log("Cancelled.");
        return;
      }
    }
    await apiCall("DELETE", `/tasks/${id}`);
    if (opts.json) {
      console.log(JSON.stringify({ id, deleted: true }, null, 2));
      return;
    }
    console.log(`Task ${id} deleted.`);
  });

const tasksDelegate = new Command("delegate")
  .description("Delegate a task to another agent")
  .argument("<task_id>", "Task ID")
  .argument("<agent_id>", "Agent ID to delegate to")
  .requiredOption("--content <content>", "Subtask description (required)")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega tasks delegate abc123 agent456 --content "Handle the frontend"
  $ delega tasks delegate abc123 agent456 --content "Run tests" --json
`)
  .action(async (taskId: string, agentId: string, opts) => {
    const body: Record<string, unknown> = { assigned_to_agent_id: agentId };
    if (opts.content) body.content = opts.content;

    const subtask = await apiCall<Task>("POST", `/tasks/${taskId}/delegate`, body);
    if (opts.json) {
      console.log(JSON.stringify(subtask, null, 2));
      return;
    }
    console.log(`Task delegated to ${agentId}.`);
  });

// ── 1.2.0 multi-agent coordination commands ──

const tasksAssign = new Command("assign")
  .description("Assign a task to an agent (or --unassign to clear)")
  .argument("<task_id>", "Task ID")
  .argument("[agent_id]", "Agent ID to assign to (omit with --unassign)")
  .option("--unassign", "Clear the assignment (pass instead of an agent_id)")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega tasks assign abc123 agent456
  $ delega tasks assign abc123 --unassign
  $ delega tasks assign abc123 agent456 --json

For multi-agent handoffs where you want the parent/child chain recorded,
use \`delega tasks delegate\` instead — assign does not record a chain.
`)
  .action(async (taskId: string, agentId: string | undefined, opts) => {
    if (opts.unassign && agentId) {
      console.error("Error: pass either --unassign or an <agent_id>, not both.");
      process.exit(1);
    }
    if (!opts.unassign && !agentId) {
      console.error("Error: must supply either <agent_id> or --unassign.");
      process.exit(1);
    }
    const body = { assigned_to_agent_id: opts.unassign ? null : agentId };
    const task = await apiCall<Task>("PUT", `/tasks/${taskId}`, body);
    if (opts.json) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }
    console.log(
      opts.unassign
        ? `Task ${taskId} unassigned.`
        : `Task ${taskId} assigned to ${agentId}.`,
    );
  });

interface ChainResponse {
  root_id?: string | number;
  root?: { id: string | number; content?: string };
  chain: Array<{
    id: string | number;
    content: string;
    delegation_depth?: number;
    status?: string;
    completed?: boolean;
  }>;
  depth: number;
  completed_count: number;
  total_count: number;
}

const tasksChain = new Command("chain")
  .description("Show the full parent/child delegation chain for a task")
  .argument("<task_id>", "Any task ID in the chain")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega tasks chain abc123
  $ delega tasks chain abc123 --json
`)
  .action(async (taskId: string, opts) => {
    const resp = await apiCall<ChainResponse>("GET", `/tasks/${taskId}/chain`);
    if (opts.json) {
      console.log(JSON.stringify(resp, null, 2));
      return;
    }
    // Normalize: hosted returns {root_id}, self-hosted returns {root: {...}}.
    const rootId =
      resp.root_id !== undefined
        ? resp.root_id
        : resp.root && resp.root.id !== undefined
          ? resp.root.id
          : "";
    console.log(
      `\nDelegation chain (root #${rootId}, depth ${resp.depth}, ` +
        `${resp.completed_count}/${resp.total_count} complete):`,
    );
    const sorted = [...(resp.chain || [])].sort((a, b) => {
      const da = typeof a.delegation_depth === "number" ? a.delegation_depth : 0;
      const db = typeof b.delegation_depth === "number" ? b.delegation_depth : 0;
      return da - db;
    });
    for (const node of sorted) {
      const d =
        typeof node.delegation_depth === "number" ? node.delegation_depth : 0;
      const indent = "  ".repeat(1 + d);
      const status = node.status || (node.completed ? "completed" : "pending");
      console.log(`${indent}[#${node.id}] ${node.content} (depth ${d}, ${status})`);
    }
    if (!sorted.length) {
      console.log("  (empty chain)");
    }
    console.log();
  });

function parseContextInput(kvPairs: string[] | undefined, rawJson: string | undefined): Record<string, unknown> {
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("--context must be a JSON object");
      }
      return parsed as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `--context must be valid JSON object: ${(e as Error).message}`,
      );
    }
  }
  const out: Record<string, unknown> = {};
  for (const pair of kvPairs || []) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new Error(`--kv entries must be key=value, got: ${pair}`);
    }
    const key = pair.slice(0, eq);
    const rawValue = pair.slice(eq + 1);
    // Try to parse as JSON (so numbers, bools, arrays work) — fall back to string.
    let value: unknown = rawValue;
    try {
      value = JSON.parse(rawValue);
    } catch {
      value = rawValue;
    }
    out[key] = value;
  }
  return out;
}

const tasksSetContext = new Command("set-context")
  .description("Merge keys into a task's persistent context blob")
  .argument("<task_id>", "Task ID")
  .option("--kv <pair...>", "Key=value pair to merge (repeatable)")
  .option("--context <json>", "Full context as a JSON object")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega tasks set-context abc123 --kv step=research_done --kv count=3
  $ delega tasks set-context abc123 --context '{"findings":["price=$20/mo"]}'

Keys are deep-merged into existing context (not replaced).
`)
  .action(async (taskId: string, opts) => {
    let body: Record<string, unknown>;
    try {
      body = parseContextInput(opts.kv, opts.context);
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
    if (Object.keys(body).length === 0) {
      console.error(
        "Error: supply at least one --kv pair or a --context JSON object.",
      );
      process.exit(1);
    }
    const resp = await apiCall<unknown>("PATCH", `/tasks/${taskId}/context`, body);
    if (opts.json) {
      console.log(JSON.stringify(resp, null, 2));
      return;
    }
    console.log(`Context updated for task ${taskId}.`);
    // Normalize display: hosted returns bare context dict, self-hosted returns full Task.
    let merged: unknown = resp;
    if (
      resp && typeof resp === "object" &&
      "content" in resp && "id" in resp
    ) {
      merged = (resp as { context?: unknown }).context || {};
    }
    console.log(JSON.stringify(merged, null, 2));
  });

interface DedupMatch {
  task_id: string | number;
  content: string;
  score: number;
}
interface DedupResult {
  has_duplicates: boolean;
  matches: DedupMatch[];
}

const tasksDedup = new Command("dedup")
  .description("Check if content is similar to an existing open task")
  .requiredOption("--content <content>", "Proposed task content (required)")
  .option("--threshold <n>", "Similarity threshold 0-1 (default 0.6)", (v) =>
    Number.parseFloat(v),
  )
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega tasks dedup --content "Research pricing"
  $ delega tasks dedup --content "Research pricing" --threshold 0.8
  $ delega tasks dedup --content "Research pricing" --json

Call before \`delega tasks create\` to avoid redundant work.
`)
  .action(async (opts) => {
    if (opts.threshold !== undefined && (Number.isNaN(opts.threshold) || opts.threshold < 0 || opts.threshold > 1)) {
      console.error("Error: --threshold must be a number between 0 and 1.");
      process.exit(1);
    }
    const body: { content: string; threshold?: number } = { content: opts.content };
    if (opts.threshold !== undefined) body.threshold = opts.threshold;
    const resp = await apiCall<DedupResult>("POST", "/tasks/dedup", body);
    if (opts.json) {
      console.log(JSON.stringify(resp, null, 2));
      return;
    }
    if (!resp.matches?.length) {
      console.log("No duplicates found.");
      return;
    }
    console.log(`Found ${resp.matches.length} possible duplicate${resp.matches.length === 1 ? "" : "s"}:`);
    for (const m of resp.matches) {
      const score = typeof m.score === "number" ? m.score.toFixed(2) : String(m.score);
      console.log(`  [#${m.task_id}] ${m.content} (score ${score})`);
    }
  });

export const tasksCommand = new Command("tasks")
  .description("Manage tasks")
  .addCommand(tasksList)
  .addCommand(tasksCreate)
  .addCommand(tasksShow)
  .addCommand(tasksComplete)
  .addCommand(tasksDelete)
  .addCommand(tasksDelegate)
  .addCommand(tasksAssign)
  .addCommand(tasksChain)
  .addCommand(tasksSetContext)
  .addCommand(tasksDedup);
