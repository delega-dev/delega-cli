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
