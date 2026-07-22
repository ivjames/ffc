// Integration coverage for POST /api/seed. Per-seed field validation is
// already covered by lib/validateCourse.test.js — this focuses on
// route-specific behavior: the array wrapper, upsert-on-id, transactional
// rollback on a mid-batch DB error, and the token gate (already covered end
// to end by adminGate.integration.test.js — not repeated here).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "seed-test-token";

const { app } = await import("../app.js");

let baseUrl;
let close;
let locationId;
const courseIds = [];

function postSeed(body) {
  return fetch(`${baseUrl}/api/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-token": "seed-test-token" },
    body: JSON.stringify(body),
  });
}

const PARS = Array(18).fill(3);

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(`insert into location (name, slug) values ($1, $2) returning id`, [
    `Seed Test Venue ${stamp}`,
    `seed-test-venue-${stamp}`,
  ]);
  locationId = loc.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from course where id = any($1::uuid[])`, [courseIds]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("POST /api/seed requires a non-empty array body", async () => {
  const notArray = await postSeed({ name: "x" });
  assert.equal(notArray.status, 400);
  const empty = await postSeed([]);
  assert.equal(empty.status, 400);
});

test("POST /api/seed 400s with the offending index when one entry is invalid", async () => {
  const res = await postSeed([
    { name: "Valid", theme: "test", pars: PARS },
    { name: "", theme: "test", pars: PARS },
  ]);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /seed\[1\]/);
});

test("POST /api/seed inserts fresh rows (no id) and upserts idempotently via id", async () => {
  const res = await postSeed([
    { name: "Seed Course 1", theme: "t1", pars: PARS, locationId },
    { name: "Seed Course 2", theme: "t2", pars: PARS, locationId },
  ]);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.equal(body.ids.length, 2);
  courseIds.push(...body.ids);

  const rows = await testQuery(`select name, theme from course where id = any($1::uuid[])`, [
    body.ids,
  ]);
  assert.equal(rows.rowCount, 2);

  // Re-seed the first course via its id — must update in place, not duplicate.
  const reseed = await postSeed([
    { id: body.ids[0], name: "Seed Course 1 Renamed", theme: "t1", pars: PARS, locationId },
  ]);
  assert.equal(reseed.status, 200);
  const reseedBody = await reseed.json();
  assert.deepEqual(reseedBody.ids, [body.ids[0]]);

  const renamed = await testQuery(`select name from course where id = $1`, [body.ids[0]]);
  assert.equal(renamed.rows[0].name, "Seed Course 1 Renamed");

  const total = await testQuery(`select count(*)::int as n from course where id = any($1::uuid[])`, [
    body.ids,
  ]);
  assert.equal(total.rows[0].n, 2, "no duplicate row created by the re-seed");
});

test("POST /api/seed rolls back the whole batch if one entry fails at the DB (bad locationId)", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const res = await postSeed([
    { name: `Rollback Course ${stamp}`, theme: "t", pars: PARS }, // valid, no locationId
    {
      name: `Rollback Course Bad FK ${stamp}`,
      theme: "t",
      pars: PARS,
      locationId: "00000000-0000-4000-8000-000000000000", // valid uuid shape, doesn't exist
    },
  ]);
  assert.equal(res.status, 500);

  const rows = await testQuery(`select id from course where name = $1`, [`Rollback Course ${stamp}`]);
  assert.equal(rows.rowCount, 0, "the first (otherwise-valid) entry must not have been committed");
});
