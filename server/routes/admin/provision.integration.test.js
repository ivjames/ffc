// Integration coverage for /api/admin/provision — one-shot site provisioning.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "provision-test-token";

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

let baseUrl;
let close;
const orgIds = [];
const orgSlugs = [];
const locationIds = [];
const adminEmails = [];

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "provision-test-token",
      ...opts.headers,
    },
  });
}

const PARS = Array(18).fill(3);

/** A fresh, fully valid payload — unique slugs/email per call. */
function basePayload() {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    org: { name: `Provision Org ${stamp}`, slug: `prov-org-${stamp}`, sortOrder: 0 },
    branding: { appName: `Prov App ${stamp}` },
    location: {
      name: `Provision Venue ${stamp}`,
      slug: `prov-loc-${stamp}`,
      lat: 36.96,
      lng: -122.02,
      geofenceKm: 2,
      hours: { mon: { open: "10:00", close: "22:00" }, tue: "closed" },
      pos: { loyalty: { vendor: "centeredge" } },
      sortOrder: 0,
    },
    courses: [
      { name: "Front Nine-teen", theme: "pirates", pars: PARS, sortOrder: 0 },
      { name: "Back Nine-teen", theme: "space", pars: PARS, sortOrder: 1 },
    ],
    adminUser: { email: `prov-admin-${stamp}@example.com`, password: "hunter2hunter2" },
  };
}

/** Track a payload's identifiers so after() can clean up whatever got created. */
function track(payload) {
  orgSlugs.push(payload.org.slug);
  if (payload.adminUser) adminEmails.push(payload.adminUser.email);
  return payload;
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  if (close) await close();
  // FK order: audit rows, courses (by location), locations, admin users, orgs.
  await testQuery(`delete from admin_audit where entity = 'org' and entity_id = any($1::uuid[])`, [
    orgIds,
  ]);
  await testQuery(`delete from course where location_id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from admin_user where email = any($1::text[])`, [adminEmails]);
  await testQuery(`delete from org where slug = any($1::text[])`, [orgSlugs]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("POST /api/admin/provision creates the whole site atomically", async () => {
  const payload = track(basePayload());
  const res = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  const { org, location, courses, adminUser, playerUrl } = body.site;
  orgIds.push(org.id);
  locationIds.push(location.id);

  // Org + branding landed.
  assert.equal(org.slug, payload.org.slug);
  const orgRow = await testQuery(`select branding from org where id = $1`, [org.id]);
  assert.equal(orgRow.rows[0].branding.appName, payload.branding.appName);

  // Location belongs to the new org; tz derived from the coords.
  const locRow = await testQuery(
    `select org_id as "orgId", tz, pos from location where id = $1`,
    [location.id]
  );
  assert.equal(locRow.rows[0].orgId, org.id);
  assert.ok(locRow.rows[0].tz, "tz should be derived from lat/lng");
  // pos normalized: loyalty configured, ordering explicitly absent.
  assert.equal(locRow.rows[0].pos.loyalty.vendor, "centeredge");
  assert.ok(!locRow.rows[0].pos.ordering);

  // Both courses point at the new location.
  assert.equal(courses.length, 2);
  const courseRows = await testQuery(
    `select id from course where location_id = $1`,
    [location.id]
  );
  assert.equal(courseRows.rowCount, 2);

  // org_admin account, scoped to the new org — and no secret material leaks.
  const userRow = await testQuery(
    `select role, org_id as "orgId" from admin_user where email = $1`,
    [payload.adminUser.email]
  );
  assert.equal(userRow.rows[0].role, "org_admin");
  assert.equal(userRow.rows[0].orgId, org.id);
  assert.equal(adminUser.email, payload.adminUser.email);
  assert.ok(!("password" in adminUser));
  assert.ok(!("passwordHash" in adminUser));
  assert.ok(!("password_hash" in adminUser));

  // Audited, post-commit.
  const auditRows = await testQuery(
    `select action from admin_audit where entity = 'org' and entity_id = $1`,
    [org.id]
  );
  assert.deepEqual(auditRows.rows.map((r) => r.action), ["site.provision"]);

  // Test traffic hits 127.0.0.1, not admin.<fqdn> — no player URL derivable.
  assert.equal(playerUrl, null);
});

test("duplicate org slug 409s and rolls the whole site back", async () => {
  const first = track(basePayload());
  delete first.adminUser;
  const firstRes = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(first),
  });
  assert.equal(firstRes.status, 200);
  const firstBody = await firstRes.json();
  orgIds.push(firstBody.site.org.id);
  locationIds.push(firstBody.site.location.id);

  const second = track(basePayload());
  delete second.adminUser;
  second.org.slug = first.org.slug; // collide
  const res = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(second),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /org slug/);

  // Nothing from the second payload landed.
  const loc = await testQuery(`select 1 from location where slug = $1`, [second.location.slug]);
  assert.equal(loc.rowCount, 0);
  const orgs = await testQuery(`select count(*)::int as n from org where slug = $1`, [
    first.org.slug,
  ]);
  assert.equal(orgs.rows[0].n, 1, "no org duplicates");

  // Duplicate LOCATION slug: fresh org slug, reused location slug.
  const third = track(basePayload());
  delete third.adminUser;
  third.location.slug = first.location.slug;
  const thirdRes = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(third),
  });
  assert.equal(thirdRes.status, 409);
  const thirdBody = await thirdRes.json();
  assert.match(thirdBody.error, /location slug/);
  const orphanOrg = await testQuery(`select 1 from org where slug = $1`, [third.org.slug]);
  assert.equal(orphanOrg.rowCount, 0, "no org row without its location");
});

