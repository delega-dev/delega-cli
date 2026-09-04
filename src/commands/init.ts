import node_readline from "node:readline";
import chalk from "chalk";
import { Command } from "commander";
import {
  getApiKey,
  getCloudflareAccessHeaders,
  loadConfig,
  normalizeApiUrl,
  persistApiKey,
  saveConfig,
} from "../config.js";
import { isValidEmail, printBanner } from "../ui.js";

const HOSTED_API_URL = "https://api.delega.dev";
const DEMO_TASK_CONTENT = "Review the Delega quickstart docs and try the API";
const DOCS_URL = "https://delega.dev/docs";
const HOSTED_DASHBOARD_URL = "https://delega.dev/dashboard";
const GITHUB_URL = "https://github.com/delega-dev";

interface HostedSignupResponse {
  user?: {
    id?: string;
    email?: string;
  };
  agent?: {
    id: string;
    name: string;
    api_key: string;
  };
  message?: string;
}

interface HostedVerifyResponse {
  message?: string;
}

interface TaskResponse {
  id: string;
  content: string;
  priority?: number;
}

interface ApiErrorResponse {
  error?: string;
  message?: string;
}

interface SetupResult {
  apiKey: string;
  apiUrl: string;
  storageLocation: string;
  task: TaskResponse;
  dashboardUrl: string;
}

class InitCancelledError extends Error {
  constructor(message = "Setup cancelled.") {
    super(message);
    this.name = "InitCancelledError";
  }
}

class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

function extractMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSigintError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return "signal" in error && (error as { signal?: string }).signal === "SIGINT";
}

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

async function promptText(question: string, defaultValue?: string): Promise<string> {
  const rl = node_readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      fn();
    };

    rl.on("SIGINT", () => {
      process.stdout.write("\n");
      finish(() => reject(new InitCancelledError()));
    });

    rl.on("close", () => {
      finish(() => reject(new InitCancelledError("Input stream closed.")));
    });

    rl.question(question, (answer) => {
      finish(() => {
        const trimmed = answer.trim();
        resolve(trimmed || defaultValue || "");
      });
    });
  });
}

async function promptChoice(question: string, options: string[]): Promise<number> {
  console.log();
  console.log(chalk.cyan.bold(question));
  for (const [index, option] of options.entries()) {
    console.log(`  ${index + 1}. ${option}`);
  }

  while (true) {
    const answer = await promptText(`Select an option [1-${options.length}]: `);
    const choice = Number.parseInt(answer, 10);
    if (Number.isInteger(choice) && choice >= 1 && choice <= options.length) {
      return choice - 1;
    }
    console.log(chalk.yellow(`Enter a number from 1 to ${options.length}.`));
  }
}

async function promptConfirm(question: string): Promise<boolean> {
  const answer = (await promptText(question)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

function parseApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") {
    return fallback;
  }

  const error = data as ApiErrorResponse;
  if (typeof error.error === "string" && error.error.trim()) {
    return error.error;
  }
  if (typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

async function readResponseBody<T>(response: Response): Promise<T | ApiErrorResponse> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as T | ApiErrorResponse;
  } catch {
    return { message: text };
  }
}

const FETCH_TIMEOUT_MS = 15_000;

async function requestJson<T>(
  url: string,
  init: RequestInit,
  actionName: string,
): Promise<{ response: Response; data: T | ApiErrorResponse }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new UserFacingError(`${actionName} timed out after ${FETCH_TIMEOUT_MS / 1000}s. Check your connection and try again.`);
    }
    throw new UserFacingError(`${actionName} failed: ${extractMessage(error)}`);
  }

  const data = await readResponseBody<T>(response);
  return { response, data };
}

function jsonRequest(method: string, body?: unknown, apiKey?: string): RequestInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getCloudflareAccessHeaders(),
  };

  if (apiKey) {
    headers["X-Agent-Key"] = apiKey;
  }

  return {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function ensureInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UserFacingError("`delega init` requires an interactive terminal.");
  }
}

function printSection(title: string): void {
  const lineWidth = 42;
  const suffix = "─".repeat(Math.max(6, lineWidth - title.length));
  console.log(chalk.cyan(`── ${title} ${suffix}`));
}

function printKeyBox(apiKey: string, storageLocation: string): void {
  const lines = [
    `API Key: ${chalk.cyan.bold(apiKey)}`,
    `Stored in: ${storageLocation}`,
  ];
  const innerWidth = Math.max(...lines.map((line) => stripAnsi(line).length));

  console.log(`  ┌${"─".repeat(innerWidth + 2)}┐`);
  for (const line of lines) {
    const padding = innerWidth - stripAnsi(line).length;
    console.log(`  │ ${line}${" ".repeat(padding)} │`);
  }
  console.log(`  └${"─".repeat(innerWidth + 2)}┘`);
}

