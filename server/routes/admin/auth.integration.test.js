// Integration coverage for POST /api/admin/login, POST /api/admin/logout,
// GET /api/admin/me.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "auth-test-token";

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

let baseUrl;
let close;
let adminUserId;
const EMAIL = `auth-test-${Date.now()}@example.com`;
const PASSWORD = "correct-horse-battery";

/** Extracts just the cookie's name=value (drops attrs) for reuse as a request Cookie header. */
function cookieValueFrom(setCookieHeader) {
  return setCookieHeader.split(";")[0];
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const user = await testQuery(
    `insert into admin_user (email, role, password_hash) values ($1, 'super_admin', $2) returning id`,
    [EMAIL, hashPassword(PASSWORD)]
  );
  adminUserId = user.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from admin_user where id = $1`, [adminUserId]); // cascades admin_session
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("POST /api/admin/login requires email and password", async () => {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL }),
  });
  assert.equal(res.status, 400);
});

test("POST /api/admin/login rejects a wrong password and an unknown email identically", async () => {
  const wrongPassword = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: "not-the-password" }),
  });
  assert.equal(wrongPassword.status, 401);
  const wrongBody = await wrongPassword.json();

  const unknownEmail = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nobody@example.com", password: "whatever" }),
  });
  assert.equal(unknownEmail.status, 401);
  const unknownBody = await unknownEmail.json();
  assert.equal(wrongBody.error, unknownBody.error);
});

test("GET /api/admin/me is 401 with no credentials at all", async () => {
  const res = await fetch(`${baseUrl}/api/admin/me`);
  assert.equal(res.status, 401);
});

test("GET /api/admin/me works via APP_TOKEN (viaToken: true, no email)", async () => {
  const res = await fetch(`${baseUrl}/api/admin/me`, {
    headers: { "x-app-token": "auth-test-token" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.role, "super_admin");
  assert.equal(body.user.viaToken, true);
  assert.equal(body.user.email, null);
});

test("POST /api/admin/login succeeds, sets a session cookie, and GET /me + logout work with it", async () => {
  const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(loginRes.status, 200);
  const loginBody = await loginRes.json();
  assert.equal(loginBody.user.id, adminUserId);
  assert.equal(loginBody.user.role, "super_admin");
  assert.equal("passwordHash" in loginBody.user, false, "password hash never returned");

  const setCookie = loginRes.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = cookieValueFrom(setCookie);

  const sessions = await testQuery(`select count(*)::int as n from admin_session where admin_user_id = $1`, [
    adminUserId,
  ]);
  assert.equal(sessions.rows[0].n, 1);

  const meRes = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: cookie } });
  assert.equal(meRes.status, 200);
  const meBody = await meRes.json();
  assert.equal(meBody.user.id, adminUserId);
  assert.equal(meBody.user.viaToken, false);

  const logoutRes = await fetch(`${baseUrl}/api/admin/logout`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(logoutRes.status, 200);

  const sessionsAfter = await testQuery(
    `select count(*)::int as n from admin_session where admin_user_id = $1`,
    [adminUserId]
  );
  assert.equal(sessionsAfter.rows[0].n, 0, "logout deletes the session row");

  const meAfterLogout = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: cookie } });
  assert.equal(meAfterLogout.status, 401, "the same cookie no longer authenticates");
});

test("POST /api/admin/logout with no session is a harmless 200", async () => {
  const res = await fetch(`${baseUrl}/api/admin/logout`, {
    method: "POST",
    headers: { "x-app-token": "auth-test-token" },
  });
  assert.equal(res.status, 200);
});
