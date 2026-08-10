// Integration coverage for venue hours end-to-end: the admin write path
// persists location.hours, rejects malformed hours, and the public
// GET /api/content exposes it (the source of truth the app + bot read).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "hours-test-token";

const { app } = await import("../../app.js");

let baseUrl;
let close;
const locationIds = [];
const slug = `hours-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const HOURS = {
  mon: { open: "12:00", close: "21:00" },
  fri: { open: "12:00", close: "23:00" },
  sat: "closed",
};

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-app-token": "hours-test-token", ...opts.headers },
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from admin_audit where entity = 'location' and entity_id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("admin POST persists hours and echoes them back", async () => {
  const res = await api("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({ name: "Hours Venue", slug, tz: "America/Los_Angeles", hours: HOURS }),
  });
  assert.equal(res.status, 200);
  const { location } = await res.json();
  locationIds.push(location.id);
  // "sat": "closed" round-trips; the two open days round-trip exactly.
  assert.deepEqual(location.hours, HOURS);
});

test("admin POST rejects malformed hours (400)", async () => {
  const res = await api("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({
      name: "Bad Hours",
      slug: `${slug}-bad`,
      hours: { mon: { open: "9:00", close: "21:00" } }, // 9:00 not HH:MM
    }),
  });
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.match(j.error, /open must be/);
});

test("GET /api/content exposes the venue's hours", async () => {
  const res = await fetch(`${baseUrl}/api/content`);
  const body = await res.json();
  const loc = body.locations.find((l) => l.slug === slug);
  assert.ok(loc, "created venue should appear in content");
  assert.deepEqual(loc.hours, HOURS);
});
