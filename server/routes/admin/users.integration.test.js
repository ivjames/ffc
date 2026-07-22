// Integration coverage for /api/admin/users — CRUD + super_admin-only gate.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "users-test-token";

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

let baseUrl;
let close;
let orgId;
let orgAdminUserId;
let orgAdminCookie;
const userIds = [];

function superAdmin(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "users-test-token",
      ...opts.headers,
    },
  });
}

function asOrgAdmin(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Cookie: orgAdminCookie, ...opts.headers },
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const org = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Users Test Org ${stamp}`,
    `users-test-org-${stamp}`,
  ]);
  orgId = org.rows[0].id;

  const orgAdminEmail = `org-admin-${stamp}@example.com`;
  const orgAdminPassword = "org-admin-password";
  const orgAdmin = await testQuery(
    `insert into admin_user (email, role, org_id, password_hash) values ($1, 'org_admin', $2, $3) returning id`,
    [orgAdminEmail, orgId, hashPassword(orgAdminPassword)]
  );
  orgAdminUserId = orgAdmin.rows[0].id;
  userIds.push(orgAdminUserId);

  const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: orgAdminEmail, password: orgAdminPassword }),
  });
  orgAdminCookie = loginRes.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from admin_user where id = any($1::uuid[])`, [userIds]);
  await testQuery(`delete from org where id = $1`, [orgId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("an org_admin session cannot touch /api/admin/users (403, not 401)", async () => {
  const list = await asOrgAdmin("/api/admin/users");
  assert.equal(list.status, 403);
  const create = await asOrgAdmin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: "x@example.com", password: "password123" }),
  });
  assert.equal(create.status, 403);
});

test("super_admin (APP_TOKEN) can create, list, patch, and delete a user", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `created-${stamp}@example.com`;

  const createRes = await superAdmin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123", role: "org_admin", orgId }),
  });
  assert.equal(createRes.status, 200);
  const created = await createRes.json();
  assert.equal(created.user.email, email);
  assert.equal("passwordHash" in created.user, false);
  userIds.push(created.user.id);

  const listRes = await superAdmin("/api/admin/users");
  const list = await listRes.json();
  assert.ok(list.some((u) => u.id === created.user.id));
  assert.ok(list.every((u) => !("passwordHash" in u)));

  const patchRes = await superAdmin(`/api/admin/users/${created.user.id}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "super_admin", orgId: null }),
  });
  assert.equal(patchRes.status, 200);
  const patched = await patchRes.json();
  assert.equal(patched.user.role, "super_admin");
  assert.equal(patched.user.orgId, null);

  const deleteRes = await superAdmin(`/api/admin/users/${created.user.id}`, { method: "DELETE" });
  assert.equal(deleteRes.status, 200);
  const afterDelete = await superAdmin(`/api/admin/users`);
  const afterDeleteList = await afterDelete.json();
  assert.ok(!afterDeleteList.some((u) => u.id === created.user.id));
});

test("POST /api/admin/users validates email, password length, role, and org_admin requiring orgId", async () => {
  const cases = [
    { body: { email: "not-an-email", password: "password123" }, match: /email must be/ },
    { body: { email: "a@b.com", password: "short" }, match: /password/ },
    { body: { email: "a@b.com", password: "password123", role: "nope" }, match: /role must be/ },
    {
      body: { email: "a@b.com", password: "password123", role: "org_admin" },
      match: /orgId is required/,
    },
  ];
  for (const { body, match } of cases) {
    const res = await superAdmin("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
    assert.equal(res.status, 400, JSON.stringify(body));
    const json = await res.json();
    assert.match(json.error, match);
  }
});

test("POST /api/admin/users 409s on a duplicate email", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `dup-${stamp}@example.com`;
  const first = await superAdmin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123", role: "org_admin", orgId }),
  });
  const firstJson = await first.json();
  userIds.push(firstJson.user.id);

  const second = await superAdmin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123", role: "org_admin", orgId }),
  });
  assert.equal(second.status, 409);
});

test("PATCH /api/admin/users/:id can reset the password; the old one stops working", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `reset-${stamp}@example.com`;
  const created = await superAdmin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: "old-password-1", role: "org_admin", orgId }),
  }).then((r) => r.json());
  userIds.push(created.user.id);

  await superAdmin(`/api/admin/users/${created.user.id}`, {
    method: "PATCH",
    body: JSON.stringify({ password: "new-password-1" }),
  });

  const oldLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "old-password-1" }),
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "new-password-1" }),
  });
  assert.equal(newLogin.status, 200);
});

test("PATCH/DELETE /api/admin/users/:id: bad uuid -> 400, missing -> 404", async () => {
  const badPatch = await superAdmin("/api/admin/users/not-a-uuid", {
    method: "PATCH",
    body: JSON.stringify({}),
  });
  assert.equal(badPatch.status, 400);
  const missingPatch = await superAdmin("/api/admin/users/00000000-0000-4000-8000-000000000000", {
    method: "PATCH",
    body: JSON.stringify({}),
  });
  assert.equal(missingPatch.status, 404);
  const missingDelete = await superAdmin("/api/admin/users/00000000-0000-4000-8000-000000000000", {
    method: "DELETE",
  });
  assert.equal(missingDelete.status, 404);
});
