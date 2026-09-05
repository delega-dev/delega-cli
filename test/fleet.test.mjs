import assert from "node:assert/strict";
import test from "node:test";
import {
  FLEET_MAX_PAGES,
  FLEET_PAGE_SIZE,
  agentNameMap,
  daysOverdue,
  deriveFleetStatus,
  fetchOpenTasks,
  openTasksPath,
  parseStateDetail,
} from "../dist/commands/fleet.js";

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
    overdue: 0,
    dueSoon: 0,
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
    overdue: 0,
    dueSoon: 0,
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

test("agentNameMap prefers display_name, tolerates junk, and drives claimedByName", () => {
  const names = agentNameMap([
    { id: "a1", name: "codex", display_name: "Codex (rm-omarchy)" },
    { id: "a2", name: "omarchy-claude" },
    { id: "", name: "ghost" },
    null,
    { id: "a3" },
  ]);
  assert.deepEqual(names, { a1: "Codex (rm-omarchy)", a2: "omarchy-claude" });
  assert.deepEqual(agentNameMap(null), {});

  const s = deriveFleetStatus(
    [
      {
        id: "t1", content: "Named claim", status: "open",
        claimed_by_agent_id: "a2", session_state: "working",
      },
      {
        id: "t2", content: "Unknown agent", status: "open",
        claimed_by_agent_id: "zz", session_state: "working",
      },
    ],
    NOW,
    names,
  );
  assert.equal(s.working[0].claimedByName, "omarchy-claude");
  assert.equal(s.working[1].claimedByName, "");
});

test("daysOverdue computes whole local days and rejects junk", () => {
  const now = new Date("2026-08-30T15:00:00");
  assert.equal(daysOverdue("2026-08-27", now), 3);
  assert.equal(daysOverdue("2026-08-30", now), 0);
  assert.equal(daysOverdue("2026-09-04", now), -5);
  assert.equal(daysOverdue("soon", now), null);
  assert.equal(daysOverdue(null, now), null);
});

test("deriveFleetStatus builds overdue and dueSoon from all open tasks", () => {
  const now = new Date("2026-08-30T15:00:00");
  const s = deriveFleetStatus(
    [
      { id: "d1", content: "Very late unclaimed", status: "open", due_date: "2026-08-20" },
      { id: "d2", content: "A bit late, claimed+working", status: "open", due_date: "2026-08-29",
        claimed_by_agent_id: "a1", session_state: "working" },
      { id: "d3", content: "Due tomorrow", status: "open", due_date: "2026-08-31" },
      { id: "d4", content: "Due next month", status: "open", due_date: "2026-09-30" },
      { id: "d5", content: "No due date", status: "open" },
      { id: "d6", content: "Done late", status: "completed", due_date: "2026-08-01" },
    ],
    now,
    { a1: "codex" },
  );
  assert.deepEqual(s.overdue.map((i) => [i.id, i.daysOverdue]), [["d1", 10], ["d2", 1]]);
  assert.equal(s.overdue[1].claimedByName, "codex");
  assert.deepEqual(s.dueSoon.map((i) => [i.id, i.daysOverdue]), [["d3", -1]]);
  assert.equal(s.counts.overdue, 2);
  assert.equal(s.counts.dueSoon, 1);
  // quiet still reflects claim states only (d2 is working)
  assert.equal(s.quiet, false);
});

test("dueSoon window is configurable", () => {
  const now = new Date("2026-08-30T15:00:00");
  const wide = deriveFleetStatus(
    [{ id: "d4", content: "Due next month", status: "open", due_date: "2026-09-25" }],
    now, {}, 30,
  );
  assert.equal(wide.counts.dueSoon, 1);
});