test("reserved org slug is rejected", async () => {
  const payload = basePayload();
  payload.org.slug = "admin";
  const res = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /reserved/);
});

test("bad course pars 400 with nothing created", async () => {
  const payload = track(basePayload());
  payload.courses[1].pars = Array(17).fill(3);
  const res = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 400);

  const org = await testQuery(`select 1 from org where slug = $1`, [payload.org.slug]);
  assert.equal(org.rowCount, 0);
  const loc = await testQuery(`select 1 from location where slug = $1`, [payload.location.slug]);
  assert.equal(loc.rowCount, 0);
});

test("bad pos (gameRewardCaps without gameRewards) 400s", async () => {
  const payload = basePayload();
  payload.location.pos = {
    loyalty: { vendor: "centeredge", gameRewardCaps: { dailyPerCard: 5 } },
  };
  const res = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 400);
});

test("duplicate admin email 409s and rolls the whole site back", async () => {
  // Seed a taken email directly.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `prov-taken-${stamp}@example.com`;
  adminEmails.push(email);
  await testQuery(
    `insert into admin_user (email, role, password_hash) values ($1, 'super_admin', $2)`,
    [email, hashPassword("hunter2hunter2")]
  );

  const payload = track(basePayload());
  payload.adminUser.email = email;
  const res = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /email/);

  const org = await testQuery(`select 1 from org where slug = $1`, [payload.org.slug]);
  assert.equal(org.rowCount, 0, "full rollback: no org row");
});

test("supplied ids are rejected (create-only)", async () => {
  const someUuid = "00000000-0000-4000-8000-000000000001";

  const withOrgId = basePayload();
  withOrgId.org.id = someUuid;
  const r1 = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(withOrgId),
  });
  assert.equal(r1.status, 400);

  const withLocOrgId = basePayload();
  withLocOrgId.location.orgId = someUuid;
  const r2 = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(withLocOrgId),
  });
  assert.equal(r2.status, 400);

  const withCourseId = basePayload();
  withCourseId.courses[0].id = someUuid;
  const r3 = await api("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify(withCourseId),
  });
  assert.equal(r3.status, 400);
});

test("unauthenticated 401; org_admin session 403", async () => {
  const noAuth = await fetch(`${baseUrl}/api/admin/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(basePayload()),
  });
  assert.equal(noAuth.status, 401);

  // Mint an org_admin session (the orgScoping.integration.test.js recipe) and
  // confirm the super_admin gate turns it away.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `prov-org-admin-${stamp}@example.com`;
  const password = "hunter2hunter2";
  adminEmails.push(email);
  const org = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Prov Gate Org ${stamp}`,
    `prov-gate-org-${stamp}`,
  ]);
  orgIds.push(org.rows[0].id);
  orgSlugs.push(`prov-gate-org-${stamp}`);
  await testQuery(
    `insert into admin_user (email, role, org_id, password_hash) values ($1, 'org_admin', $2, $3)`,
    [email, org.rows[0].id, hashPassword(password)]
  );
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const res = await fetch(`${baseUrl}/api/admin/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(basePayload()),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "super_admin only");
});
