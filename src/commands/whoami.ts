import { Command } from "commander";
import { apiCall } from "../api.js";
import { label } from "../ui.js";

interface Agent {
  id: string;
  name: string;
  display_name?: string;
  email?: string;
  plan?: string;
  active?: boolean;
  user?: {
    email?: string;
    plan?: string;
  };
}

export const whoamiCommand = new Command("whoami")
  .description("Show current authenticated agent")
  .action(async () => {
    const data = await apiCall<Agent | Agent[]>("GET", "/v1/agents");

    let agent: Agent;
    if (Array.isArray(data)) {
      if (data.length === 0) {
        console.error("No agent found.");
        process.exit(1);
      }
      agent = data[0];
    } else {
      agent = data;
    }

    console.log();
    label("Agent", agent.name);
    if (agent.display_name) {
      label("Display Name", agent.display_name);
    }
    if (agent.user?.email || agent.email) {
      label("Email", agent.user?.email || agent.email || "");
    }
    if (agent.user?.plan || agent.plan) {
      label("Plan", agent.user?.plan || agent.plan || "");
    }
    label("Active", agent.active !== false ? "yes" : "no");
    console.log();
  });