function saveApiConfig(rawApiUrl: string, apiKey?: string): void {
  try {
    const nextConfig = { ...loadConfig(), api_url: rawApiUrl };
    if (apiKey) {
      nextConfig.api_key = apiKey;
    } else {
      delete nextConfig.api_key;
    }
    saveConfig(nextConfig);
  } catch (error) {
    throw new UserFacingError(`Unable to save config: ${extractMessage(error)}`);
  }
}

function storeApiKey(apiKey: string): { location: string; secure: boolean } {
  try {
    return persistApiKey(apiKey);
  } catch (error) {
    throw new UserFacingError(
      `Unable to store API key: ${extractMessage(error)}`,
    );
  }
}

async function createDemoTask(apiBaseUrl: string, apiKey: string): Promise<TaskResponse> {
  const taskUrl = `${apiBaseUrl}/tasks`;
  const result = await requestJson<TaskResponse>(
    taskUrl,
    jsonRequest("POST", { content: DEMO_TASK_CONTENT, priority: 2 }, apiKey),
    "Creating your demo task",
  );

  if (!result.response.ok) {
    throw new UserFacingError(
      parseApiError(result.data, `Unable to create demo task (${result.response.status})`),
    );
  }

  return result.data as TaskResponse;
}

async function finalizeSetup(rawApiUrl: string, apiKey: string, dashboardUrl: string): Promise<SetupResult> {
  const apiBaseUrl = normalizeApiUrl(rawApiUrl);

  try {
    // Validate API connectivity before persisting anything to disk.
    // If this fails, no config or key is saved — the user can retry cleanly.
    const task = await createDemoTask(apiBaseUrl, apiKey);
    const storage = storeApiKey(apiKey);
    saveApiConfig(rawApiUrl, storage.secure ? undefined : apiKey);

    return { apiKey, apiUrl: rawApiUrl, storageLocation: storage.location, task, dashboardUrl };
  } catch (error) {
    // The account/agent already exists server-side — print the key so it isn't lost.
    console.error();
    console.error(chalk.yellow("Your API key (save it — setup will need to be completed manually):"));
    console.error(chalk.cyan.bold(`  ${apiKey}`));
    console.error();
    throw error;
  }
}

async function runHostedSetup(): Promise<SetupResult> {
  let email = "";
  while (!isValidEmail(email)) {
    email = await promptText("Your email: ");
    if (!email) {
      console.log(chalk.red("Email is required."));
    } else if (!isValidEmail(email)) {
      console.log(chalk.red("Invalid email format. Please try again."));
    }
  }

  const hostedApiBase = normalizeApiUrl(HOSTED_API_URL);

  console.log();
  console.log(chalk.dim("Creating your hosted Delega account..."));

  const signup = await requestJson<HostedSignupResponse>(
    `${hostedApiBase}/signup`,
    jsonRequest("POST", { email, name: "default" }),
    "Signup",
  );

  if (signup.response.status === 409) {
    throw new UserFacingError("This email is already registered. Run `delega login` instead.");
  }

  if (!signup.response.ok) {
    throw new UserFacingError(
      parseApiError(signup.data, `Signup failed (${signup.response.status})`),
    );
  }

  const agent = (signup.data as HostedSignupResponse).agent;
  if (!agent?.api_key) {
    throw new UserFacingError("The hosted signup response did not include an API key.");
  }

  console.log(chalk.green(`✓ ${(signup.data as HostedSignupResponse).message || "Verification email sent."}`));
  console.log(chalk.dim("Check your email for the 6-digit verification code."));

  const MAX_VERIFY_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS; attempt += 1) {
    let code = "";
    while (!/^\d{6}$/.test(code)) {
      code = await promptText("Enter the 6-digit verification code: ");
      if (!/^\d{6}$/.test(code)) {
        console.log(chalk.yellow("Enter the 6-digit code from your email."));
      }
    }

    const verify = await requestJson<HostedVerifyResponse>(
      `${hostedApiBase}/verify`,
      jsonRequest("POST", { email, code }),
      "Verification",
    );

    if (verify.response.ok) {
      break;
    }

    const errorMsg = parseApiError(verify.data, "Invalid code");

    if (attempt < MAX_VERIFY_ATTEMPTS) {
      console.log(chalk.yellow(`${errorMsg}. ${MAX_VERIFY_ATTEMPTS - attempt} attempt(s) remaining.`));
    } else {
      throw new UserFacingError(
        `Verification failed after ${MAX_VERIFY_ATTEMPTS} attempts. Run \`delega init\` to try again.`,
      );
    }
  }

  return finalizeSetup(HOSTED_API_URL, agent.api_key, HOSTED_DASHBOARD_URL);
}

interface McpClient {
  label: string;
  filePath: string;
  format?: "json" | "toml";
  buildConfig: (env: Record<string, string>) => Record<string, unknown>;
  buildToml?: (env: Record<string, string>) => string;
}

const DELEGA_SERVER_ENTRY = {
  command: "npx",
  args: ["-y", "@delega-dev/mcp"],
};

