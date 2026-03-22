# Delega CLI — Implementation Plan

8 improvements for the `@delega-dev/cli` package. Current version: 1.0.8 (package.json).

---

## 1. `--version` flag

**Problem:** `src/index.ts:17` hardcodes `.version("1.0.0")` instead of reading from `package.json`. Every release requires a manual update that's consistently forgotten.

**Complexity:** S

### Files to modify

- `src/index.ts`

### Changes

Replace the hardcoded version string with a dynamic import of `package.json`:

```ts
// At the top of src/index.ts, add:
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

// Then change:
.version("1.0.0")
// To:
.version(pkg.version, "-v, --version")
```

**Why `createRequire`?** The project is ESM (`"type": "module"` in package.json). `import ... assert { type: "json" }` would work but requires Node 18.20+ with `--experimental-json-modules` in some versions. `createRequire` works universally across Node 18+.

**Why `-v, --version`?** Commander only registers `--version` by default. Passing `-v, --version` explicitly adds the short `-v` alias, matching the user's requirement.

### Edge cases

- `dist/index.js` is one level inside `dist/`, so `../package.json` resolves to the repo root — correct.
- If someone runs from source via `ts-node` (`npm run dev`), the relative path still works because `src/` is also one level deep.

### Testing

```bash
# After building:
node dist/index.js --version   # Should print "1.0.8"
node dist/index.js -v           # Should print "1.0.8"
```

---

## 2. `--help` for init

**Problem:** `delega init --help` currently runs the full interactive init wizard instead of showing help text. This is because `commander` does handle `--help` automatically, but the init command has no documented options or detailed description.

**Complexity:** S

### Files to modify

- `src/commands/init.ts`

### Changes

Enhance the command definition at `src/commands/init.ts:703-704` to include a longer help description and explicit option declarations:

```ts
export const initCommand = new Command("init")
  .description("Set up Delega in about 30 seconds")
  .addHelpText("after", `
Examples:
  $ delega init                     Interactive setup wizard
  $ delega init --api-url <url>     Use a custom API URL

This command walks you through:
  1. Choosing hosted (api.delega.dev) or self-hosted (Docker) deployment
  2. Creating your account and first agent
  3. Configuring your MCP client (Claude, Cursor, VS Code, etc.)
`)
  .action(async () => { ... });
```

Commander already intercepts `--help` before `.action()` runs, so `delega init --help` will print the description + added help text and exit — without starting the wizard.

### Edge cases

- Verify that `delega init --help` does NOT trigger the interactive flow. Commander handles this natively (it calls `process.exit(0)` after printing help), but test explicitly.
- Ensure `delega init -h` also works (Commander registers `-h` by default).

### Testing

```bash
delega init --help    # Should print description, options, examples — then exit
delega init -h        # Same
delega help init      # Same (Commander's built-in subcommand)
```

---

## 3. Self-hosted Docker image version

**Problem:** `src/commands/init.ts:18` hardcodes `const DELEGA_DOCKER_TAG = "1.0.0"`. This means self-hosted users always get Docker image `ghcr.io/delega-dev/delega:1.0.0` regardless of CLI version.

**Complexity:** S

### Files to modify

- `src/commands/init.ts`

### Changes

Import the package version (reuse the same approach from item 1) and use it as the Docker tag:

```ts
// At the top of src/commands/init.ts, add:
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

// Replace:
const DELEGA_DOCKER_TAG = "1.0.0";
// With:
const DELEGA_DOCKER_TAG = pkg.version;
```

The `buildDockerCompose()` function at line 248-252 already substitutes `__DELEGA_VERSION__` with `DELEGA_DOCKER_TAG`, so no other changes needed.

### Edge cases

- **Docker image doesn't exist for that tag:** If a CLI version is released before the corresponding Docker image is pushed, `docker compose up -d` will fail. The existing error handling at `startDockerCompose()` (line 358-372) already catches this with a user-friendly message. Consider adding a note in the error: "Image tag `X.Y.Z` may not be published yet. Try `latest` instead."
- **Pre-release / dev versions:** If someone runs from source with a version like `1.0.9-dev`, the Docker tag won't exist. This is acceptable — self-hosted dev users can edit the compose file. No special handling needed.

### Testing

