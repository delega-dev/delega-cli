import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { apiRequest } from "../dist/api.js";
import { getCloudflareAccessHeaders } from "../dist/config.js";

const originalFetch = globalThis.fetch;
const originalEnvironment = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnvironment, DELEGA_API_KEY: "dlg_test_key" };
  delete process.env.DELEGA_CF_ACCESS_CLIENT_ID;
  delete process.env.DELEGA_CF_ACCESS_CLIENT_SECRET;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnvironment };
});

test("apiRequest sends paired Cloudflare Access service-token headers", async () => {
  process.env.DELEGA_CF_ACCESS_CLIENT_ID = "access-client-id";
  process.env.DELEGA_CF_ACCESS_CLIENT_SECRET = "access-client-secret";
  let capturedHeaders;
  globalThis.fetch = async (_url, init) => {
    capturedHeaders = init.headers;
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await apiRequest("GET", "/tasks");

  assert.equal(result.ok, true);
  assert.equal(capturedHeaders["CF-Access-Client-Id"], "access-client-id");
  assert.equal(capturedHeaders["CF-Access-Client-Secret"], "access-client-secret");
  assert.equal(capturedHeaders["X-Agent-Key"], "dlg_test_key");
});

test("partial Cloudflare Access configuration fails without exposing the value", () => {
  const secret = "must-not-appear-in-errors";
  assert.throws(
    () => getCloudflareAccessHeaders({ DELEGA_CF_ACCESS_CLIENT_SECRET: secret }),
    (error) => {
      assert.match(error.message, /Set both DELEGA_CF_ACCESS_CLIENT_ID and DELEGA_CF_ACCESS_CLIENT_SECRET/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});
