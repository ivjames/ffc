// Tenant resolution must fail CLOSED (PR #191 review, finding 1): every
// tenant filter treats req.tenant == null as "no orgs exist → legacy
// unfiltered", so a transient DB error during resolveTenant() must never
// degrade to null — that would silently drop the org boundary and serve (or
// accept) every tenant's rows. The tenant() middleware answers 500 instead,
// and an error is never cached (unlike a genuine negative resolution), so the
// very next request against a healthy DB re-resolves normally.
//
// The failure is simulated by monkey-patching pool.query to reject ONLY the
// resolver's org lookups — the route's own queries stay healthy, so the old
// fail-open behavior would have answered 200 with every tenant's rows.
// Supertest sets the per-tenant Host header (node fetch strips it as
// forbidden) — the tenantIsolation.integration.test.js pattern.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { TEST_DATABASE_URL, ensureSchema, testQuery } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");
const { pool } = await import("../db.js");
const { clearTenantCache } = await import("./tenant.js");

const DOMAIN = "minigolf.example";
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const slugA = `fail-closed-a-${stamp}`;
const slugB = `fail-closed-b-${stamp}`;

let orgAId, orgBId, locAId, locBId;

before(async () => {
  await ensureSchema();
  const mkOrg = async (name, slug) =>
    (await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [name, slug]))
      .rows[0].id;
  orgAId = await mkOrg(`Fail Closed A ${stamp}`, slugA);
  orgBId = await mkOrg(`Fail Closed B ${stamp}`, slugB);
  const mkLoc = async (name, slug, orgId) =>
    (
      await testQuery(`insert into location (name, slug, org_id) values ($1, $2, $3) returning id`, [
        name,
        slug,
        orgId,
      ])
    ).rows[0].id;
  locAId = await mkLoc(`Fail Closed Loc A ${stamp}`, `fail-closed-loc-a-${stamp}`, orgAId);
  locBId = await mkLoc(`Fail Closed Loc B ${stamp}`, `fail-closed-loc-b-${stamp}`, orgBId);
});

after(async () => {
  await testQuery(`delete from location where id = any($1::uuid[])`, [[locAId, locBId]]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [[orgAId, orgBId]]);
  await pool.end();
});

function get(path, hostLabel) {
  return request(app).get(path).set("Host", `${hostLabel}.${DOMAIN}`);
}

test("a DB error during tenant resolution 500s the read — no unfiltered rows leak", async () => {
  clearTenantCache();
  const realQuery = pool.query.bind(pool);
  pool.query = (text, ...rest) => {
    if (typeof text === "string" && /\bfrom org\b/.test(text)) {
      return Promise.reject(new Error("simulated resolver outage"));
    }
    return realQuery(text, ...rest);
  };
  try {
    const res = await get("/api/content", slugA);
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { ok: false, error: "internal error" });
    assert.equal(res.body.locations, undefined, "no rows may leak on resolver failure");
  } finally {
    pool.query = realQuery;
  }
});

test("the failure was not cached: the next request re-resolves and stays tenant-scoped", async () => {
  // Deliberately NOT clearing the cache — a cached failure would either 500
  // again or (worse, if cached as null) serve org B's rows unfiltered.
  const res = await get("/api/content", slugA);
  assert.equal(res.status, 200);
  assert.equal(res.body.org.id, orgAId);
  const ids = res.body.locations.map((l) => l.id);
  assert.ok(ids.includes(locAId), "own rows are served");
  assert.ok(!ids.includes(locBId), "other tenants' rows stay filtered out");
});
