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
  // Read a secret without echoing keystrokes.
  // We avoid readline entirely — Node 24's readline requires a full
  // EventEmitter output stream, and fake streams caused duplicate prompts.
  // Instead: raw mode + manual character collection. Simple and portable.
  process.stdout.write(question);

  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      // Non-interactive (piped input): fall back to line reading.
      let data = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (chunk: string) => { data += chunk; });
      process.stdin.on("end", () => resolve(data.split("\n")[0].trim()));
      process.stdin.resume();
      return;
    }

    let input = "";
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const onData = (key: string) => {
      const code = key.charCodeAt(0);
      if (key === "\r" || key === "\n") {
        // Enter — done
        cleanup();
        process.stdout.write("\n");
        resolve(input.trim());
      } else if (code === 3) {
        // Ctrl+C
        cleanup();
        process.stdout.write("\n");
        reject(new Error("Cancelled."));
      } else if (code === 127 || code === 8) {
        // Backspace / Delete
        input = input.slice(0, -1);
      } else if (code >= 32) {
        // Printable character
        input += key;
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
    };

    process.stdin.on("data", onData);
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
