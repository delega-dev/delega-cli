import node_fs from "node:fs";
import node_path from "node:path";
import node_os from "node:os";
import chalk from "chalk";
import { Command } from "commander";
import { deleteStoredApiKey } from "../secret-store.js";
import { confirm } from "../ui.js";

export const resetCommand = new Command("reset")
  .description("Remove local credentials and config")
  .option("--force", "Skip confirmation prompt")
  .option("--dry-run", "Show what would be cleaned without doing it")
  .option("--json", "Output raw JSON")
  .addHelpText("after", `
Examples:
  $ delega reset                          Interactive confirmation
  $ delega reset --force                  Skip confirmation (for scripts/agents)
  $ delega reset --dry-run                Preview what would be removed
  $ delega reset --dry-run --json         Preview as JSON (for scripting)
  $ delega reset --force --json           Reset and output result as JSON
`)
  .action(async (opts) => {
    const configDir = node_path.join(node_os.homedir(), ".delega");

    if (opts.dryRun) {
      const hasConfig = node_fs.existsSync(configDir);
      if (opts.json) {
        console.log(JSON.stringify({ dry_run: true, would_remove: { api_key: true, config_dir: hasConfig ? configDir : null } }, null, 2));
        return;
      }
      console.log("Dry run — the following would be removed:");
      console.log(`  - API key from secure storage (if stored)`);
      if (hasConfig) {
        console.log(`  - ${configDir}`);
      } else {
        console.log(`  - ${configDir} (not found)`);
      }
      return;
    }

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
    let configDeleted = false;
    if (node_fs.existsSync(configDir)) {
      node_fs.rmSync(configDir, { recursive: true, force: true });
      configDeleted = true;
    }

    // 3. Report what was cleaned
    if (opts.json) {
      console.log(JSON.stringify({ api_key_removed: keyDeleted, config_dir_removed: configDeleted ? configDir : null }, null, 2));
      return;
    }

    if (keyDeleted) console.log(chalk.green("✓ API key removed from secure storage"));
    if (configDeleted) console.log(chalk.green(`✓ Removed ${configDir}`));
    if (!keyDeleted && !configDeleted) {
      console.log("Nothing to clean up — no stored credentials or config found.");
      return;
    }

    console.log();
    console.log("Run `delega init` to set up again.");
  });
