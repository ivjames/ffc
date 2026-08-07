// End-to-end player auth flow over HTTP against the real app + test DB:
// request-code -> (grab the code from the intercepted console mailer) ->
// verify -> me -> patch -> logout, plus the failure paths (bad code, attempt
// lockout, expiry, magic link, enumeration-uniform responses).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, testQuery, listenEphemeral } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.MAIL_PROVIDER; // console mailer — codes land in stdout

const { app } = await import("../app.js");
const { resetAuthRateLimits } = await import("./auth.js");
const { MAX_ATTEMPTS } = await import("../lib/authCodes.js");

let baseUrl, close;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const EMAIL = `player-${stamp}@example.com`;

// Capture the console mailer's output to extract codes/links like a real inbox.
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
function lastCode() {
  const m = lastMail().match(/sign-in code is: ([0-9]{6})/);
  return m?.[1];
}
function lastMagicToken() {
  const m = lastMail().match(/token=([0-9a-f]{64})/);
  return m?.[1];
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  console.log = realLog;
  await close();
  await testQuery(`delete from app_user where email like $1`, [`player-${stamp}%`]);
  await testQuery(`delete from auth_code where email like $1`, [`player-${stamp}%`]);
  const { pool } = await import("../db.js");
  await pool.end();
});

beforeEach(() => {
  resetAuthRateLimits();
  captureMail();
});

async function requestCode(email, profile) {
  return fetch(`${baseUrl}/api/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, profile }),
  });
}

async function verify(email, code) {
  return fetch(`${baseUrl}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
}

function sessionCookie(res) {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/ffc_session=([^;]+)/);
  return m ? `ffc_session=${m[1]}` : null;
}

test("request-code + verify registers the user, applies profile, sets a session", async () => {
  const reqRes = await requestCode(EMAIL, {
    phone: "(415) 555-0100",
    displayName: "Test Player",
    defaultTag: "TPL",
  });
  assert.equal(reqRes.status, 200);
  const code = lastCode();
  assert.ok(code, "console mailer should have logged a 6-digit code");

  const verifyRes = await verify(EMAIL, code);
  assert.equal(verifyRes.status, 200);
  const body = await verifyRes.json();
  assert.equal(body.user.email, EMAIL);
  assert.equal(body.user.phone, "+14155550100");
  assert.equal(body.user.displayName, "Test Player");
  assert.equal(body.user.defaultTag, "TPL");
  assert.ok(body.user.emailVerifiedAt);

  const cookie = sessionCookie(verifyRes);
  assert.ok(cookie, "verify should set the ffc_session cookie");
  const setCookie = verifyRes.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /SameSite=Lax/);

  // Session works on /me.
  const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(meRes.status, 200);
  const me = await meRes.json();
  assert.equal(me.user.email, EMAIL);

  // A code is single-use.
  const reuse = await verify(EMAIL, code);
  assert.equal(reuse.status, 401);
});

test("a second sign-in keeps the existing profile (stash doesn't clobber)", async () => {
  await requestCode(EMAIL, { displayName: "Different Name" });
  const code = lastCode();
  const verifyRes = await verify(EMAIL, code);
  assert.equal(verifyRes.status, 200);
  const body = await verifyRes.json();
  assert.equal(body.user.displayName, "Test Player"); // original wins
});

test("wrong code 401s uniformly and locks after MAX_ATTEMPTS", async () => {
  const email = `player-${stamp}-lock@example.com`;
  await requestCode(email);
  const code = lastCode();
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const res = await verify(email, code === "000000" ? "000001" : "000000");
    assert.equal(res.status, 401);
  }
  // Even the RIGHT code fails now — the row is dead.
  const res = await verify(email, code);
  assert.equal(res.status, 401);
});

test("expired codes are rejected", async () => {
  const email = `player-${stamp}-exp@example.com`;
  await requestCode(email);
  const code = lastCode();
  await testQuery(`update auth_code set expires_at = now() - interval '1 minute' where email = $1`, [email]);
  const res = await verify(email, code);
  assert.equal(res.status, 401);
});

test("magic link signs in via redirect and is single-use", async () => {
  const email = `player-${stamp}-magic@example.com`;
  await requestCode(email);
  const token = lastMagicToken();
  assert.ok(token);

  const res = await fetch(`${baseUrl}/api/auth/magic?token=${token}`, { redirect: "manual" });
  assert.equal(res.status, 302);
  const cookie = sessionCookie(res);
  assert.ok(cookie, "magic link should set the session cookie");

  const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal((await meRes.json()).user.email, email);

  // Second click: consumed — redirects to the expired page, no cookie.
  const again = await fetch(`${baseUrl}/api/auth/magic?token=${token}`, { redirect: "manual" });
  assert.equal(again.status, 302);
  assert.match(again.headers.get("location"), /expired/);
  assert.equal(sessionCookie(again), null);
});

