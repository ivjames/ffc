// End-to-end coverage for the pre-auth admin set-password flow
// (/api/admin/password/*): forgot (invite re-send + reset, non-enumeration),
// token-check, set (auto-login), single-use/expiry/superseding semantics, and
// the rate limits. Mail is read from the intercepted console mailer, like a
// real inbox (the auth.integration.test.js recipe).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.MAIL_PROVIDER; // console mailer — links land in stdout

const { app } = await import("../../app.js");
const { resetPasswordRateLimits } = await import("./passwordReset.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

let baseUrl, close;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const userIds = [];

// Capture the console mailer's output to extract set-password links.
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
function lastMail() {
  return mailLog[mailLog.length - 1] ?? "";
}
function lastToken() {
  const m = lastMail().match(/set-password\?token=([0-9a-f]{64})/);
  return m?.[1];
}

async function insertUser({ email, pending }) {
  const row = await testQuery(
    `insert into admin_user (email, role, org_id, password_hash)
       values ($1, 'super_admin', null, $2) returning id`,
    [email, pending ? null : hashPassword("old-password-1")]
  );
  userIds.push(row.rows[0].id);
  return row.rows[0].id;
}

function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionCookie(res) {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/ffc_admin_session=([^;]+)/);
  return m ? `ffc_admin_session=${m[1]}` : null;
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  console.log = realLog;
  if (close) await close();
  // Token + session rows cascade off admin_user; audit rows don't.
  await testQuery(`delete from admin_audit where entity = 'admin_user' and entity_id = any($1::uuid[])`, [
    userIds,
  ]);
  await testQuery(`delete from admin_user where id = any($1::uuid[])`, [userIds]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

beforeEach(() => {
  resetPasswordRateLimits();
  captureMail();
});

test("forgot for a pending (invited, no password) user mails an invite link", async () => {
  const email = `pw-pending-${stamp}@example.com`;
  const userId = await insertUser({ email, pending: true });

  const res = await post("/api/admin/password/forgot", { email });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const token = lastToken();
  assert.ok(token, "console mailer should have logged a set-password link");
  assert.match(lastMail(), /invited to Master Control/);
  assert.match(lastMail(), /7 days/);

  const row = await testQuery(
    `select kind, used_at from admin_password_token where admin_user_id = $1`,
    [userId]
  );
  assert.equal(row.rowCount, 1);
  assert.equal(row.rows[0].kind, "invite");
  assert.equal(row.rows[0].used_at, null);
});

test("forgot for an unknown email answers the identical body and sends no mail", async () => {
  const res = await post("/api/admin/password/forgot", {
    email: `pw-nobody-${stamp}@example.com`,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true }); // byte-identical to the found case
  assert.equal(mailLog.length, 0, "no mail for an unknown address");
});

test("forgot for an active user mails a 2-hour reset link", async () => {
  const email = `pw-active-${stamp}@example.com`;
  const userId = await insertUser({ email, pending: false });

  const res = await post("/api/admin/password/forgot", { email });
  assert.equal(res.status, 200);
  assert.match(lastMail(), /Reset your Master Control password/);
  assert.match(lastMail(), /2 hours/);

  const row = await testQuery(`select kind from admin_password_token where admin_user_id = $1`, [
    userId,
  ]);
  assert.equal(row.rows[0].kind, "reset");
});

test("full happy path: pending user can't log in, sets password via link, is auto-logged-in", async () => {
  const email = `pw-happy-${stamp}@example.com`;
  await insertUser({ email, pending: true });

  // NULL hash = no login, uniform 401.
  const early = await post("/api/admin/login", { email, password: "brand-new-password" });
  assert.equal(early.status, 401);

  await post("/api/admin/password/forgot", { email });
  const token = lastToken();
  assert.ok(token);

  // token-check lets the page greet the user before they type.
  const check = await post("/api/admin/password/token-check", { token });
  assert.equal(check.status, 200);
  assert.equal((await check.json()).email, email);

  const set = await post("/api/admin/password/set", { token, password: "brand-new-password" });
  assert.equal(set.status, 200);
  const setBody = await set.json();
  assert.equal(setBody.ok, true);
  assert.equal(setBody.user.email, email); // login-shaped response
  const cookie = sessionCookie(set);
  assert.ok(cookie, "set should auto-login with a session cookie");

  const me = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, email);

  // And the password now works for a plain login.
  const login = await post("/api/admin/login", { email, password: "brand-new-password" });
  assert.equal(login.status, 200);
});

test("a consumed token is dead: second set 410s", async () => {
  const email = `pw-reuse-${stamp}@example.com`;
  await insertUser({ email, pending: true });
  await post("/api/admin/password/forgot", { email });
  const token = lastToken();

  assert.equal((await post("/api/admin/password/set", { token, password: "password-one1" })).status, 200);
  const again = await post("/api/admin/password/set", { token, password: "password-two2" });
  assert.equal(again.status, 410);
  const check = await post("/api/admin/password/token-check", { token });
  assert.equal(check.status, 410);
});

test("an expired token 410s", async () => {
  const email = `pw-expired-${stamp}@example.com`;
  const userId = await insertUser({ email, pending: true });
  await post("/api/admin/password/forgot", { email });
  const token = lastToken();
  await testQuery(
    `update admin_password_token set expires_at = now() - interval '1 minute' where admin_user_id = $1`,
    [userId]
  );
  assert.equal((await post("/api/admin/password/token-check", { token })).status, 410);
  assert.equal((await post("/api/admin/password/set", { token, password: "password123" })).status, 410);
});

test("malformed tokens and short passwords 400 without touching the DB", async () => {
  assert.equal((await post("/api/admin/password/token-check", { token: "nope" })).status, 400);
  assert.equal((await post("/api/admin/password/token-check", {})).status, 400);
  assert.equal(
    (await post("/api/admin/password/set", { token: "zz".repeat(32), password: "password123" })).status,
    400
  );

  const email = `pw-short-${stamp}@example.com`;
  await insertUser({ email, pending: true });
  await post("/api/admin/password/forgot", { email });
  const token = lastToken();
  const short = await post("/api/admin/password/set", { token, password: "short" });
  assert.equal(short.status, 400);
  assert.match((await short.json()).error, /at least 8 characters/);
  // The 400 must not have burned the link.
  assert.equal((await post("/api/admin/password/set", { token, password: "password123" })).status, 200);
});

test("a fresh token supersedes the old one — only the newest link works", async () => {
  const email = `pw-supersede-${stamp}@example.com`;
  await insertUser({ email, pending: false });

  await post("/api/admin/password/forgot", { email });
  const first = lastToken();
  await post("/api/admin/password/forgot", { email });
  const second = lastToken();
  assert.ok(first && second && first !== second);

  assert.equal((await post("/api/admin/password/set", { token: first, password: "password123" })).status, 410);
  assert.equal((await post("/api/admin/password/set", { token: second, password: "password123" })).status, 200);
});

test("per-email forgot rate limit 429s on the 4th request", async () => {
  const email = `pw-ratelimit-${stamp}@example.com`;
  for (let i = 0; i < 3; i++) {
    assert.equal((await post("/api/admin/password/forgot", { email })).status, 200);
  }
  const res = await post("/api/admin/password/forgot", { email });
  assert.equal(res.status, 429);
  assert.ok(res.headers.get("retry-after"));
});

test("forgot validates the email shape", async () => {
  assert.equal((await post("/api/admin/password/forgot", { email: "not-an-email" })).status, 400);
  assert.equal((await post("/api/admin/password/forgot", {})).status, 400);
});
