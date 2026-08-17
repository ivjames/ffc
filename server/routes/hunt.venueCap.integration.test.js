// Integration coverage for the PER-VENUE hunt spend controls
// (location.hunt.dailyScanCap, enforced in routes/hunt.js):
//
//   - the config round-trips through the admin location upsert
//     (normalizeHunt + LOCATION_RETURN_COLS);
//   - a venue at its daily cap 429s with the venue-distinct error string;
//   - dailyScanCap 0 is the per-client kill switch (403, no model call);
//   - an absent cap stays unlimited (pre-config behavior);
//   - the cap counts ONLY that venue's billed verify scans — a second venue,
//     scans older than the 24h window, and admin 'screen' rows are all exempt;
//   - the check-then-bill race is closed by the reservation lifecycle
//     (routes/hunt.js reserveScan): an in-flight reservation row occupies a
//     budget slot, and a failed provider call releases it.
//
// Separate file from hunt.integration.test.js / hunt.scanCap.integration.test.js
// for the same reason those are separate: node --test runs each file in its
// own process, so this file gets a fresh per-IP rate-limit counter.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm as rmDir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.ANTHROPIC_API_KEY = "test-key"; // so isVisionConfigured() is true
const APP_TOKEN = `venue-cap-test-token-${Date.now()}`;
process.env.APP_TOKEN = APP_TOKEN;

const uploadDir = await mkdtemp(join(tmpdir(), "ffc-hunt-venuecap-test-"));
process.env.HUNT_UPLOAD_DIR = uploadDir;

const MOCK_USAGE = { model: "claude-haiku-4-5", inputTokens: 1500, outputTokens: 80 };
const verifyItemInImageMock = mock.fn(async () => ({
  present: true,
  confidence: 0.9,
  reason: "mock verdict",
  photoOfPhoto: false,
  usage: MOCK_USAGE,
}));

mock.module("../lib/vision.js", {
  namedExports: {
    verifyItemInImage: verifyItemInImageMock,
    isVisionConfigured: () => true,
    ALLOWED_MEDIA_TYPES: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  },
});

const { app } = await import("../app.js");

let baseUrl;
let close;
// Venue A: dailyScanCap 3 (created through the admin API — the round-trip).
// Venue B: no cap (unlimited). Venue C: dailyScanCap 0 (hunt disabled).
// Venue D: dailyScanCap 2, org-owned — the reservation-lifecycle tests. It
// hangs off the SEEDED default org: verify resolves the tenant from the host
// (via='fallback' on 127.0.0.1), so a venue under a foreign org would answer
// like a nonexistent item — and the default org is the one the fallback scopes to.
const ORG_D_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // schema.sql seed org
let locationAId, locationBId, locationCId, locationDId;
let courseAId, courseBId, courseCId, courseDId;
let itemAId, itemBId, itemCId, itemDId;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function postVerify(body) {
  return fetch(`${baseUrl}/api/hunt/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const verifyBody = (itemId, courseId, roundClientId) => ({
  itemId,
  courseId,
  playerTag: "T01",
  roundClientId,
  imageBase64: Buffer.from("test-image-bytes").toString("base64"),
  mediaType: "image/jpeg",
});

async function makeCourseAndItem(locationId, slugStem) {
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, 'test', $2, $3) returning id`,
    [`Venue Cap Course ${slugStem}`, Array(18).fill(3), locationId]
  );
  // Countable, so neither dedupe nor the per-item attempt cap interferes —
  // every submission wants a billed model call, like the scan-cap tests.
  const item = await testQuery(
    `insert into hunt_item (course_id, slug, name, hint, countable)
       values ($1, 'coin', 'A test coin', 'find many', true) returning id`,
    [course.rows[0].id]
  );
  return { courseId: course.rows[0].id, itemId: item.rows[0].id };
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  // Venue A goes through POST /api/admin/locations so the test covers the
  // real write path: normalizeHunt validation + the upsert's hunt column.
  const createA = await fetch(`${baseUrl}/api/admin/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-token": APP_TOKEN },
    body: JSON.stringify({
      name: `Venue Cap A ${stamp}`,
      slug: `venue-cap-a-${stamp}`,
      hunt: { dailyScanCap: 3 },
    }),
  });
  assert.equal(createA.status, 200);
  const createdA = await createA.json();
  assert.deepEqual(createdA.location.hunt, { dailyScanCap: 3 }, "hunt config round-trips on the upsert response");
  locationAId = createdA.location.id;

  const locB = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Venue Cap B ${stamp}`, `venue-cap-b-${stamp}`]
  );
  locationBId = locB.rows[0].id;
  const locC = await testQuery(
    `insert into location (name, slug, hunt) values ($1, $2, '{"dailyScanCap": 0}'::jsonb) returning id`,
    [`Venue Cap C ${stamp}`, `venue-cap-c-${stamp}`]
  );
  locationCId = locC.rows[0].id;

  const locD = await testQuery(
    `insert into location (name, slug, org_id, hunt) values ($1, $2, $3, '{"dailyScanCap": 2}'::jsonb) returning id`,
    [`Venue Cap D ${stamp}`, `venue-cap-d-${stamp}`, ORG_D_ID]
  );
  locationDId = locD.rows[0].id;

  ({ courseId: courseAId, itemId: itemAId } = await makeCourseAndItem(locationAId, "a"));
  ({ courseId: courseBId, itemId: itemBId } = await makeCourseAndItem(locationBId, "b"));
  ({ courseId: courseCId, itemId: itemCId } = await makeCourseAndItem(locationCId, "c"));
  ({ courseId: courseDId, itemId: itemDId } = await makeCourseAndItem(locationDId, "d"));

  // Two rows that must NOT count toward venue A's daily budget:
  //  - a verify scan older than the rolling 24h window;
  //  - an admin item-image screen row (operator spend, not gameplay).
  await testQuery(
    `insert into hunt_scan (round_client_id, player_tag, item_id, course_id, location_id, created_at)
       values ('venue-cap-old-round', 'T01', $1, $2, $3, now() - interval '25 hours')`,
    [itemAId, courseAId, locationAId]
  );
  await testQuery(
    `insert into hunt_scan (kind, item_id, course_id, location_id, model, input_tokens, output_tokens, cost_usd)
       values ('screen', $1, $2, $3, 'mock-descriptor', 300, 20, 0.0001)`,
    [itemAId, courseAId, locationAId]
  );
});

