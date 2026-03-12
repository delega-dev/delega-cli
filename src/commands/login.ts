import { Command } from "commander";
import node_readline from "node:readline";
import { saveConfig, loadConfig } from "../config.js";
import { printBanner } from "../ui.js";

interface Agent {
  id: string;
  name: string;
  display_name?: string;
}

async function prompt(question: string): Promise<string> {
  const rl = node_readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export const loginCommand = new Command("login")
  .description("Authenticate with the Delega API")
  .action(async () => {
    printBanner();

    const key = await prompt("Enter your API key (starts with dlg_): ");

    if (!key) {
      console.error("No key provided.");
      process.exit(1);
    }

    if (!key.startsWith("dlg_")) {
      console.error("Invalid key format. Keys start with dlg_");
      process.exit(1);
    }

    // Validate by calling the API
    const config = loadConfig();
    const apiUrl = config.api_url || process.env.DELEGA_API_URL || "https://api.delega.dev";

    let res: Response;
    try {
      res = await fetch(`${apiUrl}/v1/agents`, {
        headers: {
          "X-Agent-Key": key,
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Connection error: ${msg}`);
      process.exit(1);
    }

    if (!res.ok) {
      console.error("Invalid API key. Authentication failed.");
      process.exit(1);
    }

    let agentName = "agent";
    try {
      const data = (await res.json()) as Agent | Agent[];
      if (Array.isArray(data) && data.length > 0) {
        agentName = data[0].display_name || data[0].name;
      } else if (!Array.isArray(data) && data.name) {
        agentName = data.display_name || data.name;
      }
    } catch {
      // Proceed with default name
    }

    saveConfig({ ...config, api_key: key });
    console.log(`\nLogged in as ${agentName}. Key saved to ~/.delega/config.json`);
  });
