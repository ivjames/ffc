// Integration coverage for /api/admin/orgs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "orgs-test-token";

const { app } = await import("../../app.js");

let baseUrl;
let close;
const orgIds = [];

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "orgs-test-token",
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
  await testQuery(`delete from admin_audit where entity = 'org' and entity_id = any($1::uuid[])`, [
    orgIds,
  ]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [orgIds]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("POST /api/admin/orgs validates name and slug", async () => {
  const badName = await api("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({ name: "", slug: "x" }),
  });
  assert.equal(badName.status, 400);

  const badSlug = await api("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({ name: "X", slug: "Not Ok" }),
  });
  assert.equal(badSlug.status, 400);
});

test("POST /api/admin/orgs rejects reserved hostname slugs", async () => {
  // An org slug is the first DNS label of its subdomain, so infrastructure
  // labels (admin.<fqdn>, the platform apex itself, …) must never be taken
  // by an org — see lib/reservedSlugs.js.
  for (const slug of ["admin", "www", "api", "ffc", "infinicade"]) {
    const res = await api("/api/admin/orgs", {
      method: "POST",
      body: JSON.stringify({ name: "Reserved Check", slug }),
    });
    assert.equal(res.status, 400, `slug "${slug}" should be rejected`);
    const body = await res.json();
    assert.match(body.error, /reserved/, `slug "${slug}" error should say reserved`);
  }
});

test("POST /api/admin/orgs creates, then updates via id, and audits both", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const createRes = await api("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({ name: "Test Org", slug: `test-org-${stamp}` }),
  });
  assert.equal(createRes.status, 200);
  const created = await createRes.json();
  assert.equal(created.ok, true);
  assert.equal(created.org.name, "Test Org");
  orgIds.push(created.org.id);

  const updateRes = await api("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({ id: created.org.id, name: "Renamed Org", slug: `test-org-${stamp}` }),
  });
  assert.equal(updateRes.status, 200);
  const updated = await updateRes.json();
  assert.equal(updated.org.id, created.org.id);
  assert.equal(updated.org.name, "Renamed Org");

  const audit = await testQuery(
    `select action from admin_audit where entity = 'org' and entity_id = $1 order by created_at`,
    [created.org.id]
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ["org.create", "org.update"]
  );
});

test("POST /api/admin/orgs 409s on a slug collision", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `dup-org-${stamp}`;
  const first = await api("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({ name: "First", slug }),
  });
  const firstJson = await first.json();
  orgIds.push(firstJson.org.id);

  // Re-posting the SAME slug with no id upserts (idempotent) — not a conflict.
  const second = await api("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({ name: "First Again", slug }),
  });
  assert.equal(second.status, 200);

  // A DIFFERENT explicit id with the same slug is a genuine collision.
  const third = await api("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Colliding",
      slug,
    }),
  });
  assert.equal(third.status, 409);
});

// The Orgs list flags half-finished onboarding ("no venue, no admin account"),
// which needs both counts to be right at once — a naive second left join would
// multiply the rows and inflate them.
test("GET /api/admin/orgs counts venues and admin accounts independently", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created = await (
    await api("/api/admin/orgs", {
      method: "POST",
      body: JSON.stringify({ name: "Counted Org", slug: `counted-org-${stamp}` }),
    })
  ).json();
  const orgId = created.org.id;
  orgIds.push(orgId);

  const bare = (await (await api("/api/admin/orgs")).json()).find((o) => o.id === orgId);
  assert.equal(bare.locationCount, 0);
  assert.equal(bare.adminCount, 0);
  assert.ok(bare.createdAt, "createdAt is exposed for the org's identity card");

  // Two venues and two accounts: 2 and 2, not 4 and 4.
  await testQuery(
    `insert into location (name, slug, org_id) values ($1, $2, $3), ($4, $5, $3)`,
    [`A ${stamp}`, `a-${stamp}`, orgId, `B ${stamp}`, `b-${stamp}`]
  );
  await testQuery(
    `insert into admin_user (email, role, org_id) values ($1, 'org_admin', $3), ($2, 'org_admin', $3)`,
    [`one-${stamp}@example.com`, `two-${stamp}@example.com`, orgId]
  );
  try {
    const row = (await (await api("/api/admin/orgs")).json()).find((o) => o.id === orgId);
    assert.equal(row.locationCount, 2);
    assert.equal(row.adminCount, 2);

    // An archived venue drops out of locationCount; the accounts are untouched.
    await testQuery(`update location set archived_at = now() where slug = $1`, [`a-${stamp}`]);
    const afterArchive = (await (await api("/api/admin/orgs")).json()).find((o) => o.id === orgId);
    assert.equal(afterArchive.locationCount, 1);
    assert.equal(afterArchive.adminCount, 2);
  } finally {
    await testQuery(`delete from admin_user where org_id = $1`, [orgId]);
    await testQuery(`delete from location where org_id = $1`, [orgId]);
  }
});

test("GET /api/admin/orgs lists orgs with live locationCount, hides archived unless asked", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created = await (
    await api("/api/admin/orgs", {
      method: "POST",
      body: JSON.stringify({ name: "Listed Org", slug: `listed-org-${stamp}` }),
    })
  ).json();
  orgIds.push(created.org.id);

  const list = await (await api("/api/admin/orgs")).json();
  const row = list.find((o) => o.id === created.org.id);
  assert.ok(row);
  assert.equal(row.locationCount, 0);

  await api(`/api/admin/orgs/${created.org.id}/archive`, { method: "POST" });
  const afterArchive = await (await api("/api/admin/orgs")).json();
  assert.ok(!afterArchive.some((o) => o.id === created.org.id), "archived org hidden by default");

  const withArchived = await (await api("/api/admin/orgs?archived=1")).json();
  assert.ok(withArchived.some((o) => o.id === created.org.id), "archived=1 includes it");

  await api(`/api/admin/orgs/${created.org.id}/unarchive`, { method: "POST" });
  const audit = await testQuery(
    `select action from admin_audit where entity = 'org' and entity_id = $1 order by created_at`,
    [created.org.id]
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ["org.create", "org.archive", "org.unarchive"]
  );
});

test("GET /api/admin/orgs/:id returns the org plus its live locations", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created = await (
    await api("/api/admin/orgs", {
      method: "POST",
      body: JSON.stringify({ name: "Org With Location", slug: `org-with-loc-${stamp}` }),
    })
  ).json();
  orgIds.push(created.org.id);

  const loc = await testQuery(
    `insert into location (name, slug, org_id) values ($1, $2, $3) returning id`,
    [`Org Location ${stamp}`, `org-loc-${stamp}`, created.org.id]
  );

  const res = await api(`/api/admin/orgs/${created.org.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.org.id, created.org.id);
  assert.equal(body.locations.length, 1);
  assert.equal(body.locations[0].id, loc.rows[0].id);

  await testQuery(`delete from location where id = $1`, [loc.rows[0].id]);
});

test("GET /api/admin/orgs/:id: bad uuid -> 400, missing -> 404", async () => {
  const bad = await api("/api/admin/orgs/not-a-uuid");
  assert.equal(bad.status, 400);
  const missing = await api("/api/admin/orgs/00000000-0000-4000-8000-000000000000");
  assert.equal(missing.status, 404);
});