after(async () => {
  if (close) await close();
  for (const courseId of [courseAId, courseBId, courseCId, courseDId]) {
    await testQuery(`delete from hunt_scan where course_id = $1`, [courseId]);
    await testQuery(
      `delete from hunt_find where item_id in (select id from hunt_item where course_id = $1)`,
      [courseId]
    );
    await testQuery(`delete from course where id = $1`, [courseId]); // cascades hunt_item
  }
  await testQuery(`delete from admin_audit where entity = 'location' and entity_id = $1`, [locationAId]);
  for (const locationId of [locationAId, locationBId, locationCId, locationDId]) {
    await testQuery(`delete from location where id = $1`, [locationId]);
  }
  await rmDir(uploadDir, { recursive: true, force: true });
  const { pool } = await import("../db.js");
  await pool.end();
});

test("the hunt config round-trips through the admin location read", async () => {
  const res = await fetch(`${baseUrl}/api/admin/locations/${locationAId}`, {
    headers: { "x-app-token": APP_TOKEN },
  });
  assert.equal(res.status, 200);
  const { location } = await res.json();
  assert.deepEqual(location.hunt, { dailyScanCap: 3 });
});

test("dailyScanCap 0 disables the venue's hunt outright — 403, no model call, nothing metered", async () => {
  verifyItemInImageMock.mock.resetCalls();
  const res = await postVerify(verifyBody(itemCId, courseCId, `venue-cap-c-round-${stamp}`));
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /not available at this venue/);
  assert.equal(verifyItemInImageMock.mock.callCount(), 0, "a disabled venue must never reach the model");
  const scans = await testQuery(`select count(*)::int as n from hunt_scan where course_id = $1`, [courseCId]);
  assert.equal(scans.rows[0].n, 0);
});

