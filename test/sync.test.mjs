import assert from "node:assert/strict";
import test from "node:test";
import {
  diffSyncRecords,
  parseTasksJsonl,
  serializeTasksJsonl,
  stableStringify,
  taskPathSegment,
} from "../dist/commands/sync.js";

test("stableStringify sorts object keys recursively", () => {
  assert.equal(
    stableStringify({ z: 1, a: { c: true, b: false }, list: [{ y: 2, x: 1 }] }),
    '{"a":{"b":false,"c":true},"list":[{"x":1,"y":2}],"z":1}',
  );
});

test("serializeTasksJsonl writes deterministic canonical lines", () => {
  const jsonl = serializeTasksJsonl([
    {
      id: "b",
      content: "Second",
      labels: ["z", "a"],
      links: [
        { kind: "commit", repo: "delega-dev/delega-cli", ref: "def", url: null },
        { kind: "branch", repo: "delega-dev/delega-cli", ref: "main", url: null },
      ],
      context: { z: 1, a: 2 },
      context_version: 3,
    },
    {
      id: "a",
      content: "First",
      context: {},
      context_version: 0,
    },
  ]);

  assert.equal(jsonl.split("\n").filter(Boolean).length, 2);
  assert.match(jsonl.split("\n")[0], /"id":"a"/);
  assert.match(jsonl.split("\n")[1], /"labels":\["a","z"\]/);
  assert.match(jsonl.split("\n")[1], /"links":\[{"kind":"branch"/);
});

test("parseTasksJsonl rejects non-object and content-less lines", () => {
  assert.throws(() => parseTasksJsonl('{"id":"a",\n'), /Line 1 is invalid JSON in \.delega\/tasks\.jsonl/);
  assert.throws(() => parseTasksJsonl("[]\n"), /Line 1 must be a JSON object/);
  assert.throws(() => parseTasksJsonl('{"id":"a"}\n'), /Line 1 must include content/);
});

test("parseTasksJsonl rejects path-confusing and malformed task ids", () => {
  const valid = "a".repeat(32);
  // A well-formed server id is accepted; absent id is allowed (created on push).
  assert.equal(parseTasksJsonl(`{"id":"${valid}","content":"ok"}\n`)[0].id, valid);
  assert.equal(parseTasksJsonl('{"content":"new local task"}\n')[0].id, undefined);
  // Path-traversal / query-injection ids from a hostile tasks.jsonl are rejected.
  for (const id of ["..", ".", "../agents", "abc/../def", "task?x=y", "AAAA", ""]) {
    assert.throws(
      () => parseTasksJsonl(`${JSON.stringify({ id, content: "x" })}\n`),
      /Line 1 has an invalid task id/,
      `id ${JSON.stringify(id)} should be rejected`,
    );
  }
});

test("diffSyncRecords separates local, remote, changed, and clean buckets", () => {
  const diff = diffSyncRecords(
    [
      { id: "a", content: "same", context: {}, context_version: 0 },
      { id: "b", content: "local edit", context: {}, context_version: 0 },
      { id: "c", content: "local only", context: {}, context_version: 0 },
    ],
    [
      { id: "a", content: "same", context: {}, context_version: 0 },
      { id: "b", content: "remote value", context: {}, context_version: 0 },
      { id: "d", content: "remote only", context: {}, context_version: 0 },
    ],
  );

  assert.deepEqual(diff, {
    local_only: ["c"],
    remote_only: ["d"],
    changed: ["b"],
    clean: ["a"],
  });
});

test("taskPathSegment encodes task IDs before URL path construction", () => {
  assert.equal(taskPathSegment("../agents?x=y"), "..%2Fagents%3Fx%3Dy");
  assert.equal(taskPathSegment("task/with?query=true"), "task%2Fwith%3Fquery%3Dtrue");
});

test("taskPathSegment refuses dot-segment ids that survive URL encoding", () => {
  // encodeURIComponent leaves these untouched; URL normalization would then
  // collapse "/tasks/../context" to "/context", so they must be rejected.
  for (const id of [".", ".."]) {
    assert.throws(() => taskPathSegment(id), /unsafe id/);
  }
});
