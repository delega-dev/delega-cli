import assert from "node:assert/strict";
import test from "node:test";
import { formatTaskStats } from "../dist/commands/status.js";

// The real GET /stats payload shape (values from a live account on 2026-09-04).
const LIVE = {
  total: 121,
  total_tasks: 121,
  completed_today: 5,
  due_today: 1,
  overdue: 20,
  total_completed: 843,
  by_project: { Inbox: 99, Tech: 16 },
};

test("formatTaskStats renders the fields /stats actually returns", () => {
  assert.equal(
    formatTaskStats(LIVE),
    "121 open / 843 completed (5 today) / 20 overdue / 1 due today",
  );
});

test("formatTaskStats omits the empty today and due-today qualifiers", () => {
  assert.equal(
    formatTaskStats({ total_tasks: 3, total_completed: 10, completed_today: 0, due_today: 0, overdue: 0 }),
    "3 open / 10 completed / 0 overdue",
  );
});

test("formatTaskStats never reports the regression shape", () => {
  // The old line read completed_tasks / pending_tasks, which the API does not
  // send, and rendered "0 completed / 0 pending / 121 total".
  const line = formatTaskStats(LIVE);
  assert.doesNotMatch(line, /pending/);
  assert.doesNotMatch(line, /0 completed/);
});

test("formatTaskStats returns null when no task fields are present", () => {
  assert.equal(formatTaskStats(undefined), null);
  assert.equal(formatTaskStats({}), null);
  assert.equal(formatTaskStats({ total_agents: 4, active_agents: 3 }), null);
});
