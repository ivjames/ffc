// Integration coverage for the synthetic load bot's multi-org path:
//   - GET /api/synthetic/catalog: the x-synthetic-key gate, and the cross-org
//     course list (live orgs only, suspended/archived excluded),
//   - POST /api/rounds: an AUTHORISED synthetic round plays a course at ANY
//     org, even though the request's Host resolves to the default org — the
//     regression that made the bot die with "no live courses at location <id>"
//     and, past that, "courseId does not exist" for every non-default tenant.
//   - a REAL round on the same course stays tenant-scoped (404-equivalent).
// Uses hostRequest so the Host header can be set per request (node's fetch
// forbids it).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { hostRequest } from "../test-support/hostRequest.js";
import { TEST_DATABASE_URL, ensureSchema, testQuery } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SYNTHETIC_BOT_KEY = "test-catalog-key"; // feature enabled for this file
const KEY = process.env.SYNTHETIC_BOT_KEY;

const { app } = await import("../app.js");
const { clearTenantCache } = await import("../lib/tenant.js");

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const slugOther = `syn-other-${stamp}`; // live org, NOT the default tenant
const slugSuspended = `syn-susp-${stamp}`;
// A host whose first label matches no org → default-org fallback, exactly like
// the loopback host the Master Control runner launches the bot with.
const FALLBACK_HOST = `nomatch-${stamp}.minigolf.example`;

let orgOtherId, orgSuspendedId;
let locOtherId, locSuspendedId;
let courseOtherId, courseSuspendedId;
const clientIds = [];

function request(opts) {
  clearTenantCache(); // fresh resolution per case — the 30s TTL outlives a run
  return hostRequest(app, { host: FALLBACK_HOST, ...opts });
}

const catalog = (headers) => request({ path: "/api/synthetic/catalog", headers });

// A round on `courseId`, synthetic unless told otherwise.
function roundBody(courseId, extra = {}) {
  const clientId = `synthetic:test-${stamp}:${clientIds.length}-${Math.random()}`;
  clientIds.push(clientId);
  return {
    clientId,
    courseId,
    playerTags: ["BOT"],
    createdAt: Date.now(),
    completedAt: Date.now(),
    scores: { 0: Array(18).fill(3) },
    synthetic: true,
    ...extra,
  };
}

async function insertOrg(name, slug, status = "active") {
  const db = await testQuery(
    `insert into org (name, slug, status) values ($1, $2, $3) returning id`,
    [name, slug, status]
  );
  return db.rows[0].id;
}

