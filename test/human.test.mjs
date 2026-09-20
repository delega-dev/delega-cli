import assert from "node:assert/strict";
import test from "node:test";
import { createHumanCommand } from "../dist/commands/human.js";
import { tasksCommand } from "../dist/commands/tasks.js";

const id = "a".repeat(32);
async function invoke(args) {
  const calls = [], output = [];
  const command = createHumanCommand(async (...call) => {
    calls.push(call); return { task_id: id, phase: "prepared", version: 4, result: null };
  });
  for (const child of [command, ...command.commands]) child.exitOverride().configureOutput({ writeErr() {} });
  const log = console.log;
  console.log = text => output.push(text);
  try { await command.parseAsync(["node", "human", ...args]); }
  finally { console.log = log; }
  return { calls, output };
}

test("registration preserves exact scope and revision and never invokes execution", async () => {
  const { calls, output } = await invoke(["register", id, "--criterion", "Room checked",
    "--expected-revision", "3", "--timeout-seconds", "600", "--json"]);
  assert.deepEqual(calls, [["POST", "/tasks/" + id + "/human-request", {
    kind: "checklist", recipient_ref: "self", criteria: ["Room checked"], expected_revision: 3, timeout_seconds: 600,
  }]]);
  assert.equal(JSON.parse(output[0]).result, null);
});
test("read-only status/result and versioned cancellation use their distinct routes", async () => {
  assert.deepEqual((await invoke(["status", id])).calls, [["GET", "/tasks/" + id + "/human-request"]]);
  assert.deepEqual((await invoke(["result", id])).calls, [["GET", "/tasks/" + id + "/human-request/result"]]);
  assert.deepEqual((await invoke(["cancel", id, "--expected-version", "4"])).calls,
    [["POST", "/tasks/" + id + "/human-request/cancel", { expected_version: 4 }]]);
});
test("invalid bounds, IDs, versions and expanded options fail before a request", async () => {
  const base = ["register", id, "--criterion", "Room checked", "--expected-revision", "0"];
  for (const extra of [["--criterion", "Room checked"], ["--criterion", "x / y"], ["--timeout-seconds", "1201"],
    ["--expected-revision", "12junk"], ["--recipient", "someone"], ["--expected-revision", "-1"]]) {
    await assert.rejects(invoke([...base, ...extra]));
  }
  await assert.rejects(invoke(["status", "../agents"]));
  await assert.rejects(invoke(["cancel", id]));
});
test("ordinary task commands carry evidence, assignment and completion fences", async () => {
  const originalFetch = globalThis.fetch, originalLog = console.log;
  const priorKey = process.env.DELEGA_AGENT_KEY, priorUrl = process.env.DELEGA_API_URL;
  process.env.DELEGA_AGENT_KEY = "synthetic-key"; process.env.DELEGA_API_URL = "https://api.delega.dev/v1";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id, content: "Ready", completed: 1 }));
  };
  console.log = () => {};
  try {
    await tasksCommand.parseAsync(["node", "tasks", "create", "Ready", "--labels", "autopilot-hold",
      "--assign-to", "agt_existing", "--evidence-required", "--json"]);
    await tasksCommand.parseAsync(["node", "tasks", "complete", id, "--expected-revision", "12",
      "--claim-generation", "2", "--evidence-json", '[{"kind":"artifact_url","ref":"https://example.test/evidence"}]', "--json"]);
    assert.equal(calls[0].body.assigned_to_agent_id, "agt_existing");
    assert.equal(calls[0].body.evidence_policy, "required");
    assert.equal(calls[1].body.expected_revision, 12);
    assert.equal(calls[1].body.claim_generation, 2);
    assert.equal(calls[1].body.evidence[0].kind, "artifact_url");
  } finally {
    globalThis.fetch = originalFetch; console.log = originalLog;
    if (priorKey === undefined) delete process.env.DELEGA_AGENT_KEY; else process.env.DELEGA_AGENT_KEY = priorKey;
    if (priorUrl === undefined) delete process.env.DELEGA_API_URL; else process.env.DELEGA_API_URL = priorUrl;
  }
});
