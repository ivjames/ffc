// MOCK_API_KEY bearer-auth coverage — its own file because node --test runs
// files in separate processes, so setting the env var here can't leak into
// the main integration suite (which relies on auth being off).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.MOCK_API_KEY = "test-secret";
const { createApp } = await import("./app.js");

let baseUrl;
let server;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("requests without the bearer token get 401", async () => {
  const res = await fetch(`${baseUrl}/api/v1/menu`);
  assert.equal(res.status, 401);
});

test("requests with the wrong token get 401", async () => {
  const res = await fetch(`${baseUrl}/api/v1/menu`, {
    headers: { Authorization: "Bearer wrong" },
  });
  assert.equal(res.status, 401);
});

test("requests with the right token pass; health stays open", async () => {
  const res = await fetch(`${baseUrl}/api/v1/menu`, {
    headers: { Authorization: "Bearer test-secret" },
  });
  assert.equal(res.status, 200);

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
});