async function insertVenue(name, slug, orgId) {
  const loc = await testQuery(
    `insert into location (name, slug, org_id, tz) values ($1, $2, $3, 'America/Los_Angeles')
     returning id`,
    [name, slug, orgId]
  );
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, 'test', $2, $3) returning id`,
    [`${name} Course`, Array(18).fill(3), loc.rows[0].id]
  );
  return { locationId: loc.rows[0].id, courseId: course.rows[0].id };
}

before(async () => {
  await ensureSchema();
  orgOtherId = await insertOrg(`Synthetic Other Org ${stamp}`, slugOther);
  orgSuspendedId = await insertOrg(`Synthetic Susp Org ${stamp}`, slugSuspended, "suspended");
  ({ locationId: locOtherId, courseId: courseOtherId } = await insertVenue(
    `Synthetic Other Venue ${stamp}`,
    `syn-other-loc-${stamp}`,
    orgOtherId
  ));
  ({ locationId: locSuspendedId, courseId: courseSuspendedId } = await insertVenue(
    `Synthetic Susp Venue ${stamp}`,
    `syn-susp-loc-${stamp}`,
    orgSuspendedId
  ));
});

after(async () => {
  await testQuery(`delete from round where client_id = any($1::text[])`, [clientIds]); // cascades
  await testQuery(`delete from course where id = any($1::uuid[])`, [
    [courseOtherId, courseSuspendedId],
  ]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [
    [locOtherId, locSuspendedId],
  ]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [[orgOtherId, orgSuspendedId]]);
  const { pool } = await import("../db.js");
  await pool.end();
});

// --- the key gate -----------------------------------------------------------

test("catalog rejects a request with no key (403)", async () => {
  const res = await catalog();
  assert.equal(res.status, 403);
  assert.match(res.body.error, /x-synthetic-key/);
});

test("catalog rejects a wrong key (403)", async () => {
  const res = await catalog({ "x-synthetic-key": "nope" });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /x-synthetic-key/);
});

// --- cross-org discovery ----------------------------------------------------

test("catalog serves another org's live venue + course, unlike /api/content", async () => {
  const res = await catalog({ "x-synthetic-key": KEY });
  assert.equal(res.status, 200);

  const venue = res.body.locations.find((l) => l.id === locOtherId);
  assert.ok(venue, "the non-default org's venue is in the catalog");
  assert.equal(venue.orgId, orgOtherId);
  assert.equal(venue.orgSlug, slugOther);
  assert.equal(venue.tz, "America/Los_Angeles");

  const course = res.body.courses.find((c) => c.id === courseOtherId);
  assert.ok(course, "its course is in the catalog");
  assert.equal(course.locationId, locOtherId);
  assert.equal(course.pars.length, 18);

  // Same host, public feed: the tenant filter hides that venue entirely — the
  // reason the bot needed its own feed.
  const content = await request({ path: "/api/content" });
  assert.equal(content.status, 200);
  assert.ok(!content.body.locations.some((l) => l.id === locOtherId));
  assert.ok(!content.body.courses.some((c) => c.id === courseOtherId));
});

test("catalog omits a suspended org's venue and course", async () => {
  const res = await catalog({ "x-synthetic-key": KEY });
  assert.ok(!res.body.locations.some((l) => l.id === locSuspendedId));
  assert.ok(!res.body.courses.some((c) => c.id === courseSuspendedId));
});

test("catalog omits an archived location and an archived course", async () => {
  await testQuery(`update location set archived_at = now() where id = $1`, [locOtherId]);
  let res = await catalog({ "x-synthetic-key": KEY });
  assert.ok(!res.body.locations.some((l) => l.id === locOtherId));
  assert.ok(!res.body.courses.some((c) => c.id === courseOtherId));

  await testQuery(`update location set archived_at = null where id = $1`, [locOtherId]);
  await testQuery(`update course set archived_at = now() where id = $1`, [courseOtherId]);
  res = await catalog({ "x-synthetic-key": KEY });
  assert.ok(res.body.locations.some((l) => l.id === locOtherId), "venue is back");
  assert.ok(!res.body.courses.some((c) => c.id === courseOtherId), "archived course stays out");
  await testQuery(`update course set archived_at = null where id = $1`, [courseOtherId]);
});

// --- posting a round on a foreign tenant's course ---------------------------

test("an authorised synthetic round plays another org's course over a fallback host", async () => {
  const res = await request({
    method: "POST",
    path: "/api/rounds",
    headers: { "x-synthetic-key": KEY },
    body: roundBody(courseOtherId),
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.ok, true);
  const row = await testQuery(`select synthetic, course_id from round where id = $1`, [
    res.body.roundId,
  ]);
  assert.equal(row.rows[0].synthetic, true);
  assert.equal(row.rows[0].course_id, courseOtherId);
});

test("a REAL round on that same course is still tenant-scoped away", async () => {
  const res = await request({
    method: "POST",
    path: "/api/rounds",
    headers: { "x-synthetic-key": KEY },
    body: roundBody(courseOtherId, { synthetic: false }),
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /courseId does not exist/);
});

test("a synthetic round is refused once the course's org goes dark mid-run", async () => {
  // The bot keeps its last-known course set when a refresh fails, so a course
  // it discovered while the org was live can outlive the org's suspension.
  // The write path must apply the catalog's own scope, not just "any org".
  await testQuery(`update org set status = 'suspended' where id = $1`, [orgOtherId]);
  try {
    const res = await request({
      method: "POST",
      path: "/api/rounds",
      headers: { "x-synthetic-key": KEY },
      body: roundBody(courseOtherId),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /courseId does not exist/);
  } finally {
    await testQuery(`update org set status = 'active' where id = $1`, [orgOtherId]);
  }
});

test("a synthetic round is refused for an archived venue or archived course", async () => {
  await testQuery(`update location set archived_at = now() where id = $1`, [locOtherId]);
  let res = await request({
    method: "POST",
    path: "/api/rounds",
    headers: { "x-synthetic-key": KEY },
    body: roundBody(courseOtherId),
  });
  assert.equal(res.status, 400, "archived venue");
  await testQuery(`update location set archived_at = null where id = $1`, [locOtherId]);

  await testQuery(`update course set archived_at = now() where id = $1`, [courseOtherId]);
  res = await request({
    method: "POST",
    path: "/api/rounds",
    headers: { "x-synthetic-key": KEY },
    body: roundBody(courseOtherId),
  });
  assert.equal(res.status, 400, "archived course");
  await testQuery(`update course set archived_at = null where id = $1`, [courseOtherId]);
});

test("an UNAUTHORISED synthetic round on that course is still a 403", async () => {
  const res = await request({
    method: "POST",
    path: "/api/rounds",
    headers: { "x-synthetic-key": "nope" },
    body: roundBody(courseOtherId),
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /x-synthetic-key/);
});

// Last in the file ON PURPOSE: the anonymous burst below exhausts the write
// limiter's 60s window for this IP, and every case above posts from the same
// one — a 429 would mask the status each of them asserts.
test("a sweep wider than the anonymous write cap is not throttled for the bot", async () => {
  // 30 POSTs/60s per IP is the anonymous-writer cap, and the bot posts every
  // round from ONE ip (the runner points it at loopback). A sweep wider than
  // that — every org's courses now, or a high --plays-per-course before —
  // would collect 429s that the bot counts as failures and never retries,
  // silently truncating a soak run. A verified synthetic round skips the
  // bucket; everyone else still gets it.
  const results = [];
  for (let i = 0; i < 40; i++) {
    results.push(
      await request({
        method: "POST",
        path: "/api/rounds",
        headers: { "x-synthetic-key": KEY },
        body: roundBody(courseOtherId),
      })
    );
  }
  assert.equal(results.filter((r) => r.status === 429).length, 0, "no synthetic round is limited");
  assert.equal(results.filter((r) => r.status === 200).length, 40);

  // Those 40 consumed none of the anonymous window — an ordinary writer from
  // the same IP is still capped.
  const anon = [];
  for (let i = 0; i < 35; i++) {
    anon.push(
      await request({
        method: "POST",
        path: "/api/rounds",
        body: roundBody(courseOtherId, { synthetic: false }),
      })
    );
  }
  assert.ok(anon.some((r) => r.status === 429), "an anonymous writer is still capped");
});
