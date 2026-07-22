import assert from "node:assert/strict";
import test from "node:test";
import { isOpenableUrl } from "../dist/commands/github.js";

test("isOpenableUrl accepts http and https", () => {
  assert.equal(isOpenableUrl("https://github.com/apps/delega/installations/new"), true);
  assert.equal(isOpenableUrl("http://localhost:8787/callback"), true);
});

test("isOpenableUrl rejects non-http(s) schemes and shell-metacharacter payloads", () => {
  // A malicious/redirected API server must not be able to smuggle these into
  // the OS opener (Windows `cmd /c start` command injection, etc.).
  for (const bad of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>1</script>",
    'https://x" & calc.exe',
    "https://x && calc.exe",
    "not a url",
    "",
  ]) {
    assert.equal(isOpenableUrl(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});
