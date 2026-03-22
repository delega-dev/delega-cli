import chalk from "chalk";
import node_readline from "node:readline";

const BANNER = `
     ____       __
    / __ \\___  / /__  ____ _____ _
   / / / / _ \\/ / _ \\/ __ \`/ __ \`/
  / /_/ /  __/ /  __/ /_/ / /_/ /
 /_____/\\___/_/\\___/\\__, /\\__,_/
                   /____/
  Task infrastructure for AI agents
`;

export function printBanner(): void {
  console.log(chalk.cyan(BANNER));
}

export function printTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) return;

  const colWidths = headers.map((h, i) => {
    const maxRow = rows.reduce(
      (max, row) => Math.max(max, (row[i] || "").length),
      0,
    );
    return Math.max(h.length, maxRow);
  });

  const headerLine = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join("  ");
  console.log(chalk.cyan.bold(headerLine));

  const separator = colWidths.map((w) => "─".repeat(w)).join("──");
  console.log(chalk.dim(separator));

  for (const row of rows) {
    const line = row
      .map((cell, i) => (cell || "").padEnd(colWidths[i]))
      .join("  ");
    console.log(line);
  }
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatId(id: string | number): string {
  const s = String(id);
  return s.length > 8 ? s.slice(0, 8) : s;
}

export function priorityBadge(n: number): string {
  switch (n) {
    case 1:
      return chalk.red.bold("P1");
    case 2:
      return chalk.yellow.bold("P2");
    case 3:
      return chalk.green("P3");
    case 4:
      return chalk.dim("P4");
    default:
      return chalk.dim(`P${n}`);
  }
}

export function statusBadge(s: string): string {
  switch (s?.toLowerCase()) {
    case "completed":
      return chalk.green("completed");
    case "in_progress":
    case "in progress":
      return chalk.yellow("in_progress");
    case "pending":
      return chalk.blue("pending");
    case "cancelled":
    case "canceled":
      return chalk.dim("cancelled");
    default:
      return s || "—";
  }
}

export function label(key: string, value: string): void {
  console.log(`${chalk.cyan.bold(key + ":")} ${value}`);
}

export function confirm(question: string): Promise<boolean> {
  const rl = node_readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.on("error", () => {
      rl.close();
      resolve(false);
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
