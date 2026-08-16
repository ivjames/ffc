// Integration coverage for per-org mail metering: MAIL_DAILY_CAP counts per
// mail_send.org_slug (one client at cap must NOT lock another client's — or
// the null pool's — sends out), the platform-wide MAIL_GLOBAL_DAILY_CAP
// backstop still trips across pools, and the player auth route attributes its
// OTP sends to the tenant resolved from the request's subdomain.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { TEST_DATABASE_URL, ensureSchema, testQuery } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.MAIL_PROVIDER; // console provider — no real delivery
const CAP = 50; // generous headroom over what parallel test files send
process.env.MAIL_DAILY_CAP = String(CAP);
process.env.MAIL_GLOBAL_DAILY_CAP = "100000"; // parked out of the way until its test

const { sendMail, resolveGlobalDailyCap } = await import("./mailer.js");
const { clearTenantCache } = await import("./tenant.js");
const { app } = await import("../app.js");

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG_A = `cap-org-a-${stamp}`;
const ORG_B = `cap-org-b-${stamp}`;
const ORG_C = `cap-org-c-${stamp}`;

// The console mailer prints full messages — keep test output clean, the way
// auth.integration.test.js does.
const realLog = console.log;

async function fillPool(orgSlug, n) {
  await testQuery(
    `insert into mail_send (recipient, kind, org_slug)
       select 'pool@example.com', 'otp', $1 from generate_series(1, $2::int)`,
    [orgSlug, n]
  );
}

before(async () => {
  await ensureSchema();
  // The table is a rolling rate-limit ledger; start this suite from a clean
  // one so leftovers from earlier runs can't pre-trip a pool. (No other test
  // file asserts on mail_send contents.)
  await testQuery(`delete from mail_send`);
  console.log = (...args) => {
    if (!String(args[0] ?? "").startsWith("[mailer]")) realLog(...args);
  };
});

after(async () => {
  console.log = realLog;
  await testQuery(`delete from mail_send where org_slug like $1`, [`cap-org-%-${stamp}`]);
  await testQuery(`delete from org where slug = $1`, [ORG_C]);
  await testQuery(`delete from app_user where email like $1`, [`cap-player-${stamp}%`]);
  await testQuery(`delete from auth_code where email like $1`, [`cap-player-${stamp}%`]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("MAIL_GLOBAL_DAILY_CAP resolves like MAIL_DAILY_CAP: blank = 4x per-org default, 0 = kill switch", () => {
  // (No `undefined` case: that hits the default parameter, i.e. this suite's
  // own MAIL_GLOBAL_DAILY_CAP env — blank/null cover the unset semantics.)
  assert.equal(resolveGlobalDailyCap(""), 4 * CAP);
  assert.equal(resolveGlobalDailyCap(null), 4 * CAP);
  assert.equal(resolveGlobalDailyCap("garbage"), 4 * CAP);
  assert.equal(resolveGlobalDailyCap("0"), 0);
  assert.equal(resolveGlobalDailyCap("77"), 77);
});

test("org A at its daily cap does not block org B or the null pool", async () => {
  await fillPool(ORG_A, CAP);

  const blocked = await sendMail({
    to: "a@example.com",
    subject: "s",
    text: "t",
    kind: "otp",
    orgSlug: ORG_A,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "daily send cap reached");

  const orgB = await sendMail({
    to: "b@example.com",
    subject: "s",
    text: "t",
    kind: "otp",
    orgSlug: ORG_B,
  });
  assert.equal(orgB.ok, true, "org B sends despite org A being capped");
  const metered = await testQuery(
    `select count(*)::int as n from mail_send where org_slug = $1`,
    [ORG_B]
  );
  assert.equal(metered.rows[0].n, 1, "the send was metered under org B's slug");

  const nullPool = await sendMail({ to: "n@example.com", subject: "s", text: "t", kind: "otp" });
  assert.equal(nullPool.ok, true, "unattributed sends have their own pool, not org A's");
});

test("the null pool at cap blocks only unattributed sends, not an org's", async () => {
  await fillPool(null, CAP);

  const blocked = await sendMail({ to: "n2@example.com", subject: "s", text: "t", kind: "otp" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "daily send cap reached");

  const orgC = await sendMail({
    to: "c@example.com",
    subject: "s",
    text: "t",
    kind: "otp",
    orgSlug: ORG_C,
  });
  assert.equal(orgC.ok, true, "a client is unaffected by the null pool being full");
});

test("the platform-wide backstop still trips across all pools", async () => {
  // Well over 100 rows are in the ledger by now (org A's 50 + the null 50).
  process.env.MAIL_GLOBAL_DAILY_CAP = "10";
  try {
    const res = await sendMail({
      to: "fresh@example.com",
      subject: "s",
      text: "t",
      kind: "otp",
      orgSlug: `cap-org-fresh-${stamp}`,
    });
    assert.equal(res.ok, false, "an org with zero sends is still stopped by the global backstop");
    assert.equal(res.error, "daily send cap reached");
  } finally {
    process.env.MAIL_GLOBAL_DAILY_CAP = "100000";
  }
});

test("request-code attributes its OTP send to the tenant resolved from the subdomain", async () => {
  await testQuery(`insert into org (name, slug) values ($1, $2)`, [`Cap Org C ${stamp}`, ORG_C]);
  clearTenantCache();

  const email = `cap-player-${stamp}@example.com`;
  const res = await request(app)
    .post("/api/auth/request-code")
    .set("Host", `${ORG_C}.minigolf.example`)
    .send({ email });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);

  const row = await testQuery(`select org_slug from mail_send where recipient = $1`, [email]);
  assert.equal(row.rowCount, 1);
  assert.equal(row.rows[0].org_slug, ORG_C, "the OTP send is metered under the serving org");
});
