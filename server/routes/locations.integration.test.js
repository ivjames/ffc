// Integration coverage for GET/POST /api/locations (the public venue
// onboarding endpoint — distinct from routes/admin/locations.js). Field-level
// validation is already covered by lib/validateLocation.test.js; the basic
// APP_TOKEN gate + one happy-path create is already covered by
// adminGate.integration.test.js. This fills in what's left: the list read,
// upsert-on-slug, updating an existing row by id, and the slug conflict.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "public-locations-test-token";

const { app } = await import("../app.js");

let baseUrl;
let close;
const locationIds = [];

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "public-locations-test-token",
      ...opts.headers,
    },
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("GET /api/locations lists only live venues with a tzLabel, ordered by sortOrder then name", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const live = await testQuery(
    `insert into location (name, slug, tz, sort_order) values ($1, $2, 'America/Los_Angeles', 999999) returning id`,
    [`Public List Venue ${stamp}`, `public-list-venue-${stamp}`]
  );
  locationIds.push(live.rows[0].id);
  const archived = await testQuery(
    `insert into location (name, slug, archived_at) values ($1, $2, now()) returning id`,
    [`Public List Archived ${stamp}`, `public-list-archived-${stamp}`]
  );
  locationIds.push(archived.rows[0].id);

  const res = await api("/api/locations");
  assert.equal(res.status, 200);
  const rows = await res.json();
  const found = rows.find((r) => r.id === live.rows[0].id);
  assert.ok(found);
  assert.equal(found.tzLabel, "Pacific Time (PT)");
  assert.ok(!rows.some((r) => r.id === archived.rows[0].id), "archived venue excluded");

  // sort_order 999999 must be last among live venues.
  assert.equal(rows[rows.length - 1].id, live.rows[0].id);
});

test("POST /api/locations creates on first post, then updates the same row by id", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `public-upsert-${stamp}`;
  const created = await api("/api/locations", {
    method: "POST",
    body: JSON.stringify({ name: "Upsert Venue", slug, lat: 34.08867, lng: -117.67946 }),
  });
  assert.equal(created.status, 200);
  const createdJson = await created.json();
  locationIds.push(createdJson.location.id);
  assert.equal(createdJson.location.tz, "America/Los_Angeles");

  const updated = await api("/api/locations", {
    method: "POST",
    body: JSON.stringify({ id: createdJson.location.id, name: "Renamed Venue", slug }),
  });
  assert.equal(updated.status, 200);
  const updatedJson = await updated.json();
  assert.equal(updatedJson.location.id, createdJson.location.id);
  assert.equal(updatedJson.location.name, "Renamed Venue");

  const rows = await testQuery(`select count(*)::int as n from location where slug = $1`, [slug]);
  assert.equal(rows.rows[0].n, 1, "no duplicate row from the update");
});

test("POST /api/locations re-posting the same slug with no id upserts (idempotent), a different id collides with 409", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `public-conflict-${stamp}`;
  const first = await api("/api/locations", {
    method: "POST",
    body: JSON.stringify({ name: "First", slug }),
  }).then((r) => r.json());
  locationIds.push(first.location.id);

  const reupsert = await api("/api/locations", {
    method: "POST",
    body: JSON.stringify({ name: "First Again", slug }),
  });
  assert.equal(reupsert.status, 200);

  const collision = await api("/api/locations", {
    method: "POST",
    body: JSON.stringify({
      id: "00000000-0000-4000-8000-000000000002",
      name: "Colliding",
      slug,
    }),
  });
  assert.equal(collision.status, 409);
});