```bash
# Build and run init, choose self-hosted, then inspect the generated docker-compose.yml:
grep "image:" docker-compose.yml
# Should show: ghcr.io/delega-dev/delega:1.0.8 (matching package.json version)
```

---

## 4. `delega status` command

**Problem:** After running `delega init`, users have no quick way to verify their setup is working. They need a single command that checks connectivity, shows who they're authenticated as, and surfaces basic usage info.

**Complexity:** M

### Files to create

- `src/commands/status.ts`

### Files to modify

- `src/index.ts` — register the new command

### Design

`delega status` combines health check + whoami + stats into one view. It should work gracefully when some endpoints are unavailable (self-hosted servers may not implement all of them).

### Changes

**`src/commands/status.ts`:**

```ts
import { Command } from "commander";
import chalk from "chalk";
import { getApiKey, getApiUrl, loadConfig } from "../config.js";
import { apiRequest } from "../api.js";
import { label } from "../ui.js";

interface HealthResponse {
  status?: string;
  version?: string;
}

interface MeResponse {
  agent?: {
    id: string;
    name: string;
    display_name?: string;
    active?: boolean;
  };
  account?: {
    email?: string;
    plan?: string;
  };
}

interface Stats {
  total_tasks?: number;
  completed_tasks?: number;
  pending_tasks?: number;
  total_agents?: number;
  active_agents?: number;
}

export const statusCommand = new Command("status")
  .description("Check connection and show environment info")
  .option("--json", "Output raw JSON")
  .action(async (opts) => {
    // 1. Check for API key
    const apiKey = getApiKey();
    if (!apiKey) {
      console.error("Not authenticated. Run: delega init");
      process.exit(1);
    }

    // 2. Resolve API URL
    let apiUrl: string;
    try {
      apiUrl = getApiUrl();
    } catch (err) {
      console.error(`Configuration error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    // 3. Hit /health (unauthenticated — just checks connectivity)
    let healthy = false;
    let serverVersion: string | undefined;
    try {
      const res = await fetch(apiUrl + "/health", {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        healthy = true;
        try {
          const data = await res.json() as HealthResponse;
          serverVersion = data.version;
        } catch { /* health may return empty 200 */ }
      }
    } catch {
      healthy = false;
    }

    // 4. Hit /agent/me (authenticated)
    let me: MeResponse | undefined;
    if (healthy) {
      const meResult = await apiRequest<MeResponse>("GET", "/agent/me");
      if (meResult.ok) {
        me = meResult.data as MeResponse;
      }
    }

    // 5. Hit /stats (authenticated)
    let stats: Stats | undefined;
    if (healthy) {
      const statsResult = await apiRequest<Stats>("GET", "/stats");
      if (statsResult.ok) {
        stats = statsResult.data as Stats;
      }
    }

    // 6. Output
    if (opts.json) {
      console.log(JSON.stringify({ healthy, apiUrl, serverVersion, agent: me?.agent, account: me?.account, stats }, null, 2));
      return;
    }

    console.log();

    // Connection
    label("API", apiUrl);
    label("Status", healthy ? chalk.green("connected") : chalk.red("unreachable"));
    if (serverVersion) label("Server Version", serverVersion);

    // Agent info
    if (me?.agent) {
      console.log();
      label("Agent", me.agent.display_name || me.agent.name);
      label("Agent ID", me.agent.id);
      label("Active", me.agent.active !== false ? "yes" : "no");
      if (me.account?.email) label("Email", me.account.email);
      if (me.account?.plan) label("Plan", me.account.plan);
    }

    // Stats
    if (stats) {
      console.log();
      if (stats.total_tasks !== undefined) label("Tasks", `${stats.completed_tasks ?? 0} completed / ${stats.pending_tasks ?? 0} pending / ${stats.total_tasks} total`);
      if (stats.total_agents !== undefined) label("Agents", `${stats.active_agents ?? 0} active / ${stats.total_agents} total`);
    }

    if (!healthy) {
      console.log();
      console.log(chalk.yellow("Could not reach the API. Check:"));
      console.log(chalk.yellow("  - Is the server running? (docker compose ps)"));
      console.log(chalk.yellow("  - Is the URL correct? (delega status --api-url <url>)"));
      console.log(chalk.yellow("  - Run `delega init` to reconfigure."));
    }

    console.log();
  });
