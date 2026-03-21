import node_child_process from "node:child_process";
import node_fs from "node:fs";
import node_path from "node:path";
import node_readline from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { Command } from "commander";
import {
  getApiKey,
  loadConfig,
  normalizeApiUrl,
  persistApiKey,
  saveConfig,
} from "../config.js";
import { printBanner } from "../ui.js";

const DELEGA_DOCKER_TAG = "1.0.0";
const HOSTED_API_URL = "https://api.delega.dev";
const DEFAULT_LOCAL_PORT = 18890;
const DEMO_TASK_CONTENT = "Review the Delega quickstart docs and try the API";
const DOCS_URL = "https://delega.dev/docs";
const HOSTED_DASHBOARD_URL = "https://delega.dev/dashboard";
const GITHUB_URL = "https://github.com/delega-dev/delega";
const DOCKER_INSTALL_URL = "https://docs.docker.com/get-docker/";
const DOCKER_COMPOSE_TEMPLATE_PATH = fileURLToPath(
  new URL("../templates/docker-compose.yml", import.meta.url),
);

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

interface BootstrapAgentResponse {
  id: string;
  name: string;
  api_key?: string;
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

function loadDockerComposeTemplate(): string {
  try {
    return node_fs.readFileSync(DOCKER_COMPOSE_TEMPLATE_PATH, "utf-8");
  } catch (error) {
    throw new UserFacingError(
      `Unable to load the Docker template: ${extractMessage(error)}`,
    );
  }
}

function buildDockerCompose(port: number): string {
  return loadDockerComposeTemplate()
    .replace(/__DELEGA_PORT__/g, String(port))
    .replace(/__DELEGA_VERSION__/g, DELEGA_DOCKER_TAG);
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

function saveApiConfig(rawApiUrl: string): void {
  try {
    const nextConfig = { ...loadConfig(), api_url: rawApiUrl };
    delete nextConfig.api_key;
    saveConfig(nextConfig);
  } catch (error) {
    throw new UserFacingError(`Unable to save config: ${extractMessage(error)}`);
  }
}

function storeApiKey(apiKey: string): string {
  try {
    return persistApiKey(apiKey);
  } catch (error) {
    throw new UserFacingError(
      `Unable to store API key securely: ${extractMessage(error)}`,
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

function tryParsePort(input: string): number | null {
  if (!/^\d+$/.test(input)) {
    return null;
  }
  const port = Number(input);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

function ensureDockerComposeInstalled(): void {
  try {
    node_child_process.execSync("docker compose version", { stdio: "ignore" });
  } catch {
    throw new UserFacingError(
      "Docker with the Compose plugin is required for self-hosted setup.\n" +
      `  Install Docker Desktop (includes Compose): ${DOCKER_INSTALL_URL}\n` +
      "  Or install the Compose plugin: https://docs.docker.com/compose/install/",
    );
  }
}

async function writeComposeFile(port: number): Promise<string> {
  const composePath = node_path.join(process.cwd(), "docker-compose.yml");

  if (node_fs.existsSync(composePath)) {
    const overwrite = await promptConfirm(
      "docker-compose.yml already exists here. Overwrite it? (y/N) ",
    );
    if (!overwrite) {
      throw new InitCancelledError("Setup cancelled before changing docker-compose.yml.");
    }
  }

  try {
    node_fs.writeFileSync(composePath, buildDockerCompose(port), "utf-8");
  } catch (error) {
    throw new UserFacingError(
      `Unable to write docker-compose.yml: ${extractMessage(error)}`,
    );
  }

  return composePath;
}

function startDockerCompose(composeDir: string): void {
  try {
    node_child_process.execSync("docker compose up -d", {
      cwd: composeDir,
      stdio: "inherit",
    });
  } catch (error) {
    if (isSigintError(error)) {
      throw new InitCancelledError();
    }
    throw new UserFacingError(
      "Docker failed to start Delega. Make sure Docker Desktop is running, then try again.",
    );
  }
}

async function waitForHealthy(apiBaseUrl: string): Promise<void> {
  const healthUrl = `${apiBaseUrl}/health`;
  const maxWaitMs = 90_000;
  const initialDelayMs = 2_000;
  const maxDelayMs = 10_000;
  const startTime = Date.now();

  let attempt = 0;
  let delayMs = initialDelayMs;

  while (Date.now() - startTime < maxWaitMs) {
    attempt += 1;
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the service responds or we run out of time.
    }

    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    const remainingSec = Math.round((maxWaitMs - (Date.now() - startTime)) / 1000);

    if (remainingSec <= 0) {
      break;
    }

    if (attempt === 1) {
      console.log(
        chalk.dim("First-time Docker pull may take a minute or two..."),
      );
    }

    console.log(
      chalk.dim(`  Waiting for API... ${elapsedSec}s elapsed (timeout in ${remainingSec}s)`),
    );

    await sleep(delayMs);
    delayMs = Math.min(delayMs * 1.5, maxDelayMs);
  }

  throw new UserFacingError(
    `Delega did not become healthy at ${healthUrl} within 90 seconds.\n` +
    "  If Docker is still pulling the image, wait and retry.\n" +
    "  Check logs with: docker compose logs",
  );
}

async function bootstrapLocalAgent(apiBaseUrl: string): Promise<BootstrapAgentResponse> {
  const result = await requestJson<BootstrapAgentResponse>(
    `${apiBaseUrl}/agents`,
    jsonRequest("POST", { name: "my-agent" }),
    "Bootstrapping your first agent",
  );

  if (!result.response.ok) {
    throw new UserFacingError(
      parseApiError(
        result.data,
        `Unable to create the first agent (${result.response.status})`,
      ),
    );
  }

  const agent = result.data as BootstrapAgentResponse;
  if (!agent.api_key) {
    throw new UserFacingError("The local API did not return an API key for the first agent.");
  }

  return agent;
}

async function finalizeSetup(rawApiUrl: string, apiKey: string, dashboardUrl: string): Promise<SetupResult> {
  const apiBaseUrl = normalizeApiUrl(rawApiUrl);

  try {
    // Validate API connectivity before persisting anything to disk.
    // If this fails, no config or key is saved — the user can retry cleanly.
    const task = await createDemoTask(apiBaseUrl, apiKey);
    const storageLocation = storeApiKey(apiKey);
    saveApiConfig(rawApiUrl);

    return { apiKey, apiUrl: rawApiUrl, storageLocation, task, dashboardUrl };
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
  const email = await promptText("Your email: ");
  if (!email) {
    throw new UserFacingError("Email is required.");
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

async function runSelfHostedSetup(): Promise<SetupResult> {
  ensureDockerComposeInstalled();

  let port: number | null = null;
  while (port === null) {
    const portInput = await promptText(`Port for Delega API [${DEFAULT_LOCAL_PORT}]: `);
    port = tryParsePort(portInput || String(DEFAULT_LOCAL_PORT));
    if (port === null) {
      console.log(chalk.yellow("Port must be a number between 1 and 65535."));
    }
  }

  const rawApiUrl = `http://localhost:${port}`;
  const apiBaseUrl = normalizeApiUrl(rawApiUrl);

  console.log();
  console.log(chalk.dim(`Writing docker-compose.yml in ${process.cwd()}...`));
  const composePath = await writeComposeFile(port);

  console.log(chalk.dim("Starting Delega with Docker..."));
  startDockerCompose(node_path.dirname(composePath));

  console.log();
  console.log(chalk.dim("Waiting for the local API health check..."));
  await waitForHealthy(apiBaseUrl);

  console.log(chalk.green("✓ Local Delega API is healthy."));
  console.log(chalk.dim("Creating your first admin agent..."));

  const agent = await bootstrapLocalAgent(apiBaseUrl);
  return finalizeSetup(rawApiUrl, agent.api_key as string, rawApiUrl);
}

function printSuccess(result: SetupResult): void {
  const isHosted = result.apiUrl === HOSTED_API_URL;
  const mcpEnv: Record<string, string> = {
    DELEGA_AGENT_KEY: result.apiKey,
  };
  if (!isHosted) {
    mcpEnv.DELEGA_API_URL = result.apiUrl;
  }

  const mcpConfig = {
    mcpServers: {
      delega: {
        command: "npx",
        args: ["-y", "@delega-dev/mcp"],
        env: mcpEnv,
      },
    },
  };

  console.log();
  printKeyBox(result.apiKey, result.storageLocation);
  console.log();

  printSection("Your first task");
  console.log();
  console.log(`${chalk.green("✓")} Task created: "${result.task.content}"`);
  console.log(`  ID: ${result.task.id}`);
  console.log();

  printSection("MCP Configuration");
  console.log();
  console.log("  Paste into claude_desktop_config.json:");
  console.log();
  console.log(indent(JSON.stringify(mcpConfig, null, 2), 2));
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

  const choice = await promptChoice("Where will you run Delega?", [
    "Hosted (api.delega.dev — free tier, no setup)",
    "Self-hosted (Docker on your machine)",
  ]);

  const result = choice === 0
    ? await runHostedSetup()
    : await runSelfHostedSetup();

  printSuccess(result);
}

export const initCommand = new Command("init")
  .description("Set up Delega in about 30 seconds")
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
