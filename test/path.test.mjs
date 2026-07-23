import assert from "node:assert/strict";
import test from "node:test";
import { pathSegment } from "../dist/path.js";

test("pathSegment encodes path data without changing route structure", () => {
  assert.equal(pathSegment("../agents?admin=true"), "..%2Fagents%3Fadmin%3Dtrue");
});

test("pathSegment rejects URL-normalized dot segments", () => {
  for (const id of ["", ".", ".."]) {
    assert.throws(() => pathSegment(id), /unsafe id/);
  }
});