```

**`src/index.ts` — add import and register:**

```ts
import { statusCommand } from "./commands/status.js";
// ...
program.addCommand(statusCommand);
```

### Edge cases

- **API unreachable:** Show `Status: unreachable` with suggestions. Don't `process.exit(1)` — the point is to diagnose, not fail.
- **Authenticated but /agent/me returns 404:** Skip agent info section (self-hosted servers may not implement it). Same for /stats.
- **Network timeout:** Use a 10-second timeout for the health check. Shorter than the 15s default since this is a diagnostic command.
- **No API key configured:** Exit early with "Not authenticated. Run: delega init".

### Testing

```bash
delega status           # Should show connection info, agent, stats
delega status --json    # Machine-readable output
# With API down:
DELEGA_API_URL=http://localhost:99999 delega status   # Should show "unreachable" + hints
```

---

## 5. `delega tasks list` formatted output

**Problem:** The current `tasks list` table shows `[ID, Priority, Status, Content]` but doesn't show delegation chains. The `assigned_to_agent_id` field exists in the Task interface but isn't displayed. There's also no `delegated_from` field shown.

**Complexity:** M

### Files to modify

- `src/commands/tasks.ts` — update Task interface, list output, and show output
- `src/ui.ts` — (no changes needed, `printTable` already supports dynamic columns)

### Changes

**Update the Task interface** to include delegation fields (the API may already return these):

```ts
interface Task {
  id: string;
  content: string;
  status: string;
  priority: number;
  labels?: string[];
  due_date?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  assigned_to_agent_id?: string;
  delegated_from_task_id?: string;
  parent_task_id?: string;
  subtasks?: Task[];
  comments?: Comment[];
}
```

**Update `tasksList` action** (line 46-81):

```ts
const headers = ["ID", "Pri", "Status", "Delegated To", "Content"];
const rows = tasks.map((t) => [
  formatId(t.id),
  priorityBadge(t.priority),
  statusBadge(t.status),
  t.assigned_to_agent_id ? formatId(t.assigned_to_agent_id) : "—",
  t.content.length > 40 ? t.content.slice(0, 37) + "..." : t.content,
]);
```

Note: Reduce content truncation from 50→40 chars to make room for the new column.

**Update `tasksShow` action** (line 111-146) to also display delegation info:

```ts
if (task.assigned_to_agent_id) label("Delegated To", task.assigned_to_agent_id);
if (task.delegated_from_task_id) label("Delegated From", task.delegated_from_task_id);
if (task.parent_task_id) label("Parent Task", task.parent_task_id);
```

### Edge cases

- **API doesn't return delegation fields:** The `—` dash shows cleanly for undefined. No crash.
- **Long agent IDs:** `formatId()` already truncates to 8 chars.
- **Terminal width:** Adding a column squeezes the table. The 40-char content limit prevents overflow on 80-col terminals: `8 + 3 + 11 + 10 + 40 + spacing = ~80`.
- **Backward compatibility:** `--json` output is unaffected (raw API data).

### Testing

```bash
delega tasks list                  # Should show table with Delegated To column
delega tasks list --json           # Raw JSON, verify delegation fields present
delega tasks show <id>             # Should show delegation chain fields
delega tasks delegate <tid> <aid> --content "sub"  # Create delegation, then list
```

---

## 6. `delega reset` command

**Problem:** When `delega init` breaks halfway through, or a user wants to switch accounts/servers, there's no clean way to wipe local config. They have to manually delete `~/.delega/` and clear the OS keychain.

**Complexity:** M

### Files to create

- `src/commands/reset.ts`

### Files to modify

- `src/index.ts` — register the command
- `src/secret-store.ts` — add `deleteStoredApiKey()` export

### Changes

**`src/secret-store.ts` — add deletion function:**

```ts
function deleteMacosKeychain(): boolean {
  try {
    node_child_process.execFileSync(
      "security",
      ["delete-generic-password", "-a", ACCOUNT_NAME, "-s", SERVICE_NAME],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;  // Key didn't exist or couldn't be deleted
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
    if (node_fs.existsSync(WINDOWS_SECRET_PATH)) {
      node_fs.unlinkSync(WINDOWS_SECRET_PATH);
    }
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
```

**`src/commands/reset.ts`:**

```ts
import node_fs from "node:fs";
import node_path from "node:path";
import node_os from "node:os";
import node_readline from "node:readline";
import chalk from "chalk";
import { Command } from "commander";
import { deleteStoredApiKey } from "../secret-store.js";

function confirm(question: string): Promise<boolean> {
  const rl = node_readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export const resetCommand = new Command("reset")
  .description("Remove local credentials and config")
  .option("--force", "Skip confirmation prompt")
  .action(async (opts) => {
    if (!opts.force) {
      const yes = await confirm(
        "This will remove your stored API key and config. Continue? (y/N) ",
      );
      if (!yes) {
        console.log("Cancelled.");
        return;
      }
    }

    // 1. Delete API key from OS credential store
    const keyDeleted = deleteStoredApiKey();

    // 2. Delete ~/.delega/ directory
    const configDir = node_path.join(node_os.homedir(), ".delega");
    let configDeleted = false;
    if (node_fs.existsSync(configDir)) {
      node_fs.rmSync(configDir, { recursive: true, force: true });
      configDeleted = true;
    }

    // 3. Report what was cleaned
    if (keyDeleted) console.log(chalk.green("✓ API key removed from secure storage"));
    if (configDeleted) console.log(chalk.green(`✓ Removed ${configDir}`));
    if (!keyDeleted && !configDeleted) {
      console.log("Nothing to clean up — no stored credentials or config found.");
      return;
    }

    console.log();
    console.log("Run `delega init` to set up again.");
  });
```

**`src/index.ts` — register:**

```ts
import { resetCommand } from "./commands/reset.js";
program.addCommand(resetCommand);
```

### Edge cases

- **No config exists:** Print "Nothing to clean up" and exit cleanly.
- **Keychain access denied:** `deleteStoredApiKey()` returns false; config dir still gets cleaned. Report partial cleanup.
- **`--force` flag:** Skip confirmation for scripted/CI use.
- **`~/.delega/` has extra files:** `rmSync({ recursive: true })` removes everything. This is intentional — the directory is exclusively owned by this CLI.
- **Non-interactive terminal + no `--force`:** The confirm prompt will read from stdin. If stdin is closed, the readline will resolve with an empty string → interpreted as "no" → cancelled. This is safe.

### Testing

```bash
delega reset            # Should prompt, then delete
delega reset --force    # No prompt
delega status           # Should show "Not authenticated"
delega reset            # Should say "Nothing to clean up"
```

---

## 7. CHANGELOG.md

**Problem:** No changelog exists in the repo. Users and contributors can't easily see what changed between versions.

**Complexity:** S

### Files to create

- `CHANGELOG.md`

### Files to modify

- `package.json` — add `CHANGELOG.md` to the `"files"` array so it's included in the npm package

### Changes

Create `CHANGELOG.md` using [Keep a Changelog](https://keepachangelog.com/) format. Reconstruct history from git log:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `delega status` command for connection diagnostics
- `delega reset` command to wipe local config and credentials
- `--version` / `-v` flag reads version from package.json
- `delega init --help` shows usage info without running the wizard
- Delegation chain columns in `delega tasks list`
- CHANGELOG.md

### Fixed
- Docker image tag pinned to CLI version instead of hardcoded `1.0.0`
- Improved error messages across all commands

## [1.0.9] - 2026-03-21

### Added
- MCP client selector in `delega init` (Claude, Cursor, Windsurf, VS Code, Continue, Codex, OpenClaw)

## [1.0.8] - 2026-03-21

### Fixed
- `delega init` MCP config outputs `DELEGA_AGENT_KEY` (not `DELEGA_API_KEY`)

### Changed
- Documentation features `delega init` as the primary onboarding path

## [1.0.7] and earlier

See [git history](https://github.com/delega-dev/delega-cli/commits/main) for changes prior to 1.0.8.
```

**`package.json` `"files"` update:**

```json
"files": [
  "dist",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "CHANGELOG.md"
],
```

### Edge cases

- The exact history for 1.0.7 and earlier should be reconstructed from git log if needed, but a "see git history" link is acceptable for older versions.
- The `[Unreleased]` section should be updated by each PR. Add a note in the PR template or contributing guide (out of scope for this plan).

### Testing

- Verify `CHANGELOG.md` parses correctly as Markdown.
- Verify `npm pack` includes `CHANGELOG.md` in the tarball:
  ```bash
  npm pack --dry-run 2>&1 | grep CHANGELOG
  ```

---

## 8. Error messages audit

**Problem:** Some error paths show raw error messages or stack traces. Users need human-readable messages with suggested next steps.

**Complexity:** L

### Files to modify

- `src/api.ts` — improve error messages in `apiRequest` and `apiCall`
- `src/commands/login.ts` — improve connection and auth error messages
- `src/commands/init.ts` — already has good error handling, minor tweaks
- `src/commands/tasks.ts` — add error handling around `apiCall`
- `src/commands/agents.ts` — add error handling around `apiCall`
- `src/commands/stats.ts` — add error handling around `apiCall`
- `src/commands/whoami.ts` — add error handling around `apiRequest`
- `src/config.ts` — improve URL validation messages

### Changes

#### 8a. Centralize error formatting in `src/api.ts`

Enhance `apiCall` and `apiRequest` to produce actionable messages for common HTTP status codes and network errors:

```ts
function formatApiError(status: number, data: ApiError): string {
  const serverMsg = data.error || data.message;

  switch (status) {
    case 401:
      return "Authentication failed. Your API key may be invalid or expired.\n  Run: delega login";
    case 403:
      return `Permission denied.${serverMsg ? " " + serverMsg : ""}\n  Check your agent's permissions or contact your admin.`;
    case 404:
      return `Resource not found.${serverMsg ? " " + serverMsg : ""}`;
    case 409:
      return serverMsg || "Conflict — the resource already exists or was modified.";
    case 422:
      return `Invalid request.${serverMsg ? " " + serverMsg : ""}\n  Check your command arguments.`;
    case 429:
      return "Rate limited. Wait a moment and try again.";
    case 500:
    case 502:
    case 503:
      return `Server error (${status}).${serverMsg ? " " + serverMsg : ""}\n  The API may be temporarily unavailable. Try again shortly.`;
    default:
      return serverMsg || `Request failed with status ${status}.`;
  }
}

function formatNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("ECONNREFUSED")) {
    return "Connection refused. Is the Delega server running?\n  For self-hosted: docker compose ps\n  For hosted: check https://status.delega.dev";
  }
  if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
    return "Could not resolve the API hostname. Check your network connection and API URL.";
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("timeout") || msg.includes("TimeoutError")) {
    return "Connection timed out. Check your network connection.\n  If self-hosted, verify the server is running: docker compose ps";
  }
  if (msg.includes("CERT") || msg.includes("certificate")) {
    return `TLS certificate error: ${msg}\n  If using a self-signed cert, set NODE_TLS_REJECT_UNAUTHORIZED=0 (not recommended for production).`;
  }

  return `Connection error: ${msg}`;
}
```

Update `apiRequest` network catch block (line 49-53):

```ts
} catch (err) {
  console.error(formatNetworkError(err));
  process.exit(1);
}
```

Update `apiCall` error handling (line 76-86):

```ts
if (result.status === 401) {
  console.error(formatApiError(401, result.data as ApiError));
  process.exit(1);
}

