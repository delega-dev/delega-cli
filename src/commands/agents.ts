import { Command } from "commander";
import node_readline from "node:readline";
import chalk from "chalk";
import { apiCall } from "../api.js";
import { printTable, formatDate, label } from "../ui.js";

interface Agent {
  id: string;
  name: string;
  display_name?: string;
  active?: boolean;
  created_at?: string;
  api_key?: string;
}

function confirm(question: string): Promise<boolean> {
  const rl = node_readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

const agentsList = new Command("list")
  .description("List agents")
  .option("--json", "Output raw JSON")
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
  .action(async (id: string) => {
    const yes = await confirm(
      `Rotate key for agent ${id}? Old key will stop working immediately. (y/N) `,
    );
    if (!yes) {
      console.log("Cancelled.");
      return;
    }

    const result = await apiCall<{ api_key: string }>(
      "POST",
      `/agents/${id}/rotate-key`,
    );

    console.log();
    console.log(`  New API Key: ${chalk.cyan.bold(result.api_key)}`);
    console.log(chalk.yellow("  Save this key — it will not be shown again."));
    console.log();
  });

export const agentsCommand = new Command("agents")
  .description("Manage agents")
  .addCommand(agentsList)
  .addCommand(agentsCreate)
  .addCommand(agentsRotate);
