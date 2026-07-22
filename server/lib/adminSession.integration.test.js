// lib/adminSession.js touches the DB (admin_session), so — unlike its
// lib/*.test.js siblings — this one needs TEST_DATABASE_URL, hence the
// .integration.test.js naming used elsewhere for DB-backed tests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, testQuery } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const {
  createSession,
  getSessionUser,
  deleteSession,
  parseCookies,
  serializeSessionCookie,
  clearSessionCookieHeader,
  SESSION_COOKIE_NAME,
} = await import("./adminSession.js");
const { hashPassword } = await import("./adminPasswords.js");

let adminUserId;

before(async () => {
  await ensureSchema();
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const user = await testQuery(
    `insert into admin_user (email, role, password_hash) values ($1, 'super_admin', $2) returning id`,
    [`session-test-${stamp}@example.com`, hashPassword("irrelevant")]
  );
  adminUserId = user.rows[0].id;
});

after(async () => {
  await testQuery(`delete from admin_user where id = $1`, [adminUserId]); // cascades admin_session
  const { pool } = await import("../db.js");
  await pool.end();
});

test("createSession + getSessionUser round-trips the admin_user's identity", async () => {
  const { token, expiresAt } = await createSession(adminUserId);
  assert.ok(token.length >= 32);
  assert.ok(expiresAt instanceof Date);

  const user = await getSessionUser(token);
  assert.equal(user.id, adminUserId);
  assert.equal(user.role, "super_admin");
});

test("getSessionUser returns null for an unknown or missing token", async () => {
  assert.equal(await getSessionUser("no-such-token"), null);
  assert.equal(await getSessionUser(undefined), null);
  assert.equal(await getSessionUser(""), null);
});

test("getSessionUser returns null once expired", async () => {
  const { token } = await createSession(adminUserId);
  await testQuery(`update admin_session set expires_at = now() - interval '1 second' where id = $1`, [
    token,
  ]);
  assert.equal(await getSessionUser(token), null);
});

test("deleteSession revokes the token", async () => {
  const { token } = await createSession(adminUserId);
  assert.ok(await getSessionUser(token));
  await deleteSession(token);
  assert.equal(await getSessionUser(token), null);
});

test("deleteSession on an unknown token is a harmless no-op", async () => {
  await assert.doesNotReject(() => deleteSession("no-such-token"));
  await assert.doesNotReject(() => deleteSession(undefined));
});

test("parseCookies reads the session cookie out of a raw Cookie header", () => {
  const req = { headers: { cookie: `foo=bar; ${SESSION_COOKIE_NAME}=abc123; baz=qux` } };
  assert.equal(parseCookies(req)[SESSION_COOKIE_NAME], "abc123");
  assert.equal(parseCookies({ headers: {} })[SESSION_COOKIE_NAME], undefined);
});

test("serializeSessionCookie sets HttpOnly/SameSite/Path and Secure only when asked", () => {
  const insecure = serializeSessionCookie("tok", { secure: false });
  assert.match(insecure, /HttpOnly/);
  assert.match(insecure, /SameSite=Lax/);
  assert.match(insecure, /Path=\/api\/admin/);
  assert.ok(!insecure.includes("Secure"));

  const secure = serializeSessionCookie("tok", { secure: true });
  assert.match(secure, /Secure/);
});

test("clearSessionCookieHeader expires the cookie immediately (Max-Age=0)", () => {
  assert.match(clearSessionCookieHeader({ secure: false }), /Max-Age=0/);
});