test("the venue daily cap 429s at N, counts only fresh verify scans, and leaves other venues alone", async () => {
  verifyItemInImageMock.mock.resetCalls();
  const roundA = `venue-cap-a-round-${stamp}`;
  const roundB = `venue-cap-b-round-${stamp}`;

  // Uncapped venue B burns first — its scans must not eat venue A's budget.
  for (let i = 1; i <= 2; i++) {
    const res = await postVerify(verifyBody(itemBId, courseBId, roundB));
    assert.equal(res.status, 200, `uncapped venue scan ${i} should pass`);
  }

  // Venue A has cap 3, and already carries a >24h-old verify row plus a
  // 'screen' row — neither counts, so all 3 fresh scans fit the budget.
  for (let i = 1; i <= 3; i++) {
    const res = await postVerify(verifyBody(itemAId, courseAId, roundA));
    assert.equal(res.status, 200, `venue A scan ${i} should be within the daily budget`);
  }

  // Scan 4: over the venue budget. Distinct error string from the per-round
  // 429 ("scan limit reached for this round") so ops can tell them apart.
  const res4 = await postVerify(verifyBody(itemAId, courseAId, roundA));
  assert.equal(res4.status, 429);
  const json4 = await res4.json();
  assert.equal(json4.ok, false);
  assert.match(json4.error, /daily scan limit reached for this venue/);

  // A different round at the same venue is capped too — the budget is the
  // venue's, not the round's.
  const resOtherRound = await postVerify(verifyBody(itemAId, courseAId, `${roundA}-other`));
  assert.equal(resOtherRound.status, 429);

  // Venue B (no cap) is untouched by A's exhaustion.
  const resB = await postVerify(verifyBody(itemBId, courseBId, roundB));
  assert.equal(resB.status, 200, "an uncapped venue keeps verifying after another venue caps out");

  assert.equal(
    verifyItemInImageMock.mock.callCount(),
    2 + 3 + 1,
    "capped requests must not call the model"
  );
});

// --- Reservation lifecycle (the check-then-bill race fix) --------------------
// True concurrency is impractical to drive deterministically under node:test,
// so these simulate the in-flight state directly: a reservation row (what
// reserveScan commits before the model call) must occupy a budget slot, and
// releasing it must free the slot.

test("an in-flight reservation occupies the venue budget until it's released", async () => {
  verifyItemInImageMock.mock.resetCalls();
  const roundD = `venue-cap-d-round-${stamp}`;

  // Venue D (cap 2) with one billed scan: at cap-1.
  await testQuery(
    `insert into hunt_scan (round_client_id, player_tag, item_id, course_id, org_id, location_id, model, input_tokens, output_tokens, verified, flagged)
       values ($1, 'T09', $2, $3, $4, $5, 'claude-haiku-4-5', 1500, 80, true, false)`,
    [`${roundD}-billed`, itemDId, courseDId, ORG_D_ID, locationDId]
  );
  // A concurrent request's reservation — committed by reserveScan, model call
  // still in flight: no model/tokens/verdict yet. It must count.
  const resv = await testQuery(
    `insert into hunt_scan (round_client_id, player_tag, item_id, course_id, org_id, location_id)
       values ($1, 'T10', $2, $3, $4, $5) returning id`,
    [`${roundD}-inflight`, itemDId, courseDId, ORG_D_ID, locationDId]
  );

  const blocked = await postVerify(verifyBody(itemDId, courseDId, roundD));
  assert.equal(blocked.status, 429, "billed + in-flight = 2 = cap; no third call may start");
  assert.match((await blocked.json()).error, /daily scan limit reached for this venue/);
  assert.equal(verifyItemInImageMock.mock.callCount(), 0);

  // The in-flight call fails and its reservation is released — the slot is
  // free again, so the same verify now goes through.
  await testQuery(`delete from hunt_scan where id = $1`, [resv.rows[0].id]);
  const allowed = await postVerify(verifyBody(itemDId, courseDId, roundD));
  assert.equal(allowed.status, 200);
  assert.equal(verifyItemInImageMock.mock.callCount(), 1);

  // The successful verify's own row was finalized in place (tokens stamped on
  // the reservation, not a second row) and carries the write-time org stamp.
  const scan = await testQuery(
    `select org_id, model, input_tokens, output_tokens, verified from hunt_scan where round_client_id = $1`,
    [roundD]
  );
  assert.equal(scan.rowCount, 1, "one row per billed call — reservation and metering are the same row");
  assert.equal(scan.rows[0].org_id, ORG_D_ID, "org_id is stamped at write time (invoice attribution)");
  assert.equal(scan.rows[0].model, "claude-haiku-4-5");
  assert.equal(scan.rows[0].input_tokens, 1500);
  assert.equal(scan.rows[0].output_tokens, 80);
  assert.equal(scan.rows[0].verified, true);
});

