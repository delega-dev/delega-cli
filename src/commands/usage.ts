import { Command } from "commander";
import { apiCall } from "../api.js";
import { getApiUrl } from "../config.js";
import { label } from "../ui.js";

interface Usage {
  plan?: string;
  task_count_month?: number;
  tasks_this_month?: number;
  task_count?: number;
  task_limit?: number | null;
  limit?: number | null;
  reset_date?: string;
  resets_at?: string;
  agent_count?: number;
  agent_limit?: number | null;
  webhook_count?: number;
  webhook_limit?: number | null;
  project_count?: number;
  project_limit?: number | null;
  rate_limit_rpm?: number;
  max_content_chars?: number;
  [key: string]: unknown;
}

function formatLimit(n: number | null | undefined): string {
  if (n === null || n === undefined) return "unlimited";
  return String(n);
}

// Hosted-only gate: the /usage endpoint doesn't exist on self-hosted backends
// (mirrors delega-mcp's client-side gate at delega-mcp/src/delega-client.ts:170).
function isHostedApi(apiUrl: string): boolean {
  try {
    const parsed = new URL(apiUrl);
    // getApiUrl always appends /v1 or /api based on hostname; check the path.
    return parsed.pathname.startsWith("/v1");
  } catch {
    return false;
  }
}

export const usageCommand = new Command("usage")
  .description("Show plan quota and rate-limit info (hosted API only)")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega usage
  $ delega usage --json

Hosted API only (api.delega.dev). Self-hosted deployments do not expose
a usage endpoint.
`)
  .action(async (opts) => {
    const apiUrl = getApiUrl();
    if (!isHostedApi(apiUrl)) {
      console.error(
        "Error: \`delega usage\` is only available on the hosted Delega API " +
          "(api.delega.dev). Self-hosted deployments do not expose a usage endpoint.",
      );
      process.exit(1);
    }

    const data = await apiCall<Usage>("GET", "/usage");
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log();
    if (data.plan) label("Plan", data.plan);
    const taskCount = data.task_count_month ?? data.tasks_this_month ?? data.task_count;
    if (taskCount !== undefined) {
      const resets = data.reset_date ?? data.resets_at;
      const resetLabel = resets ? ` (resets ${resets})` : "";
      label("Tasks", `${taskCount}/${formatLimit(data.task_limit ?? data.limit)}${resetLabel}`);
    }
    if (data.agent_count !== undefined) {
      label("Agents", `${data.agent_count}/${formatLimit(data.agent_limit)}`);
    }
    if (data.webhook_count !== undefined) {
      label("Webhooks", `${data.webhook_count}/${formatLimit(data.webhook_limit)}`);
    }
    if (data.project_count !== undefined) {
      label("Projects", `${data.project_count}/${formatLimit(data.project_limit)}`);
    }
    if (data.rate_limit_rpm !== undefined) {
      label("Rate limit", `${data.rate_limit_rpm} req/min`);
    }
    if (data.max_content_chars !== undefined) {
      label("Max content chars", String(data.max_content_chars));
    }
    console.log();
  });
