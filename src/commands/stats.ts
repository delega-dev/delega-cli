import { Command } from "commander";
import { apiCall } from "../api.js";
import { label } from "../ui.js";

interface Stats {
  total_tasks?: number;
  completed_tasks?: number;
  pending_tasks?: number;
  total_agents?: number;
  active_agents?: number;
  [key: string]: unknown;
}

export const statsCommand = new Command("stats")
  .description("Show usage statistics")
  .option("--json", "Output raw JSON")
  .action(async (opts) => {
    const data = await apiCall<Stats>("GET", "/stats");

    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log();
    if (data.total_tasks !== undefined) label("Total Tasks", String(data.total_tasks));
    if (data.completed_tasks !== undefined) label("Completed", String(data.completed_tasks));
    if (data.pending_tasks !== undefined) label("Pending", String(data.pending_tasks));
    if (data.total_agents !== undefined) label("Total Agents", String(data.total_agents));
    if (data.active_agents !== undefined) label("Active Agents", String(data.active_agents));

    // Print any additional stats fields
    const knownKeys = new Set([
      "total_tasks",
      "completed_tasks",
      "pending_tasks",
      "total_agents",
      "active_agents",
    ]);
    for (const [key, value] of Object.entries(data)) {
      if (!knownKeys.has(key) && value !== undefined) {
        const displayKey = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const displayVal = typeof value === "object" ? JSON.stringify(value) : String(value);
        label(displayKey, displayVal);
      }
    }
    console.log();
  });