test("a failed provider call releases its reservation — nothing phantom is left eating the caps", async () => {
  verifyItemInImageMock.mock.resetCalls();
  const roundB = `venue-cap-b-fail-round-${stamp}`;

  verifyItemInImageMock.mock.mockImplementationOnce(async () => {
    throw new Error("provider connection reset"); // billed nothing
  });
  const res = await postVerify(verifyBody(itemBId, courseBId, roundB));
  assert.equal(res.status, 500);

  const leftovers = await testQuery(
    `select count(*)::int as n from hunt_scan where round_client_id = $1`,
    [roundB]
  );
  assert.equal(leftovers.rows[0].n, 0, "the unbilled reservation must be deleted, not orphaned");

  // The freed slot (and the default happy-path mock) let a retry succeed.
  const retry = await postVerify(verifyBody(itemBId, courseBId, roundB));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).verified, true);
});

test("moving a course between venues does not move its billed scans' budget", async () => {
  // The cap counts the WRITE-TIME location stamp: a course relocated via the
  // admin API mid-window must neither drain the destination venue's budget
  // with spend incurred elsewhere nor refund the source venue's slots.
  verifyItemInImageMock.mock.resetCalls();
  const locE = await testQuery(
    `insert into location (name, slug, hunt) values ($1, $2, '{"dailyScanCap": 1}'::jsonb) returning id`,
    [`Venue Cap E ${stamp}`, `venue-cap-e-${stamp}`]
  );
  const locF = await testQuery(
    `insert into location (name, slug, hunt) values ($1, $2, '{"dailyScanCap": 1}'::jsonb) returning id`,
    [`Venue Cap F ${stamp}`, `venue-cap-f-${stamp}`]
  );
  const locEId = locE.rows[0].id;
  const locFId = locF.rows[0].id;
  const { courseId, itemId } = await makeCourseAndItem(locEId, "e");
  try {
    // One billed scan stamped to venue E — E is at its cap of 1.
    await testQuery(
      `insert into hunt_scan (round_client_id, player_tag, item_id, course_id, location_id, model, input_tokens, output_tokens, verified, flagged)
         values ($1, 'T11', $2, $3, $4, 'claude-haiku-4-5', 1500, 80, true, false)`,
      [`venue-cap-e-round-${stamp}`, itemId, courseId, locEId]
    );
    const atCap = await postVerify(verifyBody(itemId, courseId, `venue-cap-e2-round-${stamp}`));
    assert.equal(atCap.status, 429, "venue E is at its cap");

    // Relocate the course to venue F (what PATCH /api/admin/courses/:id does).
    await testQuery(`update course set location_id = $2 where id = $1`, [courseId, locFId]);

    // F's budget is untouched by E's history: the verify goes through and is
    // stamped to F. Under the old live-join count, E's row would have counted
    // against F here and this would 429.
    const onF = await postVerify(verifyBody(itemId, courseId, `venue-cap-f-round-${stamp}`));
    assert.equal(onF.status, 200, "destination venue is not blocked by spend incurred at the source");
    assert.equal((await onF.json()).verified, true);

    const stamps = await testQuery(
      `select location_id, count(*)::int as n from hunt_scan
        where course_id = $1 and kind = 'verify' group by location_id`,
      [courseId]
    );
    const byLoc = Object.fromEntries(stamps.rows.map((r) => [r.location_id, r.n]));
    assert.equal(byLoc[locEId], 1, "the pre-move scan stays on venue E's budget");
    assert.equal(byLoc[locFId], 1, "the post-move scan lands on venue F's budget");

    // And F's own cap now binds on F's own spend.
    const fAtCap = await postVerify(verifyBody(itemId, courseId, `venue-cap-f2-round-${stamp}`));
    assert.equal(fAtCap.status, 429);
  } finally {
    await testQuery(`delete from hunt_scan where course_id = $1`, [courseId]);
    await testQuery(
      `delete from hunt_find where item_id in (select id from hunt_item where course_id = $1)`,
      [courseId]
    );
    await testQuery(`delete from course where id = $1`, [courseId]); // cascades hunt_item
    await testQuery(`delete from location where id = $1`, [locEId]);
    await testQuery(`delete from location where id = $1`, [locFId]);
  }
});
