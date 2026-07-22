// POST /api/hunt/verify when ANTHROPIC_API_KEY is unset: the vision-configured
// check runs before any body validation or DB access, so this needs neither a
// mock nor a real database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { listenEphemeral } from "../test-support/testDb.js";

delete process.env.ANTHROPIC_API_KEY;

const { app } = await import("../app.js");

let baseUrl;
let close;

before(async () => {
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  if (close) await close();
});

test("POST /api/hunt/verify returns 503 when vision is not configured", async () => {
  const res = await fetch(`${baseUrl}/api/hunt/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Deliberately empty/invalid body — the 503 must fire before validation.
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /vision is not configured/);
});
