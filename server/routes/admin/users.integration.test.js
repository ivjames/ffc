// Integration coverage for /api/admin/users — CRUD + super_admin-only gate.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "users-test-token";
delete process.env.MAIL_PROVIDER; // console mailer — invite links land in stdout

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

// Capture the console mailer's output to see invite mails like a real inbox.
let mailLog = [];
const realLog = console.log;
function captureMail() {
  mailLog = [];
  console.log = (...args) => {
    const line = args.join(" ");
    if (line.startsWith("[mailer]")) mailLog.push(line);
    else realLog(...args);
  };
}

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

beforeEach(() => {
  captureMail();
});

after(async () => {
  console.log = realLog;
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

test("POST /api/admin/users without a password creates a pending account and mails an invite", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `invited-${stamp}@example.com`;

  const res = await superAdmin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, role: "org_admin", orgId }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.inviteSent, true);
  assert.equal(body.user.email, email);
  assert.equal("passwordHash" in body.user, false);
  userIds.push(body.user.id);

  // Pending row: NULL hash + a live invite token, and the mail carries a link.
  const row = await testQuery(
    `select password_hash is null as "pending" from admin_user where id = $1`,
    [body.user.id]
  );
  assert.equal(row.rows[0].pending, true);
  const tokenRow = await testQuery(
    `select kind from admin_password_token where admin_user_id = $1 and used_at is null`,
    [body.user.id]
  );
  assert.equal(tokenRow.rowCount, 1);
  assert.equal(tokenRow.rows[0].kind, "invite");
  const mail = mailLog[mailLog.length - 1] ?? "";
  assert.match(mail, /set-password\?token=[0-9a-f]{64}/);
  assert.match(mail, /invited to Master Control/);

  // Pre-Resend stopgap: on the console provider the super_admin response
  // carries the same link the mail did, for hand relay.
  const mailedToken = mail.match(/set-password\?token=([0-9a-f]{64})/)?.[1];
  assert.equal(body.inviteLink, `http://localhost:5174/set-password?token=${mailedToken}`);
});

// The whole reason this route exists rather than pointing the admin UI at the
// public /password/forgot: minting a token deletes the user's outstanding one,
// and the public endpoint must discard the link it generates, so resending
// through it would invalidate a hand-relayed link and hand back nothing.
test("POST /api/admin/users/:id/resend-invite mints a fresh link and returns it", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `resend-${stamp}@example.com`;
  const created = await (
    await superAdmin("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, role: "org_admin", orgId }),
    })
  ).json();
  userIds.push(created.user.id);
  const firstToken = created.inviteLink.match(/token=([0-9a-f]{64})/)[1];

  const res = await superAdmin(`/api/admin/users/${created.user.id}/resend-invite`, {
    method: "POST",
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sent, true);
  // Still pending, so it is an invite (7 days), not a 2-hour reset.
  assert.equal(body.kind, "invite");

  // A REPLACEMENT link comes back — the point of the route.
  const secondToken = body.inviteLink.match(/token=([0-9a-f]{64})/)[1];
  assert.notEqual(secondToken, firstToken);
  const mail = mailLog[mailLog.length - 1] ?? "";
  assert.equal(mail.includes(secondToken), true, "the mailed link is the returned one");

  // Exactly one live token: the old one is gone, so the operator being handed
  // the new link is not a nicety, it is the only working link that now exists.
  const live = await testQuery(
    `select kind from admin_password_token where admin_user_id = $1 and used_at is null`,
    [created.user.id]
  );
  assert.equal(live.rowCount, 1);

  const audited = await testQuery(
    `select action, detail from admin_audit where entity = 'admin_user' and entity_id = $1
      and action = 'user.resend_invite'`,
    [created.user.id]
  );
  assert.equal(audited.rowCount, 1);
  // Booleans only — the audit log must never hold the capability itself.
  assert.equal(audited.rows[0].detail.inviteLinkReturned, true);
  assert.equal(JSON.stringify(audited.rows[0].detail).includes(secondToken), false);
});

test("POST /api/admin/users/:id/resend-invite sends a reset for an account that has a password", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `resend-active-${stamp}@example.com`;
  const created = await (
    await superAdmin("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password: "password123", role: "org_admin", orgId }),
    })
  ).json();
  userIds.push(created.user.id);

  const body = await (
    await superAdmin(`/api/admin/users/${created.user.id}/resend-invite`, { method: "POST" })
  ).json();
  assert.equal(body.kind, "reset");
  const live = await testQuery(
    `select kind from admin_password_token where admin_user_id = $1 and used_at is null`,
    [created.user.id]
  );
  assert.equal(live.rows[0].kind, "reset");
});

test("POST /api/admin/users/:id/resend-invite is super_admin only and 404s an unknown id", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created = await (
    await superAdmin("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: `resend-gate-${stamp}@example.com`, role: "org_admin", orgId }),
    })
  ).json();
  userIds.push(created.user.id);

  const denied = await asOrgAdmin(`/api/admin/users/${created.user.id}/resend-invite`, {
    method: "POST",
  });
  assert.equal(denied.status, 403);

  const missing = await superAdmin(
    `/api/admin/users/00000000-0000-4000-8000-000000000009/resend-invite`,
    { method: "POST" }
  );
  assert.equal(missing.status, 404);
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
