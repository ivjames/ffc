// Integration coverage for org branding (MULTI-VENUE.md §2/§3):
// PATCH /api/admin/orgs/:id/branding permissions + validation, and branding
// riding along the org upsert / reads. Two org_admin accounts prove the
// own-org-only write scope; APP_TOKEN covers the super_admin path.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "org-branding-test-token";

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

let baseUrl;
let close;
let orgAId, orgBId;
let orgAdminACookie;
const userIds = [];
const orgIds = [];

async function loginCookie(email, password) {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.headers.get("set-cookie").split(";")[0];
}

// super_admin via APP_TOKEN (the bootstrap credential).
function asSuper(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "org-branding-test-token",
      ...opts.headers,
    },
  });
}

function as(cookie) {
  return (path, opts = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Cookie: cookie, ...opts.headers },
    });
}

function patchBranding(fetcher, orgId, branding) {
  return fetcher(`/api/admin/orgs/${orgId}/branding`, {
    method: "PATCH",
    body: JSON.stringify(branding),
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const orgA = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Branding Org A ${stamp}`,
    `branding-org-a-${stamp}`,
  ]);
  orgAId = orgA.rows[0].id;
  const orgB = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Branding Org B ${stamp}`,
    `branding-org-b-${stamp}`,
  ]);
  orgBId = orgB.rows[0].id;
  orgIds.push(orgAId, orgBId);

  const email = `branding-org-admin-a-${stamp}@example.com`;
  const password = "test-password-1";
  const a = await testQuery(
    `insert into admin_user (email, role, org_id, password_hash) values ($1, 'org_admin', $2, $3) returning id`,
    [email, orgAId, hashPassword(password)]
  );
  userIds.push(a.rows[0].id);
  orgAdminACookie = await loginCookie(email, password);
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from admin_user where id = any($1::uuid[])`, [userIds]);
  await testQuery(`delete from admin_audit where entity = 'org' and entity_id = any($1::uuid[])`, [
    orgIds,
  ]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [orgIds]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("orgs read surfaces branding (defaults to {} for a fresh org)", async () => {
  const res = await asSuper(`/api/admin/orgs/${orgAId}`);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).org.branding, {});
});

test("super_admin PATCH replaces branding, lowercases hex, and audits", async () => {
  const res = await patchBranding(asSuper, orgAId, {
    appName: "Super Set Name",
    themeColor: "#AB12CD", // uppercase accepted…
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.org.branding, {
    appName: "Super Set Name",
    themeColor: "#ab12cd", // …stored lowercase
  });

  // Replace, not merge: the next PATCH drops keys it doesn't carry.
  const replaced = await patchBranding(asSuper, orgAId, { shareFooter: "Beat that!" });
  assert.equal(replaced.status, 200);
  assert.deepEqual((await replaced.json()).org.branding, { shareFooter: "Beat that!" });

  const audit = await testQuery(
    `select action from admin_audit where entity = 'org' and entity_id = $1 and action = 'org.branding'`,
    [orgAId]
  );
  assert.ok(audit.rowCount >= 2, "each branding write is audited");
});

test("an org_admin can restyle their OWN org, but not another org", async () => {
  const asA = as(orgAdminACookie);

  const own = await patchBranding(asA, orgAId, { appName: "Org Admin's Name" });
  assert.equal(own.status, 200);
  assert.deepEqual((await own.json()).org.branding, { appName: "Org Admin's Name" });

  const other = await patchBranding(asA, orgBId, { appName: "Sneaky" });
  assert.equal(other.status, 403);
  const untouched = await testQuery(`select branding from org where id = $1`, [orgBId]);
  assert.deepEqual(untouched.rows[0].branding, {}, "org B's branding is untouched");
});

test("validation: bad hex, unknown key, oversize string, bad URL all 400", async () => {
  const cases = [
    { themeColor: "#12345g" }, // not hex
    { themeColor: "15803d" }, // missing '#'
    { themeColor: "#fff" }, // shorthand not allowed
    { bogusKey: "x" }, // unknown key
    { appName: "x".repeat(81) }, // over the 80-char cap
    { appName: "" }, // empty string is not "unset" — send null or omit
    { shortName: "x".repeat(31) },
    { shareFooter: "x".repeat(121) },
    { logoUrl: "http://insecure.example/logo.png" }, // https or path only
    { logoUrl: "//evil.example/logo.png" }, // protocol-relative sneaks off-origin
    { logoUrl: `https://cdn.example/${"x".repeat(300)}` }, // >300 chars
    ["not", "an", "object"],
  ];
  for (const body of cases) {
    const res = await patchBranding(asSuper, orgAId, body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }

  // Valid URL forms for contrast.
  const ok = await patchBranding(asSuper, orgAId, {
    logoUrl: "/brand/custom.png",
    icon512Url: "https://cdn.example/icon.png",
  });
  assert.equal(ok.status, 200);
});

test("PATCH: bad uuid -> 400, missing org -> 404, explicit null key falls back to default", async () => {
  const bad = await patchBranding(asSuper, "not-a-uuid", {});
  assert.equal(bad.status, 400);
  const missing = await patchBranding(asSuper, "00000000-0000-4000-8000-000000000000", {});
  assert.equal(missing.status, 404);

  // null = "use the default": the key is simply not stored.
  const res = await patchBranding(asSuper, orgAId, { appName: "Kept", themeColor: null });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).org.branding, { appName: "Kept" });
});

test("org upsert accepts branding, and a later upsert without it preserves what's stored", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `branding-upsert-${stamp}`;
  const created = await asSuper("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({
      name: "Upsert Org",
      slug,
      branding: { appName: "Upserted Name", accentColor: "#FF00AA" },
    }),
  });
  assert.equal(created.status, 200);
  const createdJson = await created.json();
  orgIds.push(createdJson.org.id);
  assert.deepEqual(createdJson.org.branding, { appName: "Upserted Name", accentColor: "#ff00aa" });

  // Rename via the same slug WITHOUT a branding key — branding must survive.
  const renamed = await asSuper("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({ name: "Upsert Org Renamed", slug }),
  });
  assert.equal(renamed.status, 200);
  const renamedJson = await renamed.json();
  assert.equal(renamedJson.org.name, "Upsert Org Renamed");
  assert.deepEqual(renamedJson.org.branding, { appName: "Upserted Name", accentColor: "#ff00aa" });

  // Invalid branding fails the whole upsert.
  const invalid = await asSuper("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({ name: "Nope", slug, branding: { appName: 42 } }),
  });
  assert.equal(invalid.status, 400);
});
