// POST /api/hunt/verify when ANTHROPIC_API_KEY is unset: the vision-configured
// check is the handler's first act — before any body validation — so an empty
// body still gets the 503. The route's tenant() middleware runs ahead of the
// handler and fails CLOSED on a DB error (lib/tenant.js), so this needs the
// test database for resolution to succeed; no vision mock is needed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, listenEphemeral } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");

// AFTER the app import, not before: app.js pulls in dotenv, which re-sets
// the key from any real server/.env (e.g. the droplet's, under the deploy
// test gate). isVisionConfigured() reads process.env per call, so deleting
// here reliably simulates "unconfigured" regardless of ambient config.
delete process.env.ANTHROPIC_API_KEY;

let baseUrl;
let close;

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  if (close) await close();
  const { pool } = await import("../db.js");
  await pool.end();
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
