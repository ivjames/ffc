// Integration coverage for POST /api/admin/me/password — self-service password
// change for any signed-in admin (org_admin included: it's /me, not the
// super_admin-only /users surface). Verifies the current password, enforces
// the min-8 rule, revokes every OTHER session, and never audits password
// material. APP_TOKEN pseudo-auth has no admin_user row, so it gets a 400.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "pw-change-test-token";

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

let baseUrl;
let close;
let orgId, userId;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const EMAIL = `pw-change-${stamp}@example.com`;
const OLD_PASSWORD = "old-password-123";
const NEW_PASSWORD = "new-password-456";

function cookieValueFrom(setCookieHeader) {
  return setCookieHeader.split(";")[0];
}

async function login(password) {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  return res;
}

async function loginCookie() {
  const res = await login(OLD_PASSWORD);
  assert.equal(res.status, 200);
  return cookieValueFrom(res.headers.get("set-cookie"));
}

function changePassword(cookie, body) {
  return fetch(`${baseUrl}/api/admin/me/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  // An org_admin on purpose — the endpoint must NOT be super_admin-gated.
  const org = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `PW Change Org ${stamp}`,
    `pw-change-org-${stamp}`,
  ]);
  orgId = org.rows[0].id;
  const user = await testQuery(
    `insert into admin_user (email, role, org_id, password_hash)
       values ($1, 'org_admin', $2, $3) returning id`,
    [EMAIL, orgId, hashPassword(OLD_PASSWORD)]
  );
  userId = user.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from admin_user where id = $1`, [userId]); // cascades admin_session
  await testQuery(`delete from admin_audit where entity_id = $1`, [userId]);
  await testQuery(`delete from org where id = $1`, [orgId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("validation: missing fields and short passwords are 400, wrong current is 401", async () => {
  const cookie = await loginCookie();

  const missing = await changePassword(cookie, { newPassword: NEW_PASSWORD });
  assert.equal(missing.status, 400);

  const short = await changePassword(cookie, {
    currentPassword: OLD_PASSWORD,
    newPassword: "short7!",
  });
  assert.equal(short.status, 400);
  assert.match((await short.json()).error, /at least 8/);

  const wrong = await changePassword(cookie, {
    currentPassword: "not-the-password",
    newPassword: NEW_PASSWORD,
  });
  assert.equal(wrong.status, 401);

  // Nothing above changed the stored password.
  const still = await login(OLD_PASSWORD);
  assert.equal(still.status, 200);
});

test("APP_TOKEN pseudo-auth is rejected — there is no account to change", async () => {
  const res = await fetch(`${baseUrl}/api/admin/me/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-token": "pw-change-test-token" },
    body: JSON.stringify({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /APP_TOKEN/);
});

test("happy path: org_admin changes their password; other sessions are revoked, this one survives", async () => {
  // Start from a clean slate — earlier tests' logins also minted sessions.
  await testQuery(`delete from admin_session where admin_user_id = $1`, [userId]);
  const keeper = await loginCookie(); // the session doing the change
  const other = await loginCookie(); // a second device — must get logged out

  const res = await changePassword(keeper, {
    currentPassword: OLD_PASSWORD,
    newPassword: NEW_PASSWORD,
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);

  // The changing session keeps working; the other one is dead.
  const meKeeper = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: keeper } });
  assert.equal(meKeeper.status, 200, "the session that changed the password survives");
  const meOther = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: other } });
  assert.equal(meOther.status, 401, "every other session is revoked");

  const sessions = await testQuery(
    `select count(*)::int as n from admin_session where admin_user_id = $1`,
    [userId]
  );
  assert.equal(sessions.rows[0].n, 1, "exactly the current session row remains");

  // Old password no longer logs in; the new one does.
  assert.equal((await login(OLD_PASSWORD)).status, 401);
  assert.equal((await login(NEW_PASSWORD)).status, 200);

  // Audited, with no password material anywhere in the row.
  const audit = await testQuery(
    `select actor, detail from admin_audit
      where action = 'admin.password_change' and entity_id = $1`,
    [userId]
  );
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].actor, EMAIL);
  const detailText = JSON.stringify(audit.rows[0].detail ?? null);
  assert.ok(!detailText.includes(OLD_PASSWORD) && !detailText.includes(NEW_PASSWORD),
    "no password material in the audit detail");
  assert.equal(audit.rows[0].detail.otherSessionsRevoked, 1);
});
