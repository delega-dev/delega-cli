#!/usr/bin/env node

import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { whoamiCommand } from "./commands/whoami.js";
import { tasksCommand } from "./commands/tasks.js";
import { agentsCommand } from "./commands/agents.js";
import { statsCommand } from "./commands/stats.js";
import { printBanner } from "./ui.js";

const program = new Command();

program
  .name("delega")
  .description("CLI for Delega task API")
  .version("1.0.0")
  .option("--api-url <url>", "Override API URL")
  .hook("preAction", (thisCommand) => {
    const apiUrl = thisCommand.opts().apiUrl as string | undefined;
    if (apiUrl) {
      process.env.DELEGA_API_URL = apiUrl;
    }
  });

program.addCommand(loginCommand);
program.addCommand(whoamiCommand);
program.addCommand(tasksCommand);
program.addCommand(agentsCommand);
program.addCommand(statsCommand);

program.on("command:*", () => {
  printBanner();
  program.help();
});

if (process.argv.length <= 2) {
  printBanner();
  program.help();
}

program.parse();
