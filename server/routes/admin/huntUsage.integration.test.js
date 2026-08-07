// Integration coverage for /api/admin/hunt-usage — the vision-spend rollup.
// Rows are inserted straight into hunt_scan (no vision mock needed): this
// endpoint only reads the metering table.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "hunt-usage-test-token";

const { app } = await import("../../app.js");

let baseUrl;
let close;
let locationId;
let courseId;

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "hunt-usage-test-token",
      ...opts.headers,
    },
  });
}

// One metered scan; 1500 in / 80 out mirrors a realistic Haiku verdict call.
function insertScan({ roundClientId, createdAt = "now()" }) {
  return testQuery(
    `insert into hunt_scan
       (round_client_id, player_tag, course_id, model, input_tokens, output_tokens, verified, flagged, created_at)
     values ($1, 'T01', $2, 'claude-haiku-4-5', 1500, 80, true, false, ${createdAt})`,
    [roundClientId, courseId]
  );
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Usage Test Venue ${stamp}`, `usage-test-${stamp}`]
  );
  locationId = loc.rows[0].id;

  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Usage Test Course", "test", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;

  // Current month: two rounds — 3 scans + 2 scans.
  for (let i = 0; i < 3; i++) await insertScan({ roundClientId: "usage-round-a" });
  for (let i = 0; i < 2; i++) await insertScan({ roundClientId: "usage-round-b" });
  // An older scan, 3 months back — excluded at months=1, included at months=6.
  await insertScan({
    roundClientId: "usage-round-old",
    createdAt: "now() - interval '3 months'",
  });
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from hunt_scan where course_id = $1`, [courseId]);
  await testQuery(`delete from course where id = $1`, [courseId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("GET /api/admin/hunt-usage requires admin auth", async () => {
  const res = await fetch(`${baseUrl}/api/admin/hunt-usage`);
  assert.equal(res.status, 401);
});

test("rolls up rounds, scans, tokens, and list cost per venue per month", async () => {
  const res = await api("/api/admin/hunt-usage?months=6");
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.months, 6);
  assert.equal(body.pricing.model, "claude-haiku-4-5");

  const mine = body.rows.filter((r) => r.locationId === locationId);
  assert.equal(mine.length, 2, "current month + the 3-months-back month");

  const [current, old] = mine; // ordered month desc
  assert.equal(current.locationName.startsWith("Usage Test Venue"), true);
  assert.equal(current.huntRounds, 2);
  assert.equal(current.scans, 5);
  assert.equal(current.inputTokens, 5 * 1500);
  assert.equal(current.outputTokens, 5 * 80);
  // (7500 * $1 + 400 * $5) / 1M = $0.0095 → rounds to a cent.
  assert.equal(current.apiCostUsd, 0.01);

  assert.equal(old.huntRounds, 1);
  assert.equal(old.scans, 1);
});

test("months=1 keeps only the current calendar month; out-of-range values clamp", async () => {
  const res = await api("/api/admin/hunt-usage?months=1");
  assert.equal(res.status, 200);
  const body = await res.json();
  const mine = body.rows.filter((r) => r.locationId === locationId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].scans, 5);

  const clamped = await api("/api/admin/hunt-usage?months=9999");
  assert.equal((await clamped.json()).months, 24);
  const defaulted = await api("/api/admin/hunt-usage?months=nonsense");
  assert.equal((await defaulted.json()).months, 6);
});