const MCP_CLIENTS: McpClient[] = [
  {
    label: "Claude Code / Claude Desktop",
    filePath: "claude_desktop_config.json or project .mcp.json",
    buildConfig: (env) => ({ mcpServers: { delega: { ...DELEGA_SERVER_ENTRY, env } } }),
  },
  {
    label: "Cursor",
    filePath: ".cursor/mcp.json",
    buildConfig: (env) => ({ mcpServers: { delega: { ...DELEGA_SERVER_ENTRY, env } } }),
  },
  {
    label: "Windsurf",
    filePath: "~/.codeium/windsurf/mcp_config.json",
    buildConfig: (env) => ({ mcpServers: { delega: { ...DELEGA_SERVER_ENTRY, env } } }),
  },
  {
    label: "VS Code (Copilot)",
    filePath: ".vscode/mcp.json",
    buildConfig: (env) => ({ servers: { delega: { type: "stdio", ...DELEGA_SERVER_ENTRY, env } } }),
  },
  {
    label: "Continue",
    filePath: "~/.continue/config.json",
    buildConfig: (env) => ({
      experimental: { modelContextProtocol: { servers: { delega: { ...DELEGA_SERVER_ENTRY, env } } } },
    }),
  },
  {
    label: "Codex",
    filePath: "~/.codex/config.toml",
    format: "toml",
    buildConfig: (env) => ({}),
    buildToml: (env) => {
      const lines = [
        "[mcp_servers.delega]",
        `command = "npx"`,
        `args = ["-y", "@delega-dev/mcp"]`,
        "",
        "[mcp_servers.delega.env]",
      ];
      for (const [key, value] of Object.entries(env)) {
        lines.push(`${key} = "${value}"`);
      }
      return lines.join("\n");
    },
  },
  {
    label: "OpenClaw",
    filePath: "~/.openclaw/openclaw.json",
    buildConfig: (env) => ({ mcp: { servers: { delega: { ...DELEGA_SERVER_ENTRY, env } } } }),
  },
  {
    label: "Other / manual",
    filePath: "your MCP client config",
    buildConfig: (env) => ({ mcpServers: { delega: { ...DELEGA_SERVER_ENTRY, env } } }),
  },
];

async function printSuccess(result: SetupResult): Promise<void> {
  const isHosted = result.apiUrl === HOSTED_API_URL;
  const mcpEnv: Record<string, string> = {
    DELEGA_AGENT_KEY: result.apiKey,
  };
  if (!isHosted) {
    mcpEnv.DELEGA_API_URL = result.apiUrl;
  }

  console.log();
  printKeyBox(result.apiKey, result.storageLocation);
  console.log();

  printSection("Your first task");
  console.log();
  console.log(`${chalk.green("✓")} Task created: "${result.task.content}"`);
  console.log(`  ID: ${result.task.id}`);
  console.log();

  const clientIndex = await promptChoice(
    "Which MCP client do you use?",
    MCP_CLIENTS.map((c) => c.label),
  );
  const client = MCP_CLIENTS[clientIndex];

  printSection("MCP Configuration");
  console.log();
  console.log(`  Paste into ${chalk.cyan(client.filePath)}:`);
  console.log();
  if (client.format === "toml" && client.buildToml) {
    console.log(indent(client.buildToml(mcpEnv), 2));
  } else {
    const mcpConfig = client.buildConfig(mcpEnv);
    console.log(indent(JSON.stringify(mcpConfig, null, 2), 2));
  }
  console.log();

  printSection("What's next");
  console.log();
  console.log(`  Docs:       ${DOCS_URL}`);
  if (isHosted) {
    console.log(`  Dashboard:  ${result.dashboardUrl}`);
  }
  console.log(`  GitHub:     ${GITHUB_URL}`);
  console.log();
}

async function maybeStartFresh(): Promise<boolean> {
  if (!getApiKey()) {
    return true;
  }

  const startFresh = await promptConfirm("You're already set up. Start fresh? (y/N) ");
  if (!startFresh) {
    console.log("Keeping your existing setup.");
    return false;
  }
  return true;
}

async function runInit(): Promise<void> {
  ensureInteractiveTerminal();
  printBanner();

  if (!await maybeStartFresh()) {
    return;
  }

  const result = await runHostedSetup();

  await printSuccess(result);
}

export const initCommand = new Command("init")
  .description("Set up Delega in about 30 seconds")
  .addHelpText("after", `
Examples:
  $ delega init                     Interactive setup wizard

This command walks you through:
  1. Creating your account and first agent on api.delega.dev
  2. Verifying your email
  3. Configuring your MCP client (Claude, Cursor, VS Code, etc.)
`)
  .action(async () => {
    try {
      await runInit();
    } catch (error) {
      if (error instanceof InitCancelledError || isSigintError(error)) {
        console.error(chalk.yellow("Setup cancelled."));
        process.exitCode = 1;
        return;
      }

      console.error(chalk.red(extractMessage(error)));
      process.exitCode = 1;
    }
  });
