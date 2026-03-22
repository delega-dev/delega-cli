import { Command } from "commander";
import chalk from "chalk";
import { getApiKey, getApiUrl } from "../config.js";
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

    // 4. Hit /agent/me (authenticated) — direct fetch so network errors don't exit
    const authHeaders = { "X-Agent-Key": apiKey, "Content-Type": "application/json" };
    let me: MeResponse | undefined;
    if (healthy) {
      try {
        const meRes = await fetch(apiUrl + "/agent/me", {
          headers: authHeaders,
          signal: AbortSignal.timeout(10_000),
        });
        if (meRes.ok) {
          me = await meRes.json() as MeResponse;
        }
      } catch { /* graceful degradation — show partial output */ }
    }

    // 5. Hit /stats (authenticated) — direct fetch for same reason
    let stats: Stats | undefined;
    if (healthy) {
      try {
        const statsRes = await fetch(apiUrl + "/stats", {
          headers: authHeaders,
          signal: AbortSignal.timeout(10_000),
        });
        if (statsRes.ok) {
          stats = await statsRes.json() as Stats;
        }
      } catch { /* graceful degradation */ }
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
      console.log(chalk.yellow("  - Is the URL correct? (DELEGA_API_URL=<url> delega status)"));
      console.log(chalk.yellow("  - Run `delega init` to reconfigure."));
    }

    console.log();
  });
