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
let locAId, locBId, locArchivedOrgId, locSuspendedOrgId, locOrglessId;
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
  locSuspendedOrgId = await insertLocation(
    `Tenant Loc Susp ${stamp}`,
    `tenant-loc-susp-${stamp}`,
    orgSuspendedId
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
    [locAId, locBId, locArchivedOrgId, locSuspendedOrgId, locOrglessId],
  ]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [
    [orgAId, orgBId, orgArchivedId, orgSuspendedId],
  ]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("exact subdomain match: content is strictly that org's, with sparse branding", async () => {
  const res = await get("/api/content", slugA);
  assert.equal(res.status, 200);
  const body = res.body;

  assert.equal(body.org.id, orgAId);
  assert.equal(body.org.slug, slugA);
  // Branding rides SPARSE — exactly the stored keys, no defaults merged in.
  // The client owns the default-merge; server-merging would destroy the
  // "did the org explicitly set themeColor?" signal.
  assert.deepEqual(body.org.branding, ORG_A_BRANDING);

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
  // Empty stored branding round-trips as {} — the client falls back to its
  // own BRANDING_DEFAULTS and the mode greys keep the theme-color meta.
  assert.deepEqual(res.body.org.branding, {});
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

// --- Suspended/archived tenants: the subdomain goes DARK, it does NOT fall
// through to the default org (that would serve the default tenant's brand and
// catalog on a suspended client's host — a cross-brand leak).

test("a suspended org's subdomain serves an empty catalog, not the default org", async () => {
  const res = await get("/api/content", slugSuspended);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { org: null, locations: [], courses: [] });
});

test("an archived org's subdomain goes dark the same way", async () => {
  const res = await get("/api/content", slugArchived);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { org: null, locations: [], courses: [] });
});

test("suspended tenant's manifest is all platform defaults", async () => {
  const res = await get("/api/manifest.webmanifest", slugSuspended);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/manifest\+json/);
  const manifest = JSON.parse(res.text);
  assert.equal(manifest.name, BRANDING_DEFAULTS.appName);
  assert.equal(manifest.short_name, BRANDING_DEFAULTS.shortName);
  assert.equal(manifest.theme_color, BRANDING_DEFAULTS.themeColor);
  assert.equal(manifest.background_color, BRANDING_DEFAULTS.backgroundColor);
});

test("suspended tenant sees NO announcements — not even global rows", async () => {
  const res = await get("/api/announcements", slugSuspended);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [], "the venue is off: global rows are hidden too");
});

test("suspended tenant's announcement-view beacon records nothing", async () => {
  const [globalId] = announcementIds;
  clearTenantCache();
  const res = await request(app)
    .post("/api/announcements/views")
    .set("Host", `${slugSuspended}.${DOMAIN}`)
    .send({ deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ids: [globalId] });
  assert.equal(res.status, 200);
  assert.equal(res.body.recorded, 0, "a global row's view is not recorded for an off venue");
});

test("a guarded player route (GET /api/locations) matches nothing on a suspended host", async () => {
  const res = await get("/api/locations", slugSuspended);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [], "neither the suspended org's venues nor the default org's");
});

// The same no-fallthrough rule guards the DEFAULT org itself: when the org
// DEFAULT_ORG_SLUG names exists but is suspended/archived, every unmatched
// host goes dark with it — resolution must NOT fall through to the first live
// org, which would serve a DIFFERENT client's catalog, branding, and manifest
// on the apex/staging hosts. (The full force-suspend → dark → unsuspend →
// restored round trip through the admin API lives in
// admin/orgLifecycle.integration.test.js.)

test("a suspended DEFAULT org darkens unmatched hosts instead of leaking another live org", async () => {
  process.env.DEFAULT_ORG_SLUG = slugSuspended; // exists, status='suspended'
  try {
    const res = await get("/api/content", `nope-${stamp}`);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body,
      { org: null, locations: [], courses: [] },
      "unmatched host is dark — orgs A/B are live but must not be served here"
    );

    const manifest = await get("/api/manifest.webmanifest", `nope-${stamp}`);
    assert.equal(manifest.status, 200);
    const m = JSON.parse(manifest.text);
    assert.equal(m.name, BRANDING_DEFAULTS.appName, "manifest is all platform defaults");
    assert.equal(m.theme_color, BRANDING_DEFAULTS.themeColor);

    // A live org's own subdomain keeps resolving — only unmatched hosts dark.
    const own = await get("/api/content", slugA);
    assert.equal(own.status, 200);
    assert.equal(own.body.org.id, orgAId);

    // An ARCHIVED default org darkens unmatched hosts the same way.
    process.env.DEFAULT_ORG_SLUG = slugArchived;
    const arch = await get("/api/content", `nope-${stamp}`);
    assert.equal(arch.status, 200);
    assert.deepEqual(arch.body, { org: null, locations: [], courses: [] });
  } finally {
    delete process.env.DEFAULT_ORG_SLUG;
    clearTenantCache();
  }
});

test("DEFAULT_ORG_SLUG naming a NONEXISTENT org still bootstraps to the first live org", async () => {
  // Fresh-install case: no org carries the default slug at all (the seed org
  // was renamed). This keeps the step-4 fallback — a live org resolves, with
  // fallback semantics (org-less legacy rows swept in) — rather than dark.
  process.env.DEFAULT_ORG_SLUG = `no-such-org-${stamp}`;
  try {
    const res = await get("/api/content", `nope-${stamp}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.org?.id, "resolves to a live org, not dark");
    const locIds = res.body.locations.map((l) => l.id);
    assert.ok(locIds.includes(locOrglessId), "fallback semantics: org-less rows swept in");
  } finally {
    delete process.env.DEFAULT_ORG_SLUG;
    clearTenantCache();
  }
});

test("unsuspending restores the tenant's own resolution", async () => {
  await testQuery(`update org set status = 'active' where id = $1`, [orgSuspendedId]);
  try {
    const res = await get("/api/content", slugSuspended);
    assert.equal(res.status, 200);
    assert.equal(res.body.org.id, orgSuspendedId);
    assert.ok(
      res.body.locations.some((l) => l.id === locSuspendedOrgId),
      "its own venue is back"
    );
  } finally {
    await testQuery(`update org set status = 'suspended' where id = $1`, [orgSuspendedId]);
    clearTenantCache();
  }
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
