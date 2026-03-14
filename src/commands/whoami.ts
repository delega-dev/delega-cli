import { Command } from "commander";
import { apiCall, apiRequest } from "../api.js";
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

interface MeResponse {
  agent?: Agent;
  account?: {
    email?: string;
    plan?: string;
  };
}

export const whoamiCommand = new Command("whoami")
  .description("Show current authenticated agent")
  .action(async () => {
    const me = await apiRequest<MeResponse>("GET", "/agent/me");
    if (me.ok) {
      const payload = me.data as MeResponse;
      const agent = payload.agent;
      if (!agent) {
        console.error("Current server did not return agent details.");
        process.exit(1);
      }

      console.log();
      label("Agent", agent.name);
      if (agent.display_name) {
        label("Display Name", agent.display_name);
      }
      if (payload.account?.email || agent.user?.email || agent.email) {
        label("Email", payload.account?.email || agent.user?.email || agent.email || "");
      }
      if (payload.account?.plan || agent.user?.plan || agent.plan) {
        label("Plan", payload.account?.plan || agent.user?.plan || agent.plan || "");
      }
      label("Active", agent.active !== false ? "yes" : "no");
      console.log();
      return;
    }

    if (me.status !== 404) {
      await apiCall<MeResponse>("GET", "/agent/me");
      return;
    }

    await apiCall<unknown[]>("GET", "/tasks?completed=true");
    console.log();
    label("Authenticated", "yes");
    label("Server", "Current API does not expose /agent/me");
    console.log();
  });
