// Integration coverage for org_admin scoping across orgs/locations/courses/
// overview. Two separate org_admin accounts (org A, org B) exercise the
// isolation: each must see and manage only their own org's data, and a
// session-based super_admin (not just APP_TOKEN) must remain unrestricted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "org-scoping-test-token";

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

let baseUrl;
let close;
let orgAId, orgBId;
let locationAId, locationBId, locationBSlug;
let courseAId, courseBId;
let orgAdminACookie, orgAdminBCookie, superAdminSessionCookie;
const userIds = [];

async function loginCookie(email, password) {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.headers.get("set-cookie").split(";")[0];
}

function as(cookie) {
  return (path, opts = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Cookie: cookie, ...opts.headers },
    });
}

const PARS = Array(18).fill(3);

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const orgA = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Scope Org A ${stamp}`,
    `scope-org-a-${stamp}`,
  ]);
  orgAId = orgA.rows[0].id;
  const orgB = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Scope Org B ${stamp}`,
    `scope-org-b-${stamp}`,
  ]);
  orgBId = orgB.rows[0].id;

  const locA = await testQuery(
    `insert into location (name, slug, org_id) values ($1, $2, $3) returning id`,
    [`Scope Location A ${stamp}`, `scope-location-a-${stamp}`, orgAId]
  );
  locationAId = locA.rows[0].id;
  locationBSlug = `scope-location-b-${stamp}`;
  const locB = await testQuery(
    `insert into location (name, slug, org_id) values ($1, $2, $3) returning id`,
    [`Scope Location B ${stamp}`, locationBSlug, orgBId]
  );
  locationBId = locB.rows[0].id;

  const courseA = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Scope Course A", "test", PARS, locationAId]
  );
  courseAId = courseA.rows[0].id;
  const courseB = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Scope Course B", "test", PARS, locationBId]
  );
  courseBId = courseB.rows[0].id;

  const orgAdminAEmail = `org-admin-a-${stamp}@example.com`;
  const orgAdminBEmail = `org-admin-b-${stamp}@example.com`;
  const superAdminEmail = `super-admin-${stamp}@example.com`;
  const password = "test-password-1";

  const [a, b, s] = await Promise.all([
    testQuery(
      `insert into admin_user (email, role, org_id, password_hash) values ($1, 'org_admin', $2, $3) returning id`,
      [orgAdminAEmail, orgAId, hashPassword(password)]
    ),
    testQuery(
      `insert into admin_user (email, role, org_id, password_hash) values ($1, 'org_admin', $2, $3) returning id`,
      [orgAdminBEmail, orgBId, hashPassword(password)]
    ),
    testQuery(
      `insert into admin_user (email, role, password_hash) values ($1, 'super_admin', $2) returning id`,
      [superAdminEmail, hashPassword(password)]
    ),
  ]);
  userIds.push(a.rows[0].id, b.rows[0].id, s.rows[0].id);

  orgAdminACookie = await loginCookie(orgAdminAEmail, password);
  orgAdminBCookie = await loginCookie(orgAdminBEmail, password);
  superAdminSessionCookie = await loginCookie(superAdminEmail, password);
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from admin_user where id = any($1::uuid[])`, [userIds]);
  await testQuery(`delete from course where id in ($1, $2)`, [courseAId, courseBId]);
  await testQuery(`delete from location where id in ($1, $2)`, [locationAId, locationBId]);
  await testQuery(`delete from org where id in ($1, $2)`, [orgAId, orgBId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("orgs: an org_admin sees only their own org, never another's, and can't manage orgs at all", async () => {
  const asA = as(orgAdminACookie);

  const own = await asA(`/api/admin/orgs/${orgAId}`);
  assert.equal(own.status, 200);
  const other = await asA(`/api/admin/orgs/${orgBId}`);
  assert.equal(other.status, 403);

  const list = await (await asA("/api/admin/orgs")).json();
  assert.deepEqual(
    list.map((o) => o.id),
    [orgAId]
  );

  const create = await asA("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({ name: "Sneaky New Org", slug: `sneaky-${Date.now()}` }),
  });
  assert.equal(create.status, 403);

  const archive = await asA(`/api/admin/orgs/${orgAId}/archive`, { method: "POST" });
  assert.equal(archive.status, 403, "org_admin can't archive even their own org");
});

test("locations: an org_admin is confined to their own org's locations", async () => {
  const asA = as(orgAdminACookie);

  const ownGet = await asA(`/api/admin/locations/${locationAId}`);
  assert.equal(ownGet.status, 200);
  const otherGet = await asA(`/api/admin/locations/${locationBId}`);
  assert.equal(otherGet.status, 403);

  const list = await (await asA("/api/admin/locations")).json();
  assert.ok(list.every((l) => l.orgId === orgAId));
  assert.ok(!list.some((l) => l.id === locationBId));

  // Passing someone else's orgId in the query must NOT leak org B's data.
  const filtered = await (await asA(`/api/admin/locations?orgId=${orgBId}`)).json();
  assert.ok(!filtered.some((l) => l.id === locationBId));

  const otherArchive = await asA(`/api/admin/locations/${locationBId}/archive`, { method: "POST" });
  assert.equal(otherArchive.status, 403);

  const otherCourses = await asA(`/api/admin/locations/${locationBId}/courses`);
  assert.equal(otherCourses.status, 403);
});

test("locations: creating a location forces org_id to the caller's own org, even if a different orgId is submitted", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const res = await as(orgAdminACookie)("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({
      name: "Org Admin A's New Venue",
      slug: `org-a-new-venue-${stamp}`,
      orgId: orgBId, // attempting to claim org B — must be silently overridden
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.location.orgId, orgAId);
  await testQuery(`delete from location where id = $1`, [body.location.id]);
});

test("locations: an org_admin cannot hijack another org's location by submitting its slug with no id", async () => {
  // Regression for a Codex-flagged P1: the ownership check only ran inside
  // `if (row.id)`, but the insert upserts ON CONFLICT (slug) even with no id
  // — so submitting org B's (publicly visible) slug with no id would update
  // org B's location and reassign it to org A via `coalesce(excluded.org_id,
  // location.org_id)`, since org_id was already forced to the caller's org.
  const res = await as(orgAdminACookie)("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({ name: "Hijacked Name", slug: locationBSlug }),
  });
  assert.equal(res.status, 403);

  const stillOwnedByB = await testQuery(`select org_id as "orgId", name from location where id = $1`, [
    locationBId,
  ]);
  assert.equal(stillOwnedByB.rows[0].orgId, orgBId, "location B must still belong to org B");
  assert.notEqual(stillOwnedByB.rows[0].name, "Hijacked Name", "location B's name must be untouched");
});

