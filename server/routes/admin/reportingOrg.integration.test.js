// Integration coverage for multi-venue reporting: the CSV export's org column
// + orgId filter (and that an org_admin cannot exfiltrate another org through
// it), and per-venue timezone bucketing in both the export and the overview
// series — a round completed at 1am at an East-coast venue must land on THAT
// venue's calendar day, not be cut at the venue's 3am by the Pacific-default
// ADMIN_TZ (the old one-global-zone bug).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "reporting-org-test-token";
// The suite's assertions are built around the historical default frame.
process.env.ADMIN_TZ = "America/Los_Angeles";

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

const NY = "America/New_York";
const PARS = Array(18).fill(3);

let baseUrl, close;
let orgAId, orgBId, orgASlug, orgBSlug;
let locationAId, locationBId;
let courseAId, courseBId;
let roundAId, roundBId;
let orgAdminACookie;
let adminUserId;
let nyToday; // YYYY-MM-DD of "today" at the NY venue when the round was seeded

function asSuper(path) {
  return fetch(`${baseUrl}${path}`, {
    headers: { "x-app-token": "reporting-org-test-token" },
  });
}

function asA(path) {
  return fetch(`${baseUrl}${path}`, { headers: { Cookie: orgAdminACookie } });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  orgASlug = `rpt-org-a-${stamp}`;
  orgBSlug = `rpt-org-b-${stamp}`;
  const orgA = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Reporting Org A ${stamp}`,
    orgASlug,
  ]);
  orgAId = orgA.rows[0].id;
  const orgB = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Reporting Org B ${stamp}`,
    orgBSlug,
  ]);
  orgBId = orgB.rows[0].id;

  // Org A's venue is East-coast; org B's has no tz (ADMIN_TZ fallback).
  const locA = await testQuery(
    `insert into location (name, slug, org_id, tz) values ($1, $2, $3, $4) returning id`,
    [`Rpt Venue A ${stamp}`, `rpt-venue-a-${stamp}`, orgAId, NY]
  );
  locationAId = locA.rows[0].id;
  const locB = await testQuery(
    `insert into location (name, slug, org_id) values ($1, $2, $3) returning id`,
    [`Rpt Venue B ${stamp}`, `rpt-venue-b-${stamp}`, orgBId]
  );
  locationBId = locB.rows[0].id;

  const courseA = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Rpt Course A", "test", PARS, locationAId]
  );
  courseAId = courseA.rows[0].id;
  const courseB = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Rpt Course B", "test", PARS, locationBId]
  );
  courseBId = courseB.rows[0].id;

  // The boundary round: completed at 01:00 TODAY in the venue's own zone.
  // At that instant it is still YESTERDAY on the US West coast, so the old
  // global-ADMIN_TZ bucketing filed it under the wrong calendar day.
  const boundary = await testQuery(
    `select (timezone($1, now())::date + time '01:00') at time zone $1 as at,
            timezone($1, now())::date::text as today`,
    [NY]
  );
  nyToday = boundary.rows[0].today;
  const rA = await testQuery(
    `insert into round (course_id, player_tags, group_tag, completed_at, client_id)
       values ($1, $2, 'TZA', $3, $4) returning id`,
    [courseAId, ["ZAA", "ZAB"], boundary.rows[0].at, `rpt-org-a-${stamp}`]
  );
  roundAId = rA.rows[0].id;
  const rB = await testQuery(
    `insert into round (course_id, player_tags, completed_at, client_id)
       values ($1, $2, now(), $3) returning id`,
    [courseBId, ["ZBA"], `rpt-org-b-${stamp}`]
  );
  roundBId = rB.rows[0].id;

  const email = `rpt-org-admin-a-${stamp}@example.com`;
  const password = "test-password-1";
  const au = await testQuery(
    `insert into admin_user (email, role, org_id, password_hash) values ($1, 'org_admin', $2, $3) returning id`,
    [email, orgAId, hashPassword(password)]
  );
  adminUserId = au.rows[0].id;
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  orgAdminACookie = login.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from admin_user where id = $1`, [adminUserId]);
  await testQuery(`delete from round where id in ($1, $2)`, [roundAId, roundBId]);
  await testQuery(`delete from course where id in ($1, $2)`, [courseAId, courseBId]);
  await testQuery(`delete from location where id in ($1, $2)`, [locationAId, locationBId]);
  await testQuery(`delete from org where id in ($1, $2)`, [orgAId, orgBId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("export: rows carry the org column, and a super_admin can filter by orgId", async () => {
  const all = await asSuper("/api/admin/export/rounds.csv");
  assert.equal(all.status, 200);
  const allText = await all.text();
  assert.match(
    allText.split("\r\n")[0],
    /^completed_at_local,org,location,course,/,
    "org column sits in the header"
  );
  assert.ok(allText.includes(orgASlug), "unfiltered export carries org A's slug");
  assert.ok(allText.includes(orgBSlug), "unfiltered export carries org B's slug");

  const onlyA = await asSuper(`/api/admin/export/rounds.csv?orgId=${orgAId}`);
  assert.equal(onlyA.status, 200);
  const onlyAText = await onlyA.text();
  assert.ok(onlyAText.includes(orgASlug));
  assert.ok(!onlyAText.includes(orgBSlug), "orgId filter excludes the other client");

  const bad = await asSuper("/api/admin/export/rounds.csv?orgId=not-a-uuid");
  assert.equal(bad.status, 400);
});

test("export: an org_admin cannot exfiltrate another org via the orgId param", async () => {
  const res = await asA(`/api/admin/export/rounds.csv?orgId=${orgBId}`);
  assert.equal(res.status, 200, "scope wins silently, like the locations list");
  const text = await res.text();
  assert.ok(!text.includes(orgBSlug), "no org B rows despite asking for org B");
  assert.ok(!text.includes("ZBA"), "org B's player rows must not appear");
  assert.ok(text.includes(orgASlug), "their own org's rows still export");
});

test("export: timestamps and day windows use the venue's own tz, not global ADMIN_TZ", async () => {
  const res = await asA("/api/admin/export/rounds.csv");
  assert.equal(res.status, 200);
  const text = await res.text();
  const rowA = text.split("\r\n").find((l) => l.includes("ZAA"));
  assert.ok(rowA, "the boundary round exports");
  assert.ok(
    rowA.startsWith(`${nyToday} 01:00,`),
    `stamp is 1am on the venue's own calendar day (${nyToday}), got: ${rowA}`
  );

  // The venue-local day window must select it too: from=to=the NY date. Under
  // the old global-Pacific bucketing this round belonged to the previous day.
  const windowed = await asA(`/api/admin/export/rounds.csv?from=${nyToday}&to=${nyToday}`);
  const windowedText = await windowed.text();
  assert.ok(windowedText.includes("ZAA"), "venue-local from/to window contains the 1am round");
});

test("series: org-scoped buckets cut at the venue's midnight and report the org's tz", async () => {
  const res = await asA("/api/admin/overview/series?days=7");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.tz, NY, "org-scoped series is framed in the org's venue zone");
  assert.equal(body.series.length, 7);

  const last = body.series[body.series.length - 1];
  assert.equal(last.date, nyToday, "the frame's last bucket is the venue's today");
  assert.equal(last.rounds, 1, "the 1am round lands on the venue's today");
  assert.equal(last.players, 2);
  const yesterday = body.series[body.series.length - 2];
  assert.equal(yesterday.rounds, 0, "…and no longer bleeds into the Pacific yesterday");
});
