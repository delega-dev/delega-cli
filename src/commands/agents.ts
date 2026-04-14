import { Command } from "commander";
import chalk from "chalk";
import { apiCall, apiRequest } from "../api.js";
import { printTable, formatDate, label, confirm } from "../ui.js";

interface Agent {
  id: string;
  name: string;
  display_name?: string;
  active?: boolean;
  created_at?: string;
  api_key?: string;
}

const agentsList = new Command("list")
  .description("List agents")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega agents list
  $ delega agents list --json             Output as JSON (for scripting)
`)
  .action(async (opts) => {
    const data = await apiCall<Agent[]>("GET", "/agents");

    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const agents = Array.isArray(data) ? data : [data];

    if (agents.length === 0) {
      console.log("No agents found.");
      return;
    }

    const headers = ["Name", "Display Name", "Active", "Created"];
    const rows = agents.map((a) => [
      a.name,
      a.display_name || "—",
      a.active !== false ? "yes" : "no",
      formatDate(a.created_at || ""),
    ]);

    printTable(headers, rows);
  });

const agentsCreate = new Command("create")
  .description("Create a new agent")
  .argument("<name>", "Agent name")
  .option("--display-name <name>", "Friendly display name")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega agents create my-agent
  $ delega agents create deploy-bot --display-name "Deploy Bot"
  $ delega agents create ci-agent --json  Get agent details (incl. API key) as JSON
`)
  .action(async (name: string, opts) => {
    const body: Record<string, unknown> = { name };
    if (opts.displayName) body.display_name = opts.displayName;

    const agent = await apiCall<Agent>("POST", "/agents", body);

    if (opts.json) {
      console.log(JSON.stringify(agent, null, 2));
      return;
    }

    console.log();
    label("Agent Created", agent.name);
    if (agent.display_name) label("Display Name", agent.display_name);
    label("ID", agent.id);
    if (agent.api_key) {
      console.log();
      console.log(`  API Key: ${chalk.cyan.bold(agent.api_key)}`);
      console.log(
        chalk.yellow("  Save this key — it will not be shown again."),
      );
    }
    console.log();
  });

const agentsRotate = new Command("rotate")
  .description("Rotate an agent's API key")
  .argument("<id>", "Agent ID")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output raw JSON")
  .option("--dry-run", "Show what would happen without rotating")
  .addHelpText("after", `
Examples:
  $ delega agents rotate abc123
  $ delega agents rotate abc123 --yes     Skip confirmation (for scripts/agents)
  $ delega agents rotate abc123 --json    Get new API key as JSON
  $ delega agents rotate abc123 --dry-run Preview without rotating
  `)
  .action(async (id: string, opts) => {
    if (opts.dryRun) {
      const result = await apiRequest<Agent>("GET", `/agents/${id}`);
      const agent = result.ok ? (result.data as Agent) : undefined;
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              dry_run: true,
              agent_id: id,
              agent_name: agent ? (agent.display_name || agent.name) : null,
              action: "rotate-key",
            },
            null,
            2,
          ),
        );
        return;
      }
      if (agent) {
        console.log(`Would rotate API key for agent "${agent.display_name || agent.name}" (${id}).`);
      } else {
        console.log(`Would rotate API key for agent ${id}.`);
      }
      console.log("No changes made.");
      return;
    }
    if (!opts.yes) {
      const ok = await confirm(
        `Rotate key for agent ${id}? Old key will stop working immediately. (y/N) `,
      );
      if (!ok) {
        console.log("Cancelled.");
        return;
      }
    }

    const result = await apiCall<{ id: string; api_key: string }>(
      "POST",
      `/agents/${id}/rotate-key`,
    );

    if (opts.json) {
      console.log(JSON.stringify({ id: result.id, api_key: result.api_key }, null, 2));
      return;
    }

    console.log();
    console.log(`  New API Key: ${chalk.cyan.bold(result.api_key)}`);
    console.log(chalk.yellow("  Save this key — it will not be shown again."));
    console.log();
  });

const agentsDelete = new Command("delete")
  .description("Delete an agent")
  .argument("<id>", "Agent ID to delete")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output raw JSON")
  .option("--dry-run", "Show what would happen without deleting")
  .addHelpText("after", `
Examples:
  $ delega agents delete abc123
  $ delega agents delete abc123 --yes         Skip confirmation (for scripts/agents)
  $ delega agents delete abc123 --dry-run     Preview without deleting

The API refuses to delete an agent that has active tasks, is the recovery
agent, is the last active agent, or is the caller itself.
`)
  .action(async (id: string, opts) => {
    if (opts.dryRun) {
      const result = await apiRequest<Agent>("GET", `/agents/${id}`);
      const agent = result.ok ? (result.data as Agent) : undefined;
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              dry_run: true,
              agent_id: id,
              agent_name: agent ? (agent.display_name || agent.name) : null,
              action: "delete",
            },
            null,
            2,
          ),
        );
        return;
      }
      if (agent) {
        console.log(`Would delete agent "${agent.display_name || agent.name}" (${id}).`);
      } else {
        console.log(`Would delete agent ${id}.`);
      }
      console.log("No changes made.");
      return;
    }
    if (!opts.yes) {
      const ok = await confirm(
        `Delete agent ${id}? This action cannot be undone. (y/N) `,
      );
      if (!ok) {
        console.log("Cancelled.");
        return;
      }
    }
    await apiCall("DELETE", `/agents/${id}`);
    if (opts.json) {
      console.log(JSON.stringify({ id, deleted: true }, null, 2));
      return;
    }
    console.log(`Agent ${id} deleted.`);
  });

export const agentsCommand = new Command("agents")
  .description("Manage agents")
  .addCommand(agentsList)
  .addCommand(agentsCreate)
  .addCommand(agentsRotate)
  .addCommand(agentsDelete);
