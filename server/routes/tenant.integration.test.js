// Integration coverage for multi-venue tenant resolution (MULTI-VENUE.md §1/§3):
// Host-header → org on /api/content, the per-tenant /api/manifest.webmanifest,
// and tenant scoping of the public announcements feed. Uses supertest so the
// Host header can be set per request (node fetch strips it as forbidden).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { TEST_DATABASE_URL, ensureSchema, testQuery } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");
const { clearTenantCache } = await import("../lib/tenant.js");
const { BRANDING_DEFAULTS } = await import("../lib/branding.js");

// DEFAULT_ORG_SLUG is unset in tests, so fallback resolution lands on the
// schema-seeded default org.
const DEFAULT_SLUG = "bullwinkles";
const DOMAIN = "minigolf.example";

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const slugA = `tenant-a-${stamp}`;
const slugB = `tenant-b-${stamp}`;
const slugArchived = `tenant-arch-${stamp}`;
const slugSuspended = `tenant-susp-${stamp}`;

const ORG_A_BRANDING = { appName: "Org A Golf", themeColor: "#123abc" };

let orgAId, orgBId, orgArchivedId, orgSuspendedId;
let locAId, locBId, locArchivedOrgId, locOrglessId;
let courseAId, courseBId;
const announcementIds = [];

function get(path, hostLabel) {
  clearTenantCache(); // fresh resolution per case — the 30s TTL outlives a test run
  return request(app).get(path).set("Host", `${hostLabel}.${DOMAIN}`);
}

async function insertOrg(name, slug, { branding = {}, archived = false, status = "active" } = {}) {
  const db = await testQuery(
    `insert into org (name, slug, status, branding, archived_at)
       values ($1, $2, $3, $4, ${archived ? "now()" : "null"}) returning id`,
    [name, slug, status, branding]
  );
  return db.rows[0].id;
}

async function insertLocation(name, slug, orgId) {
  const db = await testQuery(
    `insert into location (name, slug, org_id) values ($1, $2, $3) returning id`,
    [name, slug, orgId]
  );
  return db.rows[0].id;
}

before(async () => {
  await ensureSchema();

  orgAId = await insertOrg(`Tenant Org A ${stamp}`, slugA, { branding: ORG_A_BRANDING });
  orgBId = await insertOrg(`Tenant Org B ${stamp}`, slugB);
  orgArchivedId = await insertOrg(`Tenant Archived ${stamp}`, slugArchived, { archived: true });
  orgSuspendedId = await insertOrg(`Tenant Suspended ${stamp}`, slugSuspended, {
    status: "suspended",
  });

  locAId = await insertLocation(`Tenant Loc A ${stamp}`, `tenant-loc-a-${stamp}`, orgAId);
  locBId = await insertLocation(`Tenant Loc B ${stamp}`, `tenant-loc-b-${stamp}`, orgBId);
  locArchivedOrgId = await insertLocation(
    `Tenant Loc Arch ${stamp}`,
    `tenant-loc-arch-${stamp}`,
    orgArchivedId
  );
  // Org-less safety-net row (the schema backfill only runs at migrate time).
  locOrglessId = await insertLocation(`Tenant Loc Orgless ${stamp}`, `tenant-loc-none-${stamp}`, null);

  const pars = Array(18).fill(3);
  const cA = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, 'test', $2, $3) returning id`,
    [`Tenant Course A ${stamp}`, pars, locAId]
  );
  courseAId = cA.rows[0].id;
  const cB = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, 'test', $2, $3) returning id`,
    [`Tenant Course B ${stamp}`, pars, locBId]
  );
  courseBId = cB.rows[0].id;

  const global = await testQuery(
    `insert into announcement (title) values ($1) returning id`,
    [`Tenant Global Promo ${stamp}`]
  );
  const pinned = await testQuery(
    `insert into announcement (title, location_id) values ($1, $2) returning id`,
    [`Tenant Loc A Promo ${stamp}`, locAId]
  );
  announcementIds.push(global.rows[0].id, pinned.rows[0].id);
});

