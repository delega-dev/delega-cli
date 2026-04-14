import node_fs from "node:fs";
import node_path from "node:path";
import node_os from "node:os";
import { loadStoredApiKey, storeApiKey } from "./secret-store.js";

export interface DelegaConfig {
  api_key?: string;
  api_url?: string;
}

export interface ApiKeyStorageResult {
  location: string;
  secure: boolean;
}

const LOCAL_API_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function isLocalApiHost(hostname: string): boolean {
  return LOCAL_API_HOSTS.has(normalizeHost(hostname));
}

function defaultApiBasePath(hostname: string): string {
  return isLocalApiHost(hostname) ? "/api" : "/v1";
}

function getConfigDir(): string {
  return node_path.join(node_os.homedir(), ".delega");
}

function getConfigPath(): string {
  return node_path.join(getConfigDir(), "config.json");
}

export function loadConfig(): DelegaConfig {
  const configPath = getConfigPath();
  if (!node_fs.existsSync(configPath)) {
    return {};
  }

  const raw = node_fs.readFileSync(configPath, "utf-8");
  try {
    return JSON.parse(raw) as DelegaConfig;
  } catch {
    throw new Error(
      "Configuration file ~/.delega/config.json is corrupted. Fix or delete it, then retry.",
    );
  }
}

export function saveConfig(config: DelegaConfig): void {
  const configDir = getConfigDir();
  if (!node_fs.existsSync(configDir)) {
    node_fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
  node_fs.chmodSync(configDir, 0o700);
  node_fs.writeFileSync(
    getConfigPath(),
    JSON.stringify(config, null, 2) + "\n",
    { encoding: "utf-8", mode: 0o600 },
  );
  node_fs.chmodSync(getConfigPath(), 0o600);
}

export function persistApiKey(apiKey: string): ApiKeyStorageResult {
  const storeLabel = storeApiKey(apiKey);
  if (storeLabel) {
    return {
      location: storeLabel,
      secure: true,
    };
  }

  return {
    location: getConfigPath(),
    secure: false,
  };
}

export function normalizeApiUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      `Invalid Delega API URL: "${rawUrl}". Expected a valid URL like https://api.delega.dev or http://localhost:18890`,
    );
  }

  if (parsed.protocol !== "https:" && !isLocalApiHost(parsed.hostname)) {
    throw new Error(
      `Delega API URL must use HTTPS for remote servers. Got: "${rawUrl}"\n  Use http:// only for localhost. For remote servers, use https://.`,
    );
  }

  parsed.search = "";
  parsed.hash = "";

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = normalizedPath && normalizedPath !== "/"
    ? normalizedPath
    : defaultApiBasePath(parsed.hostname);

  return parsed.toString().replace(/\/+$/, "");
}

export function getApiKey(): string | undefined {
  // DELEGA_API_KEY is the historical primary for this package.
  // DELEGA_AGENT_KEY is accepted as a fallback for cross-client consistency
  // with @delega-dev/mcp, whose primary is DELEGA_AGENT_KEY. Agents that
  // configure MCP + CLI in the same shell don't need to set both.
  return (
    process.env.DELEGA_API_KEY ||
    process.env.DELEGA_AGENT_KEY ||
    loadStoredApiKey() ||
    loadConfig().api_key
  );
}

export function getApiUrl(): string {
  return normalizeApiUrl(
    process.env.DELEGA_API_URL ||
    loadConfig().api_url ||
    "https://api.delega.dev"
  );
}