test("courses: an org_admin can only create/patch/archive courses under their own org's locations", async () => {
  const asA = as(orgAdminACookie);

  const createOwn = await asA("/api/admin/courses", {
    method: "POST",
    body: JSON.stringify({ name: "A's Course", theme: "t", pars: PARS, locationId: locationAId }),
  });
  assert.equal(createOwn.status, 200);
  const created = await createOwn.json();

  const createOther = await asA("/api/admin/courses", {
    method: "POST",
    body: JSON.stringify({ name: "Sneaky", theme: "t", pars: PARS, locationId: locationBId }),
  });
  assert.equal(createOther.status, 403);

  const createNoLocation = await asA("/api/admin/courses", {
    method: "POST",
    body: JSON.stringify({ name: "No Location", theme: "t", pars: PARS }),
  });
  assert.equal(createNoLocation.status, 400);

  const patchOther = await asA(`/api/admin/courses/${courseBId}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "Hijacked" }),
  });
  assert.equal(patchOther.status, 403);

  const moveIntoOther = await asA(`/api/admin/courses/${created.course.id}`, {
    method: "PATCH",
    body: JSON.stringify({ locationId: locationBId }),
  });
  assert.equal(moveIntoOther.status, 403, "can't move their own course into another org's location");

  const archiveOther = await asA(`/api/admin/courses/${courseBId}/archive`, { method: "POST" });
  assert.equal(archiveOther.status, 403);

  const archiveOwn = await asA(`/api/admin/courses/${created.course.id}/archive`, { method: "POST" });
  assert.equal(archiveOwn.status, 200);

  await testQuery(`delete from course where id = $1`, [created.course.id]);
});

test("overview: an org_admin's totals and perLocation are scoped to their own org", async () => {
  const asA = as(orgAdminACookie);
  const res = await asA("/api/admin/overview");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.totals.orgs, 1);
  assert.equal(body.totals.locations, 1);
  assert.deepEqual(
    body.perLocation.map((l) => l.id),
    [locationAId]
  );
});

test("a session-based super_admin (not APP_TOKEN) is fully unrestricted, same as the token bypass", async () => {
  const asSuper = as(superAdminSessionCookie);
  const orgs = await (await asSuper("/api/admin/orgs")).json();
  assert.ok(orgs.some((o) => o.id === orgAId) && orgs.some((o) => o.id === orgBId));

  const locations = await (await asSuper("/api/admin/locations")).json();
  assert.ok(locations.some((l) => l.id === locationAId) && locations.some((l) => l.id === locationBId));

  const overview = await (await asSuper("/api/admin/overview")).json();
  assert.ok(overview.totals.orgs >= 2);
});

test("org B's admin cannot see org A's data either (isolation is symmetric)", async () => {
  const asB = as(orgAdminBCookie);
  const res = await asB(`/api/admin/locations/${locationAId}`);
  assert.equal(res.status, 403);
  const list = await (await asB("/api/admin/locations")).json();
  assert.ok(!list.some((l) => l.id === locationAId));
});
