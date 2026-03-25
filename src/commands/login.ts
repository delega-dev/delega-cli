import { Command } from "commander";
import node_readline from "node:readline";
import { getApiUrl, loadConfig, persistApiKey, saveConfig } from "../config.js";
import { formatNetworkError } from "../api.js";
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
  // Print the prompt ourselves, then read with echo disabled.
  // This avoids needing a fake output stream (which breaks on Node 24+
  // where readline calls output.on('resize', ...) during construction).
  process.stdout.write(question);

  return new Promise((resolve, reject) => {
    const rl = node_readline.createInterface({
      input: process.stdin,
      // Use process.stdout as output so all EventEmitter methods exist,
      // but set terminal: false so readline won't echo input or write prompts.
      output: process.stdout,
      terminal: false,
    });

    // Disable raw echo at the TTY level so keystrokes aren't visible.
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(false);
    }

    rl.on("line", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });

    rl.on("close", () => {
      resolve("");
    });

    rl.on("SIGINT", () => {
      rl.close();
      process.stdout.write("\n");
      reject(new Error("Cancelled."));
    });
  });
}

export const loginCommand = new Command("login")
  .description("Authenticate with the Delega API")
  .addHelpText("after", `
Examples:
  $ delega login                          Interactive API key prompt
  $ DELEGA_API_KEY=dlg_xxx delega whoami  Authenticate via env var instead
`)
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
    let config: ReturnType<typeof loadConfig>;
    let apiUrl: string;
    try {
      config = loadConfig();
      apiUrl = getApiUrl();
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
      console.error(formatNetworkError(err));
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
        console.error(formatNetworkError(err));
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