after(async () => {
  await testQuery(`delete from announcement where id = any($1::uuid[])`, [announcementIds]);
  await testQuery(`delete from course where id in ($1, $2)`, [courseAId, courseBId]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [
    [locAId, locBId, locArchivedOrgId, locOrglessId],
  ]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [
    [orgAId, orgBId, orgArchivedId, orgSuspendedId],
  ]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("exact subdomain match: content is strictly that org's, with resolved branding", async () => {
  const res = await get("/api/content", slugA);
  assert.equal(res.status, 200);
  const body = res.body;

  assert.equal(body.org.id, orgAId);
  assert.equal(body.org.slug, slugA);
  // Branding: stored keys win, everything else falls back to the defaults.
  assert.equal(body.org.branding.appName, "Org A Golf");
  assert.equal(body.org.branding.themeColor, "#123abc");
  assert.equal(body.org.branding.shortName, BRANDING_DEFAULTS.shortName);
  assert.equal(body.org.branding.icon512Url, BRANDING_DEFAULTS.icon512Url);

  const locIds = body.locations.map((l) => l.id);
  assert.ok(locIds.includes(locAId), "own location shown");
  assert.ok(!locIds.includes(locBId), "other org's location hidden");
  assert.ok(!locIds.includes(locOrglessId), "org-less row hidden under an exact tenant match");

  const courseIds = body.courses.map((c) => c.id);
  assert.ok(courseIds.includes(courseAId), "own course shown");
  assert.ok(!courseIds.includes(courseBId), "other org's course hidden");
});

test("the two subdomains are symmetric (org B sees only org B)", async () => {
  const res = await get("/api/content", slugB);
  assert.equal(res.status, 200);
  assert.equal(res.body.org.id, orgBId);
  // Empty stored branding resolves to the full default set.
  assert.deepEqual(res.body.org.branding, { ...BRANDING_DEFAULTS });
  const locIds = res.body.locations.map((l) => l.id);
  assert.ok(locIds.includes(locBId) && !locIds.includes(locAId) && !locIds.includes(locOrglessId));
});

test("unknown label falls back to the default org and sweeps in org-less locations", async () => {
  const res = await get("/api/content", `nope-${stamp}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.org.slug, DEFAULT_SLUG);
  const locIds = res.body.locations.map((l) => l.id);
  assert.ok(locIds.includes(locOrglessId), "org-less location shown on the default-org path");
  assert.ok(!locIds.includes(locAId) && !locIds.includes(locBId), "real tenants' rows still hidden");
});

test("an archived org's slug no longer resolves — falls back to the default org", async () => {
  const res = await get("/api/content", slugArchived);
  assert.equal(res.status, 200);
  assert.equal(res.body.org.slug, DEFAULT_SLUG);
  assert.ok(
    !res.body.locations.some((l) => l.id === locArchivedOrgId),
    "the archived org's location is not exposed via fallback"
  );
});

test("a suspended org's slug no longer resolves either", async () => {
  const res = await get("/api/content", slugSuspended);
  assert.equal(res.status, 200);
  assert.equal(res.body.org.slug, DEFAULT_SLUG);
});

test("manifest carries the tenant's branding with the spec MIME type", async () => {
  const res = await get("/api/manifest.webmanifest", slugA);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/manifest\+json/);
  const manifest = JSON.parse(res.text);
  assert.equal(manifest.name, "Org A Golf");
  assert.equal(manifest.short_name, BRANDING_DEFAULTS.shortName);
  assert.equal(manifest.theme_color, "#123abc");
  assert.equal(manifest.background_color, BRANDING_DEFAULTS.backgroundColor);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.icons.length, 3);
  assert.equal(manifest.icons[0].src, BRANDING_DEFAULTS.icon192Url);
  assert.equal(manifest.icons[2].purpose, "maskable");
});

test("manifest for an org with empty branding is all defaults", async () => {
  const res = await get("/api/manifest.webmanifest", slugB);
  assert.equal(res.status, 200);
  const manifest = JSON.parse(res.text);
  assert.equal(manifest.name, BRANDING_DEFAULTS.appName);
  assert.equal(manifest.short_name, BRANDING_DEFAULTS.shortName);
  assert.equal(manifest.theme_color, BRANDING_DEFAULTS.themeColor);
});

test("announcements: location-pinned rows are limited to the tenant's venues", async () => {
  const [globalId, pinnedId] = announcementIds;

  // The venue's own subdomain sees both the global and the pinned row.
  const own = await get(`/api/announcements?locationId=${locAId}`, slugA);
  assert.equal(own.status, 200);
  const ownIds = own.body.map((a) => a.id);
  assert.ok(ownIds.includes(globalId), "global row shows everywhere");
  assert.ok(ownIds.includes(pinnedId), "pinned row shows on its own tenant");

  // Another tenant passing the SAME locationId must not see the pinned row.
  const other = await get(`/api/announcements?locationId=${locAId}`, slugB);
  assert.equal(other.status, 200);
  const otherIds = other.body.map((a) => a.id);
  assert.ok(otherIds.includes(globalId), "global row still shows");
  assert.ok(!otherIds.includes(pinnedId), "another tenant can't read org A's promo by id");
});
