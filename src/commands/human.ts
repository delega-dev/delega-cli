import { Command, InvalidArgumentError } from "commander";
import { apiCall } from "../api.js";

export function nonnegativeInteger(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new InvalidArgumentError("Use a non-negative safe integer.");
  }
  return Number(value);
}

function taskId(value: string): string {
  if (!/^[a-f0-9]{32}$/.test(value)) throw new InvalidArgumentError("Use the exact 32-character internal task ID.");
  return value;
}

function timeout(value: string): number {
  const seconds = nonnegativeInteger(value);
  if (seconds < 60 || seconds > 1200) throw new InvalidArgumentError("Timeout must be 60–1200 seconds.");
  return seconds;
}

function criterion(value: string, previous: string[]): string[] {
  if (!value.trim() || value.length > 65 || /[\r\n]/.test(value) || value.includes(" / ")) {
    throw new InvalidArgumentError("Use a nonblank criterion of at most 65 characters, without line breaks or option delimiters.");
  }
  if (previous.length >= 3 || previous.includes(value)) {
    throw new InvalidArgumentError("Use one to three distinct criteria.");
  }
  return [...previous, value];
}

function printRequest(request: any, json: boolean) {
  if (json) { console.log(JSON.stringify(request, null, 2)); return; }
  console.log(`Human request: ${request.task_id}`);
  console.log(`Phase: ${request.phase}; request version: ${request.version}`);
  if (request.result) {
    console.log(`Verification: ${request.result.verification}`);
    console.log("Physical state independently verified: " + String(request.result.physical_state_independently_verified));
  } else {
    console.log("Result: pending or unverified");
  }
}

type Request = (method: string, path: string, body?: unknown) => Promise<unknown>;
export function createHumanCommand(request: Request = apiCall): Command {
  const command = new Command("human").description("Register and inspect private human checklist requests");
  command.command("register")
    .description("Register an existing eligible task; does not start execution or send a message")
    .argument("<task-id>", "Exact existing task ID", taskId)
    .requiredOption("--criterion <text>", "Short checklist criterion (repeat up to three times)", criterion, [])
    .requiredOption("--expected-revision <n>", "Current task revision", nonnegativeInteger)
    .option("--timeout-seconds <n>", "Maximum run length, 60–1200 seconds", timeout, 1200)
    .option("--json", "Output the complete bounded API response")
    .action(async (id, options) => {
      const result = await request("POST", `/tasks/${id}/human-request`, {
        kind: "checklist", recipient_ref: "self", criteria: options.criterion,
        expected_revision: options.expectedRevision, timeout_seconds: options.timeoutSeconds,
      });
      printRequest(result, options.json);
    });
  for (const [name, suffix] of [["status", ""], ["result", "/result"]]) {
    command.command(name).description("Read the registered request without starting or changing it")
      .argument("<task-id>", "Exact existing task ID", taskId)
      .option("--json", "Output the complete bounded API response")
      .action(async (id, options) => printRequest(await request("GET", `/tasks/${id}/human-request${suffix}`), options.json));
  }
  command.command("cancel").description("Record cancellation; the existing executor releases its own claim")
    .argument("<task-id>", "Exact existing task ID", taskId)
    .requiredOption("--expected-version <n>", "Current request version from human status", nonnegativeInteger)
    .option("--json", "Output the complete bounded API response")
    .action(async (id, options) => printRequest(await request("POST", `/tasks/${id}/human-request/cancel`,
      { expected_version: options.expectedVersion }), options.json));
  return command;
}
