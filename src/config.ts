import node_fs from "node:fs";
import node_path from "node:path";
import node_os from "node:os";

export interface DelegaConfig {
  api_key?: string;
  api_url?: string;
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
  try {
    const raw = node_fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as DelegaConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: DelegaConfig): void {
  const configDir = getConfigDir();
  if (!node_fs.existsSync(configDir)) {
    node_fs.mkdirSync(configDir, { recursive: true });
  }
  node_fs.writeFileSync(
    getConfigPath(),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );
}

export function getApiKey(): string | undefined {
  return process.env.DELEGA_API_KEY || loadConfig().api_key;
}

export function getApiUrl(): string {
  return (
    process.env.DELEGA_API_URL ||
    loadConfig().api_url ||
    "https://api.delega.dev"
  );
}
