import node_child_process from "node:child_process";
import node_fs from "node:fs";
import node_os from "node:os";
import node_path from "node:path";

const SERVICE_NAME = "@delega-dev/cli";
const ACCOUNT_NAME = "default";
const WINDOWS_SECRET_PATH = node_path.join(node_os.homedir(), ".delega", "api-key.dpapi");

function ensureConfigDir(): void {
  const configDir = node_path.dirname(WINDOWS_SECRET_PATH);
  if (!node_fs.existsSync(configDir)) {
    node_fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
}

function isLinuxSecretToolAvailable(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  try {
    node_child_process.execFileSync("sh", ["-lc", "command -v secret-tool >/dev/null 2>&1"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function readMacosKeychain(): string | undefined {
  try {
    return node_child_process.execFileSync(
      "security",
      ["find-generic-password", "-a", ACCOUNT_NAME, "-s", SERVICE_NAME, "-w"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return undefined;
  }
}

function writeMacosKeychain(apiKey: string): void {
  node_child_process.execFileSync(
    "security",
    ["add-generic-password", "-U", "-a", ACCOUNT_NAME, "-s", SERVICE_NAME, "-w", apiKey],
    { stdio: "ignore" },
  );
}

function readLinuxSecretTool(): string | undefined {
  if (!isLinuxSecretToolAvailable()) {
    return undefined;
  }
  try {
    return node_child_process.execFileSync(
      "secret-tool",
      ["lookup", "service", SERVICE_NAME, "account", ACCOUNT_NAME],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return undefined;
  }
}

function writeLinuxSecretTool(apiKey: string): void {
  node_child_process.execFileSync(
    "secret-tool",
    ["store", "--label", "Delega CLI API key", "service", SERVICE_NAME, "account", ACCOUNT_NAME],
    { input: apiKey, encoding: "utf-8", stdio: ["pipe", "ignore", "ignore"] },
  );
}

function readWindowsProtectedFile(): string | undefined {
  if (!node_fs.existsSync(WINDOWS_SECRET_PATH)) {
    return undefined;
  }
  try {
    return node_child_process.execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$secure = Get-Content -Raw $env:DELEGA_SECRET_PATH | ConvertTo-SecureString; $cred = [System.Management.Automation.PSCredential]::new('delega', $secure); $cred.GetNetworkCredential().Password",
      ],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, DELEGA_SECRET_PATH: WINDOWS_SECRET_PATH },
      },
    ).trim();
  } catch {
    return undefined;
  }
}

function writeWindowsProtectedFile(apiKey: string): void {
  ensureConfigDir();
  const encrypted = node_child_process.execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$secure = ConvertTo-SecureString $env:DELEGA_API_KEY -AsPlainText -Force; $secure | ConvertFrom-SecureString",
    ],
    {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, DELEGA_API_KEY: apiKey },
    },
  ).trim();
  node_fs.writeFileSync(WINDOWS_SECRET_PATH, encrypted + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function secureStoreLabel(): string | undefined {
  if (process.platform === "darwin") {
    return "macOS Keychain";
  }
  if (process.platform === "linux" && isLinuxSecretToolAvailable()) {
    return "libsecret keyring";
  }
  if (process.platform === "win32") {
    return "Windows user-protected storage";
  }
  return undefined;
}

export function loadStoredApiKey(): string | undefined {
  if (process.platform === "darwin") {
    return readMacosKeychain();
  }
  if (process.platform === "linux") {
    return readLinuxSecretTool();
  }
  if (process.platform === "win32") {
    return readWindowsProtectedFile();
  }
  return undefined;
}

function deleteMacosKeychain(): boolean {
  try {
    node_child_process.execFileSync(
      "security",
      ["delete-generic-password", "-a", ACCOUNT_NAME, "-s", SERVICE_NAME],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

function deleteLinuxSecretTool(): boolean {
  if (!isLinuxSecretToolAvailable()) return false;
  try {
    node_child_process.execFileSync(
      "secret-tool",
      ["clear", "service", SERVICE_NAME, "account", ACCOUNT_NAME],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

function deleteWindowsProtectedFile(): boolean {
  try {
    if (!node_fs.existsSync(WINDOWS_SECRET_PATH)) {
      return false;
    }
    node_fs.unlinkSync(WINDOWS_SECRET_PATH);
    return true;
  } catch {
    return false;
  }
}

export function deleteStoredApiKey(): boolean {
  if (process.platform === "darwin") return deleteMacosKeychain();
  if (process.platform === "linux") return deleteLinuxSecretTool();
  if (process.platform === "win32") return deleteWindowsProtectedFile();
  return false;
}

export function storeApiKey(apiKey: string): string | undefined {
  if (process.platform === "darwin") {
    writeMacosKeychain(apiKey);
    return "macOS Keychain";
  }
  if (process.platform === "linux" && isLinuxSecretToolAvailable()) {
    writeLinuxSecretTool(apiKey);
    return "libsecret keyring";
  }
  if (process.platform === "win32") {
    writeWindowsProtectedFile(apiKey);
    return "Windows user-protected storage";
  }
  return undefined;
}
