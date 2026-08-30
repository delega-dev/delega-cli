import assert from "node:assert/strict";
import test from "node:test";
import { deriveFleetStatus, parseStateDetail } from "../dist/commands/fleet.js";

test("parseStateDetail extracts question and options from the convention", () => {
  assert.deepEqual(
    parseStateDetail("QUESTION: Which region? / OPTIONS: us-east / eu-west / ap-south"),
    { question: "Which region?", options: ["us-east", "eu-west", "ap-south"] },
  );
});

test("parseStateDetail handles a question with no options", () => {
  assert.deepEqual(parseStateDetail("QUESTION: Provide the API key"), {
    question: "Provide the API key",
    options: [],
  });
});

test("parseStateDetail degrades to empty on nonconforming or blank detail", () => {
  assert.deepEqual(parseStateDetail("waiting for CI to finish"), {
    question: "",
    options: [],
  });
  assert.deepEqual(parseStateDetail(""), { question: "", options: [] });
  assert.deepEqual(parseStateDetail(null), { question: "", options: [] });
  assert.deepEqual(parseStateDetail(undefined), { question: "", options: [] });
});

const NOW = new Date("2026-08-30T12:00:00Z");

function fixtureTasks() {
  return [
    // Unclaimed open task
    { id: "t1", content: "Backlog item", status: "open" },
    // Working claim, lease expiring soonest
    {
      id: "t2",
      content: "Deploying service",
      status: "open",
      claimed_by_agent_id: "agent-a",
      session_state: "working",
      lease_expires_at: "2026-08-30T12:05:00Z",
      updated_at: "2026-08-30T11:50:00Z",
    },
    // Working claim, expired lease
    {
      id: "t3",
      content: "Stuck job",
      status: "open",
      claimed_by_agent_id: "agent-b",
      session_state: "working",
      lease_expires_at: "2026-08-30T11:59:00Z",
      updated_at: "2026-08-30T11:00:00Z",
    },
    // Two blockers, out of order by age
    {
      id: "t4",
      content: "Newer blocker",
      status: "open",
      claimed_by_agent_id: "agent-c",
      session_state: "waiting_input",
      session_state_detail: "QUESTION: Approve spend? / OPTIONS: yes / no",
      updated_at: "2026-08-30T11:45:00Z",
    },
    {
      id: "t5",
      content: "Older blocker",
      status: "open",
      claimed_by_agent_id: "agent-d",
      session_state: "waiting_input",
      session_state_detail: "needs credentials pasted",
      updated_at: "2026-08-30T09:00:00Z",
    },
    // Errored claim
    {
      id: "t6",
      content: "Broken import",
      status: "open",
      claimed_by_agent_id: "agent-e",
      session_state: "errored",
      session_state_detail: "disk full",
      updated_at: "2026-08-30T10:00:00Z",
    },
    // Completed task must be ignored even if the API ever returns it
    { id: "t7", content: "Done", status: "completed" },
  ];
}

test("deriveFleetStatus counts, sorts, and parses", () => {
  const s = deriveFleetStatus(fixtureTasks(), NOW);

  assert.deepEqual(s.counts, {
    open: 6,
    unclaimed: 1,
    claimed: 5,
    working: 2,
    waitingInput: 2,
    errored: 1,
  });
  assert.equal(s.quiet, false);
  assert.equal(s.generatedAt, NOW.toISOString());

  // waitingInput oldest-first, conforming detail parsed, raw detail kept
  assert.deepEqual(
    s.waitingInput.map((i) => i.id),
    ["t5", "t4"],
  );
  assert.equal(s.waitingInput[1].question, "Approve spend?");
  assert.deepEqual(s.waitingInput[1].options, ["yes", "no"]);
  assert.equal(s.waitingInput[0].question, "");
  assert.equal(s.waitingInput[0].detail, "needs credentials pasted");

  // working sorted by soonest lease expiry; expired lease is negative
  assert.deepEqual(
    s.working.map((i) => i.id),
    ["t3", "t2"],
  );
  assert.equal(s.working[0].leaseRemainingSeconds, -60);
  assert.equal(s.working[1].leaseRemainingSeconds, 300);

  assert.equal(s.errored.length, 1);
  assert.equal(s.errored[0].detail, "disk full");
});

test("deriveFleetStatus reports a quiet fleet", () => {
  const s = deriveFleetStatus(
    [
      { id: "t1", content: "Backlog", status: "open" },
      {
        id: "t2",
        content: "Claimed but no session state",
        status: "open",
        claimed_by_agent_id: "agent-a",
      },
    ],
    NOW,
  );
  assert.equal(s.quiet, true);
  assert.deepEqual(s.counts, {
    open: 2,
    unclaimed: 1,
    claimed: 1,
    working: 0,
    waitingInput: 0,
    errored: 0,
  });
  assert.deepEqual(s.waitingInput, []);
  assert.deepEqual(s.errored, []);
  assert.deepEqual(s.working, []);
});

test("deriveFleetStatus tolerates missing and malformed fields", () => {
  const s = deriveFleetStatus(
    [
      {
        id: "t1",
        content: "No lease timestamp",
        status: "open",
        claimed_by_agent_id: "agent-a",
        session_state: "working",
      },
      {
        id: "t2",
        content: "Bad lease timestamp",
        status: "open",
        claimed_by_agent_id: "agent-b",
        session_state: "working",
        lease_expires_at: "not-a-date",
      },
    ],
    NOW,
  );
  assert.equal(s.working.length, 2);
  assert.equal(s.working[0].leaseRemainingSeconds, null);
  assert.equal(s.working[1].leaseRemainingSeconds, null);
});
