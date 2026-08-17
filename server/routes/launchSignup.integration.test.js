// Integration coverage for launch-signup capture (routes/launchSignup.js) and
// its Master Control surface (routes/admin/launchSignups.js). The write side
// is an open endpoint, so the matrix leans on the things that make that safe:
// strict email validation, the honeypot, the per-IP cap — and on the upsert
// keeping one row per address without ever telling the caller it did.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const APP_TOKEN = `launch-signup-test-token-${Date.now()}`;
process.env.APP_TOKEN = APP_TOKEN;

const { app } = await import("../app.js");
const { resetLaunchSignupRateLimit } = await import("./launchSignup.js");
const { hashPassword } = await import("../lib/adminPasswords.js");

let baseUrl;
let close;
let orgId;
let orgAdminCookie;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
// Every email this file stores carries the stamp so cleanup can find the rows
// without disturbing parallel test files.
const email = (label) => `launch-${label}-${stamp}@example.com`;

function signup(body) {
  return fetch(`${baseUrl}/api/launch-signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rowFor(address) {
  return testQuery(`select * from launch_signup where email = $1`, [address]);
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  // An org_admin session, to prove the admin surface is super_admin ONLY —
  // not merely "any admin" (the users.js gate, not just requireAdminAuth).
  const org = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Launch Test Org ${stamp}`,
    `launch-test-org-${stamp}`,
  ]);
  orgId = org.rows[0].id;
  const password = "launch-test-password-1";
  await testQuery(
    `insert into admin_user (email, role, org_id, password_hash) values ($1, 'org_admin', $2, $3)`,
    [email("orgadmin"), orgId, hashPassword(password)]
  );
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email("orgadmin"), password }),
  });
  assert.equal(login.status, 200);
  orgAdminCookie = login.headers.get("set-cookie").split(";")[0];
});

