// Integration coverage for /api/admin/courses. Field-level validation is
// already covered by lib/validateCourse.test.js — this focuses on
// route-specific behavior: upsert-on-id, the FK error path, PATCH's
// merge-over-existing semantics, and archive/unarchive.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "courses-test-token";

const { app } = await import("../../app.js");

let baseUrl;
let close;
let locationId;
const courseIds = [];

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "courses-test-token",
      ...opts.headers,
    },
  });
}

const PARS = Array(18).fill(3);

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(`insert into location (name, slug) values ($1, $2) returning id`, [
    `Courses Test Venue ${stamp}`,
    `courses-test-venue-${stamp}`,
  ]);
  locationId = loc.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(
    `delete from admin_audit where entity = 'course' and entity_id = any($1::uuid[])`,
    [courseIds]
  );
  await testQuery(`delete from course where id = any($1::uuid[])`, [courseIds]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("POST /api/admin/courses creates, then upserts the same row via id", async () => {
  const created = await api("/api/admin/courses", {
    method: "POST",
    body: JSON.stringify({ name: "Course A", theme: "test", pars: PARS, locationId }),
  });
  assert.equal(created.status, 200);
  const createdJson = await created.json();
  courseIds.push(createdJson.course.id);

  const updated = await api("/api/admin/courses", {
    method: "POST",
    body: JSON.stringify({
      id: createdJson.course.id,
      name: "Course A Renamed",
      theme: "test",
      pars: PARS,
      locationId,
    }),
  });
  assert.equal(updated.status, 200);
  const updatedJson = await updated.json();
  assert.equal(updatedJson.course.id, createdJson.course.id);
  assert.equal(updatedJson.course.name, "Course A Renamed");

  const audit = await testQuery(
    `select action from admin_audit where entity = 'course' and entity_id = $1 order by created_at`,
    [createdJson.course.id]
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ["course.create", "course.update"]
  );
});

test("POST /api/admin/courses 400s when locationId doesn't reference an existing location", async () => {
  const res = await api("/api/admin/courses", {
    method: "POST",
    body: JSON.stringify({
      name: "Orphan Course",
      theme: "test",
      pars: PARS,
      locationId: "00000000-0000-4000-8000-000000000000",
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /locationId does not reference an existing location/);
});

test("PATCH /api/admin/courses/:id merges the given fields over the existing row", async () => {
  const created = await api("/api/admin/courses", {
    method: "POST",
    body: JSON.stringify({ name: "Patchable", theme: "original-theme", pars: PARS, locationId }),
  }).then((r) => r.json());
  courseIds.push(created.course.id);

  // Only send `name` — theme/pars/locationId must survive from the existing row.
  const patched = await api(`/api/admin/courses/${created.course.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "Patched Name" }),
  });
  assert.equal(patched.status, 200);
  const patchedJson = await patched.json();
  assert.equal(patchedJson.course.name, "Patched Name");
  assert.equal(patchedJson.course.theme, "original-theme");
  assert.deepEqual(patchedJson.course.pars, PARS);
  assert.equal(patchedJson.course.locationId, locationId);

  const audit = await testQuery(
    `select action from admin_audit where entity = 'course' and entity_id = $1 and action = 'course.update'`,
    [created.course.id]
  );
  assert.equal(audit.rowCount, 1);
});

test("PATCH /api/admin/courses/:id: bad uuid -> 400, missing -> 404, bad locationId -> 400", async () => {
  const bad = await api("/api/admin/courses/not-a-uuid", {
    method: "PATCH",
    body: JSON.stringify({ name: "x" }),
  });
  assert.equal(bad.status, 400);

  const missing = await api("/api/admin/courses/00000000-0000-4000-8000-000000000000", {
    method: "PATCH",
    body: JSON.stringify({ name: "x" }),
  });
  assert.equal(missing.status, 404);

  const created = await api("/api/admin/courses", {
    method: "POST",
    body: JSON.stringify({ name: "To Patch Badly", theme: "test", pars: PARS, locationId }),
  }).then((r) => r.json());
  courseIds.push(created.course.id);

  const badLocation = await api(`/api/admin/courses/${created.course.id}`, {
    method: "PATCH",
    body: JSON.stringify({ locationId: "00000000-0000-4000-8000-000000000000" }),
  });
  assert.equal(badLocation.status, 400);
});

test("POST /api/admin/courses/:id/archive + /unarchive toggles archived_at", async () => {
  const created = await api("/api/admin/courses", {
    method: "POST",
    body: JSON.stringify({ name: "Archivable Course", theme: "test", pars: PARS, locationId }),
  }).then((r) => r.json());
  courseIds.push(created.course.id);

  const archived = await api(`/api/admin/courses/${created.course.id}/archive`, {
    method: "POST",
  }).then((r) => r.json());
  assert.ok(archived.course.archivedAt);

  const unarchived = await api(`/api/admin/courses/${created.course.id}/unarchive`, {
    method: "POST",
  }).then((r) => r.json());
  assert.equal(unarchived.course.archivedAt, null);

  const missing = await api(
    "/api/admin/courses/00000000-0000-4000-8000-000000000000/archive",
    { method: "POST" }
  );
  assert.equal(missing.status, 404);
});