test("request-code responds with the same shape for new and existing addresses", async () => {
  const fresh = await requestCode(`player-${stamp}-fresh@example.com`);
  const existing = await requestCode(EMAIL);
  assert.equal(fresh.status, 200);
  assert.equal(existing.status, 200);
  // The bypass code differs per request by design; the SHAPE must not — a
  // field present only for known (or only unknown) emails would enumerate.
  const freshBody = await fresh.json();
  const existingBody = await existing.json();
  assert.deepEqual(Object.keys(freshBody).sort(), Object.keys(existingBody).sort());
  assert.equal(freshBody.ok, true);
  assert.equal(existingBody.ok, true);
});

test("bypass: with no mail provider, request-code returns the code directly and it verifies", async () => {
  const email = `player-${stamp}-bypass@example.com`;
  const res = await requestCode(email);
  const body = await res.json();
  assert.match(body.bypassCode, /^[0-9]{6}$/);
  const verifyRes = await verify(email, body.bypassCode);
  assert.equal(verifyRes.status, 200);
  assert.ok(sessionCookie(verifyRes));
});

test("bypass retires itself the moment a real mail provider is configured", async (t) => {
  process.env.MAIL_PROVIDER = "resend"; // no RESEND_API_KEY → send fails silently
  t.after(() => {
    delete process.env.MAIL_PROVIDER;
  });
  const res = await requestCode(`player-${stamp}-nobypass@example.com`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.bypassCode, undefined);
});

test("per-email send rate limit 429s after 3 requests", async () => {
  const email = `player-${stamp}-rl@example.com`;
  for (let i = 0; i < 3; i++) {
    assert.equal((await requestCode(email)).status, 200);
  }
  const res = await requestCode(email);
  assert.equal(res.status, 429);
  assert.ok(res.headers.get("retry-after"));
});

test("PATCH /me updates profile fields; logout kills the session", async () => {
  await requestCode(EMAIL);
  const verifyRes = await verify(EMAIL, lastCode());
  const cookie = sessionCookie(verifyRes);

  const patchRes = await fetch(`${baseUrl}/api/auth/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ displayName: "Renamed", phone: null }),
  });
  assert.equal(patchRes.status, 200);
  const patched = await patchRes.json();
  assert.equal(patched.user.displayName, "Renamed");
  assert.equal(patched.user.phone, null);
  assert.equal(patched.user.defaultTag, "TPL"); // untouched field survives

  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(logoutRes.status, 200);
  const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(meRes.status, 401);
});

test("sliding session re-issues the cookie once it's a day into its window", async () => {
  await requestCode(EMAIL);
  const verifyRes = await verify(EMAIL, lastCode());
  const cookie = sessionCookie(verifyRes);
  const token = cookie.split("=")[1];

  // Fresh session: /me must NOT re-send the cookie (no write per request).
  const fresh = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(fresh.headers.get("set-cookie"), null);

  // Age the session by 2 days (28 of 30 remaining) — the next use slides the
  // DB expiry AND must re-send the cookie so the browser's Max-Age slides too.
  await testQuery(`update user_session set expires_at = now() + interval '28 days' where id = $1`, [
    token,
  ]);
  const aged = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(aged.status, 200);
  const setCookie = aged.headers.get("set-cookie");
  assert.ok(setCookie, "sliding refresh should re-issue the session cookie");
  assert.match(setCookie, new RegExp(`ffc_session=${token}`));
  assert.match(setCookie, /Max-Age=2592000/); // full 30 days again
  const expiry = await testQuery(`select expires_at from user_session where id = $1`, [token]);
  assert.ok(new Date(expiry.rows[0].expires_at).getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000);
});

test("me without a cookie 401s; PATCH without a cookie 401s", async () => {
  assert.equal((await fetch(`${baseUrl}/api/auth/me`)).status, 401);
  const patch = await fetch(`${baseUrl}/api/auth/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "X" }),
  });
  assert.equal(patch.status, 401);
});

test("invalid email / profile 400", async () => {
  assert.equal((await requestCode("not-an-email")).status, 400);
  assert.equal((await requestCode(EMAIL, { phone: "nope" })).status, 400);
});
