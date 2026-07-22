// Integration coverage for /api/admin/locations. Field-level validation
// (name/slug/lat-lng/tz) is already covered by lib/validateLocation.test.js —
// this focuses on route-specific behavior: org scoping, the FK error path,
// nested courses, and archive/unarchive.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "locations-test-token";

const { app } = await import("../../app.js");

let baseUrl;
let close;
let orgId;
const locationIds = [];
const courseIds = [];

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "locations-test-token",
      ...opts.headers,
    },
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const org = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Locations Test Org ${stamp}`,
    `locations-test-org-${stamp}`,
  ]);
  orgId = org.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from course where id = any($1::uuid[])`, [courseIds]);
  await testQuery(
    `delete from admin_audit where entity = 'location' and entity_id = any($1::uuid[])`,
    [locationIds]
  );
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from org where id = $1`, [orgId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("POST /api/admin/locations creates with an orgId and 400s on a nonexistent orgId", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created = await api("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({ name: "Org Scoped Venue", slug: `org-venue-${stamp}`, orgId }),
  });
  assert.equal(created.status, 200);
  const createdJson = await created.json();
  assert.equal(createdJson.location.orgId, orgId);
  locationIds.push(createdJson.location.id);

  const badOrg = await api("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({
      name: "Bad Org Venue",
      slug: `bad-org-venue-${stamp}`,
      orgId: "00000000-0000-4000-8000-000000000000",
    }),
  });
  assert.equal(badOrg.status, 400);
  const badOrgJson = await badOrg.json();
  assert.match(badOrgJson.error, /orgId does not reference an existing org/);
});

test("GET /api/admin/locations?orgId= filters to that org; rejects a non-uuid orgId", async () => {
  const badOrgId = await api("/api/admin/locations?orgId=not-a-uuid");
  assert.equal(badOrgId.status, 400);

  const list = await (await api(`/api/admin/locations?orgId=${orgId}`)).json();
  assert.ok(list.length >= 1);
  assert.ok(list.every((l) => l.orgId === orgId));
});

test("GET /api/admin/locations/:id returns the location plus its live courses", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await api("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({ name: "Venue With Courses", slug: `venue-courses-${stamp}` }),
  }).then((r) => r.json());
  locationIds.push(loc.location.id);

  const liveCourse = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Live Course", "test", Array(18).fill(3), loc.location.id]
  );
  courseIds.push(liveCourse.rows[0].id);
  const archivedCourse = await testQuery(
    `insert into course (name, theme, pars, location_id, archived_at)
       values ($1, $2, $3, $4, now()) returning id`,
    ["Archived Course", "test", Array(18).fill(3), loc.location.id]
  );
  courseIds.push(archivedCourse.rows[0].id);

  const res = await api(`/api/admin/locations/${loc.location.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.location.id, loc.location.id);
  assert.equal(body.courses.length, 1);
  assert.equal(body.courses[0].id, liveCourse.rows[0].id);

  const withArchived = await (
    await api(`/api/admin/locations/${loc.location.id}/courses?archived=1`)
  ).json();
  assert.equal(withArchived.length, 2);

  const missing = await api("/api/admin/locations/00000000-0000-4000-8000-000000000000");
  assert.equal(missing.status, 404);
  const bad = await api("/api/admin/locations/not-a-uuid");
  assert.equal(bad.status, 400);
});

test("POST /api/admin/locations/:id/archive + /unarchive toggles archived_at and hides it from the default list", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await api("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({ name: "Archivable Venue", slug: `archivable-venue-${stamp}` }),
  }).then((r) => r.json());
  locationIds.push(loc.location.id);

  const archiveRes = await api(`/api/admin/locations/${loc.location.id}/archive`, {
    method: "POST",
  });
  assert.equal(archiveRes.status, 200);
  const archived = await archiveRes.json();
  assert.ok(archived.location.archivedAt);

  const defaultList = await (await api("/api/admin/locations")).json();
  assert.ok(!defaultList.some((l) => l.id === loc.location.id));
  const archivedList = await (await api("/api/admin/locations?archived=1")).json();
  assert.ok(archivedList.some((l) => l.id === loc.location.id));

  const unarchiveRes = await api(`/api/admin/locations/${loc.location.id}/unarchive`, {
    method: "POST",
  });
  const unarchived = await unarchiveRes.json();
  assert.equal(unarchived.location.archivedAt, null);

  const audit = await testQuery(
    `select action from admin_audit where entity = 'location' and entity_id = $1 order by created_at`,
    [loc.location.id]
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ["location.create", "location.archive", "location.unarchive"]
  );
});
