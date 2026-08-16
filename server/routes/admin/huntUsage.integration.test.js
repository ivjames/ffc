// Integration coverage for /api/admin/hunt-usage — the vision-spend rollup.
// Rows are inserted straight into hunt_scan (no vision mock needed): this
// endpoint only reads the metering table. Covers both metered kinds — player
// 'verify' scans (priced at read time from the Haiku constants) and admin
// item-image 'screen' scans (cost stamped at write time) — plus the org
// dimension: every row carries orgId/orgName, and orgSummary pre-aggregates
// per org per month for invoicing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "hunt-usage-test-token";

const { app } = await import("../../app.js");

let baseUrl;
let close;
let orgId;
let orgName;
let locationId;
let courseId;

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "hunt-usage-test-token",
      ...opts.headers,
    },
  });
}

// One metered verify scan; 1500 in / 80 out mirrors a realistic Haiku verdict call.
function insertScan({ roundClientId, createdAt = "now()" }) {
  return testQuery(
    `insert into hunt_scan
       (round_client_id, player_tag, course_id, model, input_tokens, output_tokens, verified, flagged, created_at)
     values ($1, 'T01', $2, 'claude-haiku-4-5', 1500, 80, true, false, ${createdAt})`,
    [roundClientId, courseId]
  );
}

// One metered admin people-screen (routes/admin/huntItems.js writes these):
// kind='screen', no round/player, exact cost stamped at write time.
function insertScreen({ cost = 0.0002 }) {
  return testQuery(
    `insert into hunt_scan
       (kind, course_id, model, input_tokens, output_tokens, cost_usd)
     values ('screen', $1, 'gemini-3.1-flash-lite', 300, 20, $2)`,
    [courseId, cost]
  );
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  orgName = `Usage Test Org ${stamp}`;
  const org = await testQuery(
    `insert into org (name, slug) values ($1, $2) returning id`,
    [orgName, `usage-test-org-${stamp}`]
  );
  orgId = org.rows[0].id;
  const loc = await testQuery(
    `insert into location (name, slug, org_id) values ($1, $2, $3) returning id`,
    [`Usage Test Venue ${stamp}`, `usage-test-${stamp}`, orgId]
  );
  locationId = loc.rows[0].id;

  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Usage Test Course", "test", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;

  // Current month: two rounds — 3 scans + 2 scans — plus two admin screens.
  for (let i = 0; i < 3; i++) await insertScan({ roundClientId: "usage-round-a" });
  for (let i = 0; i < 2; i++) await insertScan({ roundClientId: "usage-round-b" });
  await insertScreen({ cost: 0.0002 });
  await insertScreen({ cost: 0.0002 });
  // An older scan, 3 months back — excluded at months=1, included at months=6.
  await insertScan({
    roundClientId: "usage-round-old",
    createdAt: "now() - interval '3 months'",
  });
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from hunt_scan where course_id = $1`, [courseId]);
  await testQuery(`delete from course where id = $1`, [courseId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  await testQuery(`delete from org where id = $1`, [orgId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("GET /api/admin/hunt-usage requires admin auth", async () => {
  const res = await fetch(`${baseUrl}/api/admin/hunt-usage`);
  assert.equal(res.status, 401);
});

test("rolls up rounds, scans, tokens, and cost per venue per month, with the org attached", async () => {
  const res = await api("/api/admin/hunt-usage?months=6");
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.months, 6);
  assert.equal(body.pricing.model, "claude-haiku-4-5");

  const mine = body.rows.filter((r) => r.locationId === locationId);
  assert.equal(mine.length, 2, "current month + the 3-months-back month");

  const [current, old] = mine; // ordered month desc
  assert.equal(current.locationName.startsWith("Usage Test Venue"), true);
  // The venue's org rides on every row — the invoice dimension.
  assert.equal(current.orgId, orgId);
  assert.equal(current.orgName, orgName);
  assert.equal(current.huntRounds, 2, "screen rows carry no round — only verify rounds count");
  // Totals span both kinds; the split labels them.
  assert.equal(current.scans, 7);
  assert.equal(current.verifyScans, 5);
  assert.equal(current.screenScans, 2);
  assert.equal(current.inputTokens, 5 * 1500 + 2 * 300);
  assert.equal(current.outputTokens, 5 * 80 + 2 * 20);
  // Verify cost from token math: (7500 * $1 + 400 * $5) / 1M = $0.0095.
  assert.equal(current.verifyCostUsd, 0.0095);
  // Screen cost is the stored exact per-call spend: 2 × $0.0002.
  assert.equal(current.screenCostUsd, 0.0004);
  // Total rounds to a cent: 0.0095 + 0.0004 = 0.0099 → $0.01.
  assert.equal(current.apiCostUsd, 0.01);

  assert.equal(old.huntRounds, 1);
  assert.equal(old.scans, 1);
  assert.equal(old.screenScans, 0);
  assert.equal(old.orgId, orgId);
});

test("orgSummary pre-aggregates verify + screen spend per org per month", async () => {
  const res = await api("/api/admin/hunt-usage?months=6");
  const body = await res.json();

  const mine = body.orgSummary.filter((s) => s.orgId === orgId);
  assert.equal(mine.length, 2, "current month + the 3-months-back month");
  const [current, old] = mine; // sorted month desc
  assert.equal(current.orgName, orgName);
  assert.equal(current.huntRounds, 2);
  assert.equal(current.scans, 7);
  assert.equal(current.verifyScans, 5);
  assert.equal(current.screenScans, 2);
  assert.equal(current.inputTokens, 5 * 1500 + 2 * 300);
  assert.equal(current.outputTokens, 5 * 80 + 2 * 20);
  assert.equal(current.apiCostUsd, 0.01, "one number per org per month — zero client-side math");

  assert.equal(old.scans, 1);
  assert.equal(old.orgName, orgName);
});

test("months=1 keeps only the current calendar month; out-of-range values clamp", async () => {
  const res = await api("/api/admin/hunt-usage?months=1");
  assert.equal(res.status, 200);
  const body = await res.json();
  const mine = body.rows.filter((r) => r.locationId === locationId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].scans, 7);

  const clamped = await api("/api/admin/hunt-usage?months=9999");
  assert.equal((await clamped.json()).months, 24);
  const defaulted = await api("/api/admin/hunt-usage?months=nonsense");
  assert.equal((await defaulted.json()).months, 6);
});

test("an org_admin sees only their own org's rows and summary", async () => {
  const { hashPassword } = await import("../../lib/adminPasswords.js");
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // A second org with no scans: its admin must see NO rows at all — not the
  // fixture org's spend, and not unattributed (null-location) spend either.
  const otherOrg = await testQuery(
    `insert into org (name, slug) values ($1, $2) returning id`,
    [`Usage Other Org ${stamp}`, `usage-other-org-${stamp}`]
  );
  const email = `usage-org-admin-${stamp}@test.local`;
  const user = await testQuery(
    `insert into admin_user (email, role, org_id, password_hash)
       values ($1, 'org_admin', $2, $3) returning id`,
    [email, otherOrg.rows[0].id, hashPassword("usage-test-pass")]
  );
  try {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "usage-test-pass" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];

    const res = await fetch(`${baseUrl}/api/admin/hunt-usage?months=6`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.rows.length, 0, "another org's spend is invisible");
    assert.equal(body.orgSummary.length, 0);
  } finally {
    await testQuery(`delete from admin_session where admin_user_id = $1`, [user.rows[0].id]);
    await testQuery(`delete from admin_user where id = $1`, [user.rows[0].id]);
    await testQuery(`delete from org where id = $1`, [otherOrg.rows[0].id]);
  }
});
