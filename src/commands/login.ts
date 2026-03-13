import { Command } from "commander";
import node_readline from "node:readline";
import { saveConfig, loadConfig, normalizeApiUrl } from "../config.js";
import { printBanner } from "../ui.js";

interface Agent {
  id: string;
  name: string;
  display_name?: string;
}

async function promptSecret(question: string): Promise<string> {
  const mutedOutput = {
    muted: false,
    write(chunk: string) {
      if (!this.muted || chunk.includes(question)) {
        process.stdout.write(chunk);
      }
    },
  };

  const rl = node_readline.createInterface({
    input: process.stdin,
    output: mutedOutput as unknown as NodeJS.WritableStream,
    terminal: true,
  });

  mutedOutput.muted = true;

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

export const loginCommand = new Command("login")
  .description("Authenticate with the Delega API")
  .action(async () => {
    printBanner();

    const key = await promptSecret("Enter your API key (starts with dlg_): ");

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
    let apiUrl: string;
    try {
      apiUrl = normalizeApiUrl(
        config.api_url || process.env.DELEGA_API_URL || "https://api.delega.dev",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Configuration error: ${msg}`);
      process.exit(1);
    }

    let res: Response;
    try {
      res = await fetch(`${apiUrl}/v1/agent/me`, {
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
      const data = (await res.json()) as { agent?: Agent };
      if (data.agent?.name) {
        agentName = data.agent.display_name || data.agent.name;
      }
    } catch {
      // Proceed with default name
    }

    saveConfig({ ...config, api_key: key });
    console.log(`\nLogged in as ${agentName}. Key saved to ~/.delega/config.json`);
  });