beforeEach(() => {
  // Every test in this file posts from the same 127.0.0.1 bucket — start each
  // one with a clean window so only the rate-limit test ever sees a 429.
  resetLaunchSignupRateLimit();
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from launch_signup where email like $1`, [`launch-%${stamp}%`]);
  await testQuery(`delete from admin_user where email = $1`, [email("orgadmin")]);
  await testQuery(`delete from org where id = $1`, [orgId]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("a valid signup stores one consenting row from the landing page", async () => {
  const res = await signup({ email: email("valid"), consent: true });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const row = await rowFor(email("valid"));
  assert.equal(row.rowCount, 1);
  assert.equal(row.rows[0].consent, true);
  assert.equal(row.rows[0].source, "landing");
});

test("re-signing up is one row, re-stamped — and the response never says 'already on the list'", async () => {
  const address = email("dupe");
  const first = await signup({ email: address, consent: true });
  assert.equal(first.status, 200);
  const original = (await rowFor(address)).rows[0];

  // Rewind updated_at so the upsert's re-stamp is observable even when both
  // submits land inside the same clock tick.
  await testQuery(`update launch_signup set updated_at = now() - interval '1 hour' where email = $1`, [
    address,
  ]);

  const again = await signup({ email: address, consent: true });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { ok: true }, "identical body to a first signup — no enumeration");

  const row = await rowFor(address);
  assert.equal(row.rowCount, 1, "still one row");
  assert.equal(row.rows[0].id, original.id);
  assert.equal(+row.rows[0].created_at, +original.created_at, "created_at keeps the first signup");
  assert.ok(
    Math.abs(Date.now() - +row.rows[0].updated_at) < 60_000,
    "updated_at re-stamped to now, not left at the rewound hour-ago value"
  );
});

test("the email is normalized before it becomes the identity", async () => {
  const res = await signup({ email: `  Launch-CASE-${stamp}@Example.COM `, consent: true });
  assert.equal(res.status, 200);
  const row = await rowFor(`launch-case-${stamp}@example.com`);
  assert.equal(row.rowCount, 1, "stored trimmed and lowercased");
});

test("a missing or malformed email is a 400 and stores nothing", async () => {
  const countBefore = (await testQuery(`select count(*)::int as n from launch_signup`)).rows[0].n;
  for (const bad of [undefined, null, 42, "", "   ", "not-an-email", "still@nope"]) {
    const res = await signup({ email: bad, consent: true });
    assert.equal(res.status, 400, `email=${JSON.stringify(bad)}`);
    assert.deepEqual(await res.json(), { ok: false, error: "a valid email is required" });
  }
  const countAfter = (await testQuery(`select count(*)::int as n from launch_signup`)).rows[0].n;
  assert.equal(countAfter, countBefore, "no row from any rejected submit");
});

test("consent must be a literal true — absent, false, or truthy-ish is a 400", async () => {
  for (const bad of [undefined, false, null, "true", 1]) {
    const res = await signup({ email: email("noconsent"), consent: bad });
    assert.equal(res.status, 400, `consent=${JSON.stringify(bad)}`);
    assert.deepEqual(await res.json(), { ok: false, error: "consent is required" });
  }
  assert.equal((await rowFor(email("noconsent"))).rowCount, 0);
});

test("a filled honeypot gets a convincing success and stores nothing", async () => {
  const res = await signup({
    email: email("bot"),
    consent: true,
    company: "Definitely A Real Business LLC",
  });
  assert.equal(res.status, 200, "the bot must not learn it was caught");
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal((await rowFor(email("bot"))).rowCount, 0);
});

test("the 11th signup from one IP inside the window is a 429", async () => {
  for (let i = 1; i <= 10; i++) {
    const res = await signup({ email: email(`burst-${i}`), consent: true });
    assert.equal(res.status, 200, `signup ${i} is inside the cap`);
  }
  const blocked = await signup({ email: email("burst-11"), consent: true });
  assert.equal(blocked.status, 429);
  assert.equal((await rowFor(email("burst-11"))).rowCount, 0);
});

test("admin surface: unauthenticated 401, org_admin 403 — signups are super_admin only", async () => {
  for (const path of ["/api/admin/launch-signups", "/api/admin/launch-signups/export.csv"]) {
    assert.equal((await fetch(`${baseUrl}${path}`)).status, 401, `${path} without auth`);
    assert.equal(
      (await fetch(`${baseUrl}${path}`, { headers: { cookie: orgAdminCookie } })).status,
      403,
      `${path} as org_admin`
    );
  }
});

test("admin list: newest first with camelCase keys", async () => {
  await signup({ email: email("list-older"), consent: true });
  // created_at desc needs the rows apart by more than a clock tick — rewind
  // the first so ordering is deterministic.
  await testQuery(
    `update launch_signup set created_at = now() - interval '1 hour' where email = $1`,
    [email("list-older")]
  );
  await signup({ email: email("list-newer"), consent: true });

  const res = await fetch(`${baseUrl}/api/admin/launch-signups`, {
    headers: { "x-app-token": APP_TOKEN },
  });
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.ok(Array.isArray(list));

  const newer = list.find((s) => s.email === email("list-newer"));
  const older = list.find((s) => s.email === email("list-older"));
  assert.ok(newer && older, "both stamped rows are listed");
  assert.ok(list.indexOf(newer) < list.indexOf(older), "newest first");
  assert.deepEqual(
    Object.keys(newer).sort(),
    ["consent", "createdAt", "email", "id", "source", "updatedAt"],
    "camelCase row shape"
  );
  assert.equal(newer.consent, true);
  assert.equal(newer.source, "landing");
});

test("admin CSV export: attachment, CRLF lines, ISO timestamps", async () => {
  const address = email("csv");
  await signup({ email: address, consent: true });

  const res = await fetch(`${baseUrl}/api/admin/launch-signups/export.csv`, {
    headers: { "x-app-token": APP_TOKEN },
  });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type").startsWith("text/csv"));
  assert.match(
    res.headers.get("content-disposition"),
    /^attachment; filename="launch-signups_\d{4}-\d{2}-\d{2}\.csv"$/
  );

  const body = await res.text();
  assert.ok(body.endsWith("\r\n"), "CRLF-terminated");
  const lines = body.slice(0, -2).split("\r\n");
  assert.equal(lines[0], "email,consent,source,created_at,updated_at");
  assert.ok(!lines.some((l) => l.includes("\n")), "every break is CRLF, never bare LF");

  const line = lines.find((l) => l.startsWith(`${address},`));
  assert.ok(line, "the stamped signup is exported");
  const [, consent, source, createdAt, updatedAt] = line.split(",");
  assert.equal(consent, "true");
  assert.equal(source, "landing");
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  assert.match(createdAt, ISO_RE);
  assert.match(updatedAt, ISO_RE);
});
