#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { whoamiCommand } from "./commands/whoami.js";
import { tasksCommand } from "./commands/tasks.js";
import { agentsCommand } from "./commands/agents.js";
import { statsCommand } from "./commands/stats.js";
import { statusCommand } from "./commands/status.js";
import { resetCommand } from "./commands/reset.js";
import { usageCommand } from "./commands/usage.js";
import { printBanner } from "./ui.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("delega")
  .description("CLI for Delega task API")
  .version(pkg.version, "-v, --version")
  .option("--api-url <url>", "Override API URL")
  .hook("preAction", (thisCommand) => {
    const apiUrl = thisCommand.opts().apiUrl as string | undefined;
    if (apiUrl) {
      process.env.DELEGA_API_URL = apiUrl;
    }
  });

program.addCommand(initCommand);
program.addCommand(loginCommand);
program.addCommand(whoamiCommand);
program.addCommand(tasksCommand);
program.addCommand(agentsCommand);
program.addCommand(statsCommand);
program.addCommand(usageCommand);
program.addCommand(statusCommand);
program.addCommand(resetCommand);

program.on("command:*", ([commandName]) => {
  printBanner();
  if (commandName) {
    console.error(`Unknown command: ${commandName}`);
    console.error();
  }
  program.outputHelp();
  process.exit(1);
});

if (process.argv.length <= 2) {
  printBanner();
  program.help();
}

program.parse();
