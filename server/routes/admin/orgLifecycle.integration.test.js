// Integration coverage for the org suspend/unsuspend lifecycle verbs:
//   POST /api/admin/orgs/:id/suspend    (super_admin only, audited)
//   POST /api/admin/orgs/:id/unsuspend
// including the default-org guard (suspending the fallback org blanks the
// apex/staging host, so it demands ?force=1). Tenant-side behavior of a
// suspended org (dark subdomain) is covered in routes/tenant.integration.test.js.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "org-lifecycle-test-token";

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
// Point THIS process's app at a private default org, so the default-org guard
// can be exercised (force-suspend included) without ever touching the
// schema-seeded 'bullwinkles' org that parallel test files fall back to.
const DEFAULT_SLUG = `lifecycle-default-${stamp}`;
process.env.DEFAULT_ORG_SLUG = DEFAULT_SLUG;

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

const TOKEN_HEADERS = { "x-app-token": "org-lifecycle-test-token", "Content-Type": "application/json" };

let baseUrl;
let close;
let orgId, defaultOrgId, orgAdminId;
let orgAdminCookie;
const ORG_ADMIN_EMAIL = `org-lifecycle-admin-${stamp}@example.com`;
const ORG_ADMIN_PASSWORD = "org-admin-secret";

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const org = await testQuery(
    `insert into org (name, slug) values ($1, $2) returning id`,
    [`Lifecycle Org ${stamp}`, `lifecycle-org-${stamp}`]
  );
  orgId = org.rows[0].id;
  const def = await testQuery(
    `insert into org (name, slug) values ($1, $2) returning id`,
    [`Lifecycle Default ${stamp}`, DEFAULT_SLUG]
  );
  defaultOrgId = def.rows[0].id;

  const user = await testQuery(
    `insert into admin_user (email, role, org_id, password_hash)
       values ($1, 'org_admin', $2, $3) returning id`,
    [ORG_ADMIN_EMAIL, orgId, hashPassword(ORG_ADMIN_PASSWORD)]
  );
  orgAdminId = user.rows[0].id;
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ORG_ADMIN_EMAIL, password: ORG_ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  orgAdminCookie = login.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from admin_user where id = $1`, [orgAdminId]); // cascades admin_session
  await testQuery(`delete from admin_audit where entity_id in ($1, $2)`, [orgId, defaultOrgId]);
  await testQuery(`delete from org where id in ($1, $2)`, [orgId, defaultOrgId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("suspend flips status and is audited; unsuspend restores", async () => {
  const suspend = await fetch(`${baseUrl}/api/admin/orgs/${orgId}/suspend`, {
    method: "POST",
    headers: TOKEN_HEADERS,
  });
  assert.equal(suspend.status, 200);
  const suspendBody = await suspend.json();
  assert.equal(suspendBody.ok, true);
  assert.equal(suspendBody.org.id, orgId);
  assert.equal(suspendBody.org.status, "suspended");
  assert.equal(suspendBody.org.archivedAt, null, "suspend is not archive");

  const audits = await testQuery(
    `select action from admin_audit where entity = 'org' and entity_id = $1 order by created_at`,
    [orgId]
  );
  assert.ok(audits.rows.some((r) => r.action === "org.suspend"), "org.suspend audited");

  const unsuspend = await fetch(`${baseUrl}/api/admin/orgs/${orgId}/unsuspend`, {
    method: "POST",
    headers: TOKEN_HEADERS,
  });
  assert.equal(unsuspend.status, 200);
  const unsuspendBody = await unsuspend.json();
  assert.equal(unsuspendBody.org.status, "active");

  const audits2 = await testQuery(
    `select action from admin_audit where entity = 'org' and entity_id = $1`,
    [orgId]
  );
  assert.ok(audits2.rows.some((r) => r.action === "org.unsuspend"), "org.unsuspend audited");
});

test("suspending the DEFAULT org is rejected without ?force=1", async () => {
  const res = await fetch(`${baseUrl}/api/admin/orgs/${defaultOrgId}/suspend`, {
    method: "POST",
    headers: TOKEN_HEADERS,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /default org/);
  assert.match(body.error, /force=1/);

  const row = await testQuery(`select status from org where id = $1`, [defaultOrgId]);
  assert.equal(row.rows[0].status, "active", "the default org was left untouched");
});

test("?force=1 overrides the default-org guard", async () => {
  const res = await fetch(`${baseUrl}/api/admin/orgs/${defaultOrgId}/suspend?force=1`, {
    method: "POST",
    headers: TOKEN_HEADERS,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.org.status, "suspended");

  // Restore — leave the fixture clean for the other tests in this file.
  const undo = await fetch(`${baseUrl}/api/admin/orgs/${defaultOrgId}/unsuspend`, {
    method: "POST",
    headers: TOKEN_HEADERS,
  });
  assert.equal(undo.status, 200);
});

test("suspend/unsuspend are super_admin only — an org_admin gets 403 even on their own org", async () => {
  for (const verb of ["suspend", "unsuspend"]) {
    const res = await fetch(`${baseUrl}/api/admin/orgs/${orgId}/${verb}`, {
      method: "POST",
      headers: { Cookie: orgAdminCookie },
    });
    assert.equal(res.status, 403, `${verb} rejected for org_admin`);
  }
});

test("bad and unknown ids answer 400/404", async () => {
  const bad = await fetch(`${baseUrl}/api/admin/orgs/not-a-uuid/suspend`, {
    method: "POST",
    headers: TOKEN_HEADERS,
  });
  assert.equal(bad.status, 400);
  const unknown = await fetch(
    `${baseUrl}/api/admin/orgs/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/suspend`,
    { method: "POST", headers: TOKEN_HEADERS }
  );
  assert.equal(unknown.status, 404);
});
