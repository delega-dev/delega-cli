import { Command } from "commander";
import node_child_process from "node:child_process";
import { apiCall, apiRequest } from "../api.js";
import { label } from "../ui.js";

interface ConnectResponse {
  install_url: string;
  state_expires_in: number;
}

// Best-effort: open a URL in the user's default browser. Never throws — if it
// fails (headless, no browser), the URL is always printed for manual use.
function openInBrowser(url: string): boolean {
  const platform = process.platform;
  const [cmd, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = node_child_process.spawn(cmd, args as string[], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const connectCommand = new Command("connect")
  .description("Connect a GitHub repo/org so commits and PRs link to Delega tasks")
  .option("--no-open", "Print the install URL instead of opening a browser")
  .option("--json", "Output raw JSON")
  .addHelpText(
    "after",
    `
What happens:
  1. Delega creates a one-time install link tied to your account.
  2. Your browser opens GitHub's "Install Delega" page — pick the repos.
  3. GitHub returns you to Delega, which links those repos automatically.

Once connected, reference tasks from your code:
  $ git commit -m "Fix login delega:#<task-id>"
  $ # open a PR whose body has "Closes-Delega: #<task-id>" to auto-complete it
`,
  )
  .action(async (opts) => {
    const res = await apiRequest<ConnectResponse>("POST", "/integrations/github/connect", {});
    if (!res.ok) {
      // Surface the API error consistently and exit non-zero.
      await apiCall<ConnectResponse>("POST", "/integrations/github/connect", {});
      return;
    }

    const { install_url, state_expires_in } = res.data as ConnectResponse;
    if (opts.json) {
      console.log(JSON.stringify(res.data, null, 2));
      return;
    }

    const minutes = Math.max(1, Math.round((state_expires_in ?? 0) / 60));
    console.log();
    if (opts.open === false) {
      label("Open this URL to install", install_url);
    } else {
      const opened = openInBrowser(install_url);
      label(opened ? "Opening GitHub in your browser" : "Open this URL to install", install_url);
    }
    console.log();
    console.log(`This link is valid for ~${minutes} minute${minutes === 1 ? "" : "s"} and can be used once.`);
    console.log("After installing, the repos you select are linked automatically — return here when done.");
    console.log();
  });

export const githubCommand = new Command("github")
  .description("Manage the GitHub integration (link repos to tasks)")
  .addCommand(connectCommand);
