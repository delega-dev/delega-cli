import { Command } from "commander";
import node_readline from "node:readline";
import { saveConfig, loadConfig, normalizeApiUrl, persistApiKey } from "../config.js";
import { printBanner } from "../ui.js";

interface Agent {
  id: string;
  name: string;
  display_name?: string;
}

interface MeResponse {
  agent?: Agent;
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
      res = await fetch(`${apiUrl}/agent/me`, {
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

    if (!res.ok && res.status !== 404) {
      console.error("Invalid API key. Authentication failed.");
      process.exit(1);
    }

    let agentName = "agent";
    let validatedWithoutMetadata = false;

    if (res.ok) {
      try {
        const data = (await res.json()) as MeResponse;
        if (data.agent?.name) {
          agentName = data.agent.display_name || data.agent.name;
        }
      } catch {
        // Proceed with default name
      }
    } else {
      try {
        res = await fetch(`${apiUrl}/tasks?completed=true`, {
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
      validatedWithoutMetadata = true;
    }

    let storageLocation: string;
    try {
      storageLocation = persistApiKey(key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Unable to store API key securely: ${msg}`);
      process.exit(1);
    }

    const nextConfig = { ...config };
    delete nextConfig.api_key;
    saveConfig(nextConfig);
    if (validatedWithoutMetadata) {
      console.log(`\nLogged in. Key saved to ${storageLocation}`);
      console.log("Current server validated the key but does not expose /agent/me metadata.");
      return;
    }

    console.log(`\nLogged in as ${agentName}. Key saved to ${storageLocation}`);
  });