// --- Paging regression -----------------------------------------------------
//
// Stand-in for the API's list endpoint: ORDER BY priority ASC, created_at DESC,
// completed rows included unless completed=false (which also hides superseded
// records), limit defaulting to 100 and capped at 500, offset defaulting to 0.
function fakeListEndpoint(db) {
  const calls = [];
  const sorted = db.slice().sort((a, b) =>
    a.priority - b.priority || b.created_at.localeCompare(a.created_at));
  const fetcher = async (path) => {
    calls.push(path);
    const q = new URL(path, "http://api.test").searchParams;
    let rows = sorted;
    if (q.get("completed") === "false") {
      rows = rows.filter((t) => t.status !== "completed" && !t.superseded_at);
    } else if (q.get("completed") === "true") {
      rows = rows.filter((t) => t.status === "completed");
    }
    const limit = Math.min(Math.max(parseInt(q.get("limit") ?? "100", 10) || 100, 1), 500);
    const offset = Math.max(parseInt(q.get("offset") ?? "0", 10) || 0, 0);
    return rows.slice(offset, offset + limit);
  };
  return { fetcher, calls };
}

// A backlog shaped like the one that broke: more than a page of top-priority
// tasks (most of them completed), hundreds of open lower-priority tasks, and
// the only claims sitting at the bottom of the sort order.
function crowdedBacklog() {
  const db = [];
  const stamp = (i) => `2026-08-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`;
  for (let i = 0; i < 90; i++) {
    db.push({ id: `done-${i}`, content: `Finished P1 ${i}`, status: "completed", priority: 1, created_at: stamp(i) });
  }
  for (let i = 0; i < 40; i++) {
    db.push({ id: `p1-${i}`, content: `Open P1 ${i}`, status: "open", priority: 1, created_at: stamp(i) });
  }
  for (let i = 0; i < 560; i++) {
    db.push({ id: `p2-${i}`, content: `Open P2 ${i}`, status: "open", priority: 2, created_at: stamp(i) });
  }
  db.push(
    { id: "w1", content: "Working, P3", status: "claimed", priority: 3, created_at: stamp(1),
      claimed_by_agent_id: "agent-a", session_state: "working", lease_expires_at: "2026-08-30T12:05:00Z" },
    { id: "w2", content: "Working, P3", status: "claimed", priority: 3, created_at: stamp(2),
      claimed_by_agent_id: "agent-b", session_state: "working", lease_expires_at: "2026-08-30T12:10:00Z" },
    { id: "q1", content: "Blocked, P4", status: "claimed", priority: 4, created_at: stamp(3),
      claimed_by_agent_id: "agent-c", session_state: "waiting_input",
      session_state_detail: "QUESTION: Ship it? / OPTIONS: yes / no", updated_at: "2026-08-30T11:00:00Z" },
    { id: "e1", content: "Errored, P4", status: "claimed", priority: 4, created_at: stamp(4),
      claimed_by_agent_id: "agent-d", session_state: "errored", session_state_detail: "build failed" },
    // Superseded records: not completed, but no longer active work. One even
    // still carries a stale working claim and must not count.
    { id: "s1", content: "Superseded plan", status: "open", priority: 2, created_at: stamp(5),
      superseded_at: "2026-08-29T00:00:00Z" },
    { id: "s2", content: "Superseded claim", status: "claimed", priority: 3, created_at: stamp(6),
      claimed_by_agent_id: "agent-e", session_state: "working", superseded_at: "2026-08-29T00:00:00Z" },
  );
  return db;
}

test("the unfiltered first page hides every claim (the regression)", async () => {
  const { fetcher } = fakeListEndpoint(crowdedBacklog());
  const firstPage = await fetcher("/tasks");
  assert.equal(firstPage.length, 100);
  assert.ok(firstPage.every((t) => t.priority === 1));
  const s = deriveFleetStatus(firstPage, NOW);
  assert.equal(s.counts.claimed, 0);
  assert.equal(s.counts.working, 0);
  assert.equal(s.quiet, true);
});

