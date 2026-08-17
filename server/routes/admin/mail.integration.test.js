// Integration coverage for /api/admin/mail — the diagnostics an operator uses
// to decide whether transactional email is actually wired up.
//
// The endpoints exist because Resend fails SILENTLY: an unverified domain, a
// key with a stray newline, a MAIL_FROM on the wrong domain all look identical
// from inside the app (nothing throws, nothing 500s). So the contract worth
// pinning down is:
//   - NO CREDENTIAL EVER COMES BACK, only whether one is set. A read-the-key-
//     back endpoint would be a far worse problem than the one it solves.
//   - A FAILED SEND IS A 200 WITH ok:false AND THE PROVIDER'S OWN WORDS. The
//     request succeeded; the SEND failed, and a masked error leaves the
//     operator exactly where they started.
//   - super_admin ONLY. It mails arbitrary addresses and prints raw provider
//     errors.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "admin-mail-test-token";
delete process.env.MAIL_PROVIDER; // console mailer — no real delivery

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

let baseUrl, close, orgAdminCookie;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const cleanup = { users: [], orgs: [] };

// Env this file rewrites per test, restored in beforeEach so one test's
// misconfiguration can't leak into the next one's assertions.
const OWNED_ENV = [
  "MAIL_PROVIDER",
  "MAIL_FROM",
  "MAIL_SENDING_DOMAINS",
  "MAIL_DAILY_CAP",
  "MAIL_GLOBAL_DAILY_CAP",
  "RESEND_API_KEY",
  "PLATFORM_FQDN",
  "PUBLIC_APP_URL",
];

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "admin-mail-test-token",
      ...opts.headers,
    },
  });
}

