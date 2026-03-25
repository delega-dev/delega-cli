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

export const tasksCommand = new Command("tasks")
  .description("Manage tasks")
  .addCommand(tasksList)
  .addCommand(tasksCreate)
  .addCommand(tasksShow)
  .addCommand(tasksComplete)
  .addCommand(tasksDelete)
  .addCommand(tasksDelegate);