test("fetchOpenTasks pages through open tasks so claims past row 100 are counted", async () => {
  const { fetcher, calls } = fakeListEndpoint(crowdedBacklog());
  const tasks = await fetchOpenTasks(fetcher);

  // 40 open P1 + 560 open P2 + 4 claims = 604 open, non-superseded tasks:
  // one full page of 500, then a short page of 104 that ends the walk.
  assert.deepEqual(calls, [
    "/tasks?completed=false&limit=500&offset=0",
    "/tasks?completed=false&limit=500&offset=500",
  ]);
  assert.equal(tasks.length, 604);
  assert.ok(tasks.every((t) => t.status !== "completed"));
  assert.ok(!tasks.some((t) => t.id === "s1" || t.id === "s2"));

  const s = deriveFleetStatus(tasks, NOW);
  assert.deepEqual(s.counts, {
    open: 604,
    unclaimed: 600,
    claimed: 4,
    working: 2,
    waitingInput: 1,
    errored: 1,
    overdue: 0,
    dueSoon: 0,
  });
  assert.equal(s.quiet, false);
  assert.deepEqual(s.working.map((i) => i.id), ["w1", "w2"]);
  assert.deepEqual(s.waitingInput.map((i) => i.id), ["q1"]);
  assert.equal(s.waitingInput[0].question, "Ship it?");
  assert.deepEqual(s.errored.map((i) => i.id), ["e1"]);
});

test("deriveFleetStatus drops superseded records even from an unfiltered listing", () => {
  const s = deriveFleetStatus(
    [
      { id: "t1", content: "Live claim", status: "claimed", claimed_by_agent_id: "a", session_state: "working" },
      { id: "t2", content: "Superseded claim", status: "claimed", claimed_by_agent_id: "b",
        session_state: "working", superseded_at: "2026-08-29T00:00:00Z" },
      { id: "t3", content: "Superseded backlog", status: "open", superseded_at: "2026-08-29T00:00:00Z" },
    ],
    NOW,
  );
  assert.equal(s.counts.open, 1);
  assert.equal(s.counts.working, 1);
  assert.deepEqual(s.working.map((i) => i.id), ["t1"]);
});

test("fetchOpenTasks stops on an empty page after an exactly-full one", async () => {
  const full = Array.from({ length: FLEET_PAGE_SIZE }, (_, i) => ({ id: `t${i}`, content: "x", status: "open" }));
  const calls = [];
  const tasks = await fetchOpenTasks(async (path) => {
    calls.push(path);
    return calls.length === 1 ? full : [];
  });
  assert.equal(tasks.length, FLEET_PAGE_SIZE);
  assert.deepEqual(calls, [openTasksPath(0), openTasksPath(FLEET_PAGE_SIZE)]);
});

test("fetchOpenTasks de-duplicates rows that shift between pages", async () => {
  // A task created mid-walk pushes the last row of page 1 onto page 2.
  const pageSize = 3;
  const pages = [
    [{ id: "a", content: "", status: "open" }, { id: "b", content: "", status: "open" }, { id: "c", content: "", status: "open" }],
    [{ id: "c", content: "", status: "open" }, { id: "d", content: "", status: "open" }],
  ];
  const tasks = await fetchOpenTasks(async () => pages.shift() ?? [], pageSize);
  assert.deepEqual(tasks.map((t) => t.id), ["a", "b", "c", "d"]);
});

test("fetchOpenTasks tolerates junk responses and bounds the walk", async () => {
  assert.deepEqual(await fetchOpenTasks(async () => ({ error: "nope" })), []);
  assert.deepEqual(await fetchOpenTasks(async () => [null, 42, { id: "ok", content: "", status: "open" }]), [
    { id: "ok", content: "", status: "open" },
  ]);

  // A server that never returns a short page must not loop forever.
  let calls = 0;
  const full = Array.from({ length: 2 }, (_, i) => ({ id: `p${i}`, content: "", status: "open" }));
  await fetchOpenTasks(async () => { calls++; return full.map((t) => ({ ...t, id: `${t.id}-${calls}` })); }, 2);
  assert.equal(calls, FLEET_MAX_PAGES);
});