const realLog = console.log;
let mailLog = [];

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const org = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Mail Admin Org ${stamp}`,
    `mail-admin-org-${stamp}`,
  ]);
  cleanup.orgs.push(org.rows[0].id);
  const email = `mail-org-admin-${stamp}@example.com`;
  const user = await testQuery(
    `insert into admin_user (email, role, org_id, password_hash)
       values ($1, 'org_admin', $2, $3) returning id`,
    [email, org.rows[0].id, hashPassword("test-password-1")]
  );
  cleanup.users.push(user.rows[0].id);
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "test-password-1" }),
  });
  orgAdminCookie = login.headers.get("set-cookie").split(";")[0];

  console.log = (...args) => {
    const line = args.join(" ");
    if (line.startsWith("[mailer]")) mailLog.push(line);
    else realLog(...args);
  };
});

after(async () => {
  console.log = realLog;
  if (close) await close();
  await testQuery(`delete from mail_send where recipient like $1`, [`mailtest-${stamp}%`]);
  await testQuery(`delete from admin_user where id = any($1::uuid[])`, [cleanup.users]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [cleanup.orgs]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

beforeEach(() => {
  mailLog = [];
  for (const k of OWNED_ENV) delete process.env[k];
});

test("status reports the shape of the config without ever returning a secret", async () => {
  process.env.MAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "re_super_secret_value";
  process.env.MAIL_FROM = "FFC <noreply@ffc.test>";
  process.env.PLATFORM_FQDN = "ffc.test";

  const res = await api("/api/admin/mail/status");
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.provider, "resend");
  assert.equal(body.delivers, true);
  assert.equal(body.credentialSet, true);
  assert.equal(body.from, "FFC <noreply@ffc.test>");
  assert.equal(body.platformFqdn, "ffc.test");
  assert.ok(typeof body.linkOrigin === "string" && body.linkOrigin.length > 0);
  // The value must not appear anywhere in the response, under any key.
  assert.doesNotMatch(JSON.stringify(body), /re_super_secret_value/);
});

test("credentialSet tracks the provider's own credential, not just any key", async () => {
  process.env.MAIL_PROVIDER = "resend";
  const missing = await (await api("/api/admin/mail/status")).json();
  assert.equal(missing.credentialSet, false);
  assert.equal(missing.delivers, true, "resend still 'delivers' — that's what makes it dangerous");

  // console needs no credential, so it is never reported as missing one.
  delete process.env.MAIL_PROVIDER;
  const console_ = await (await api("/api/admin/mail/status")).json();
  assert.equal(console_.credentialSet, true);
  assert.equal(console_.delivers, false);
});

test("status reports the caps the mailer will actually enforce, kill switch included", async () => {
  // Blank is the .env.example shape: it must read as the default, not 0.
  process.env.MAIL_DAILY_CAP = "";
  const blank = await (await api("/api/admin/mail/status")).json();
  assert.equal(blank.dailyCap, 500);
  assert.equal(blank.globalDailyCap, 2000);

  // An explicit 0 IS the kill switch, and the screen has to show it as one.
  process.env.MAIL_DAILY_CAP = "0";
  const off = await (await api("/api/admin/mail/status")).json();
  assert.equal(off.dailyCap, 0);
});

test("status carries the startup preflight's findings, so a fix can be confirmed here", async () => {
  process.env.MAIL_PROVIDER = "resend";
  process.env.MAIL_FROM = "FFC <noreply@somewhere-else.test>";
  process.env.PLATFORM_FQDN = "ffc.test";

  const broken = await (await api("/api/admin/mail/status")).json();
  const codes = broken.warnings.map((w) => w.code);
  assert.ok(codes.includes("resend_key_missing"), codes.join(","));
  assert.ok(codes.includes("mail_from_domain_mismatch"), codes.join(","));
  for (const w of broken.warnings) assert.ok(w.fix.length > 20, `no fix for ${w.code}`);
  assert.deepEqual(broken.sendingDomains, ["ffc.test"]);

  process.env.RESEND_API_KEY = "re_key";
  process.env.MAIL_FROM = "FFC <noreply@ffc.test>";
  const fixed = await (await api("/api/admin/mail/status")).json();
  assert.deepEqual(fixed.warnings, []);
});

test("a test send on the console provider succeeds but says plainly that nothing was delivered", async () => {
  const to = `mailtest-${stamp}-console@example.com`;
  const res = await api("/api/admin/mail/test", {
    method: "POST",
    body: JSON.stringify({ to }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.delivered, false);
  assert.match(body.note, /nothing was actually delivered/i);

  // Metered like any other send — the test message spends real quota.
  const metered = await testQuery(`select kind from mail_send where recipient = $1`, [to]);
  assert.equal(metered.rows[0].kind, "admin_test");
});

test("a failed send is a 200 with ok:false carrying the provider's own error text", async () => {
  process.env.MAIL_PROVIDER = "resend"; // no key: sendResend fails without a network call
  const res = await api("/api/admin/mail/test", {
    method: "POST",
    body: JSON.stringify({ to: `mailtest-${stamp}-fail@example.com` }),
  });
  // 200, not 5xx: the REQUEST worked. Treating this as an error would hide the
  // one string the operator needs.
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.delivered, false);
  assert.match(body.error, /RESEND_API_KEY is not set/);
});

test("the recipient is validated, and masked in the audit trail", async () => {
  const bad = await api("/api/admin/mail/test", {
    method: "POST",
    body: JSON.stringify({ to: "not-an-address" }),
  });
  assert.equal(bad.status, 400);

  const to = `mailtest-${stamp}-audit@example.com`;
  await api("/api/admin/mail/test", { method: "POST", body: JSON.stringify({ to }) });
  const audit = await testQuery(
    `select detail from admin_audit where action = 'mail.test' order by created_at desc limit 1`
  );
  // admin_audit is read by more people than the person who typed the address.
  assert.equal(audit.rows[0].detail.to, `m***@example.com`);
  assert.doesNotMatch(JSON.stringify(audit.rows[0].detail), new RegExp(stamp));
});

test("an org_admin gets nothing from either endpoint", async () => {
  const asOrgAdmin = (path, opts = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Cookie: orgAdminCookie, ...opts.headers },
    });

  assert.equal((await asOrgAdmin("/api/admin/mail/status")).status, 403);
  const send = await asOrgAdmin("/api/admin/mail/test", {
    method: "POST",
    body: JSON.stringify({ to: `mailtest-${stamp}-forbidden@example.com` }),
  });
  assert.equal(send.status, 403);
  assert.deepEqual(mailLog, []);
});