if (!result.ok) {
  console.error(formatApiError(result.status, result.data as ApiError));
  process.exit(1);
}
```

#### 8b. Wrap command actions with consistent error handling

Each command currently calls `apiCall` which exits on error with `process.exit(1)`. This is fine for the happy path, but some commands do multiple API calls or have pre-API validation that can throw unhandled exceptions.

Add a try/catch wrapper in commands that do direct `fetch` calls or multiple operations. Specifically:

**`src/commands/login.ts`** — line 73-85, improve the fetch error:

```ts
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("ECONNREFUSED")) {
    console.error("Cannot reach the Delega API. Is the server running?");
    console.error("  For self-hosted: docker compose ps");
    console.error("  For hosted: verify your API URL");
  } else {
    console.error(`Connection error: ${msg}`);
  }
  process.exit(1);
}
```

**`src/commands/whoami.ts`** — line 28-64, the `apiRequest` call already handles errors via `apiCall` fallback, but if the initial request also fails due to network, the `apiRequest` function itself calls `process.exit(1)` with the improved messages from 8a. No additional changes needed here beyond 8a.

**`src/commands/tasks.ts`** — The `confirm()` function at line 33-44 can crash if stdin is closed unexpectedly (e.g., piped input ends). Wrap in try/catch:

```ts
function confirm(question: string): Promise<boolean> {
  const rl = node_readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.on("error", () => {
      rl.close();
      resolve(false);
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
```

Same fix for `confirm()` in `src/commands/agents.ts`.

#### 8c. Config error messages (`src/config.ts`)

Enhance `normalizeApiUrl` error at line 76-77:

```ts
throw new Error(
  `Invalid Delega API URL: "${rawUrl}". Expected a valid URL like https://api.delega.dev or http://localhost:18890`,
);
```

Enhance HTTPS requirement error at line 80-81:

```ts
throw new Error(
  `Delega API URL must use HTTPS for remote servers. Got: "${rawUrl}"\n  Use http:// only for localhost. For remote servers, use https://.`,
);
```

#### 8d. Init command — minor improvements (`src/commands/init.ts`)

The init command already has excellent error handling with `UserFacingError` and `InitCancelledError`. One improvement:

When Docker `startDockerCompose` fails (line 368-371), add the Docker image tag to help debug:

```ts
throw new UserFacingError(
  `Docker failed to start Delega (image tag: ${DELEGA_DOCKER_TAG}). Make sure Docker Desktop is running, then try again.\n` +
  "  Check logs with: docker compose logs",
);
```

### Edge cases

- **Don't double-print errors:** `apiCall` already calls `process.exit(1)`. Make sure the improved `formatApiError` replaces the existing logic rather than wrapping it.
- **Self-hosted vs. hosted hints:** Network errors should mention `docker compose ps` for self-hosted setups. Since we don't know the setup type at the api.ts level, include both hints.
- **Non-ASCII error messages from API:** The `serverMsg` extraction already handles string messages. JSON objects from `data.error` would show as `[object Object]` — guard with `typeof === "string"` check (already done in `apiCall`).
- **Exit codes:** All error paths should use `process.exit(1)`. Already consistent.

### Testing

Test each error scenario manually:

```bash
# Network errors
DELEGA_API_URL=http://localhost:99999 delega whoami     # ECONNREFUSED
DELEGA_API_URL=http://fake.invalid delega whoami        # ENOTFOUND

# Auth errors
DELEGA_API_KEY=dlg_invalid delega tasks list            # 401

# Timeout (use a non-routable IP)
DELEGA_API_URL=http://192.0.2.1:18890 delega status    # Timeout

# Invalid config
DELEGA_API_URL=not-a-url delega status                  # Config error

# Rate limiting / server errors — need API cooperation or mocking
```

---

## Implementation order

Recommended sequence (dependencies flow downward):

```
1. --version flag          (S)  ← no dependencies, unblocks item 3
3. Docker image version    (S)  ← uses same package.json import pattern
2. --help for init         (S)  ← standalone
7. CHANGELOG.md            (S)  ← standalone, do early so other items can be logged
8. Error messages          (L)  ← touches api.ts used by items 4-6
6. delega reset            (M)  ← needs secret-store changes
4. delega status           (M)  ← depends on improved api.ts from item 8
5. tasks list output       (M)  ← depends on improved api.ts from item 8
```

Total estimated effort: 2S + 3M + 1L + 2S = ~3-4 focused coding sessions.

---

## Files summary

| File | Items | Action |
|------|-------|--------|
| `src/index.ts` | 1, 4, 6 | Modify (version import, register status + reset) |
| `src/commands/init.ts` | 2, 3, 8d | Modify (help text, Docker tag, error msg) |
| `src/commands/status.ts` | 4 | **Create** |
| `src/commands/reset.ts` | 6 | **Create** |
| `src/commands/tasks.ts` | 5, 8b | Modify (delegation columns, error handling) |
| `src/commands/agents.ts` | 8b | Modify (error handling) |
| `src/commands/login.ts` | 8b | Modify (error messages) |
| `src/commands/whoami.ts` | 8 | No changes needed (covered by api.ts fix) |
| `src/commands/stats.ts` | 8 | No changes needed (covered by api.ts fix) |
| `src/api.ts` | 8a | Modify (formatApiError, formatNetworkError) |
| `src/config.ts` | 8c | Modify (error messages) |
| `src/secret-store.ts` | 6 | Modify (add deleteStoredApiKey) |
| `src/ui.ts` | — | No changes needed |
| `package.json` | 7 | Modify (add CHANGELOG.md to files) |
| `CHANGELOG.md` | 7 | **Create** |
