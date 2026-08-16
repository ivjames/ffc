// Integration coverage for the PER-VENUE hunt spend controls
// (location.hunt.dailyScanCap, enforced in routes/hunt.js):
//
//   - the config round-trips through the admin location upsert
//     (normalizeHunt + LOCATION_RETURN_COLS);
//   - a venue at its daily cap 429s with the venue-distinct error string;
//   - dailyScanCap 0 is the per-client kill switch (403, no model call);
//   - an absent cap stays unlimited (pre-config behavior);
//   - the cap counts ONLY that venue's billed verify scans — a second venue,
//     scans older than the 24h window, and admin 'screen' rows are all exempt.
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
let locationAId, locationBId, locationCId;
let courseAId, courseBId, courseCId;
let itemAId, itemBId, itemCId;

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

  ({ courseId: courseAId, itemId: itemAId } = await makeCourseAndItem(locationAId, "a"));
  ({ courseId: courseBId, itemId: itemBId } = await makeCourseAndItem(locationBId, "b"));
  ({ courseId: courseCId, itemId: itemCId } = await makeCourseAndItem(locationCId, "c"));

  // Two rows that must NOT count toward venue A's daily budget:
  //  - a verify scan older than the rolling 24h window;
  //  - an admin item-image screen row (operator spend, not gameplay).
  await testQuery(
    `insert into hunt_scan (round_client_id, player_tag, item_id, course_id, created_at)
       values ('venue-cap-old-round', 'T01', $1, $2, now() - interval '25 hours')`,
    [itemAId, courseAId]
  );
  await testQuery(
    `insert into hunt_scan (kind, item_id, course_id, model, input_tokens, output_tokens, cost_usd)
       values ('screen', $1, $2, 'mock-descriptor', 300, 20, 0.0001)`,
    [itemAId, courseAId]
  );
});

after(async () => {
  if (close) await close();
  for (const courseId of [courseAId, courseBId, courseCId]) {
    await testQuery(`delete from hunt_scan where course_id = $1`, [courseId]);
    await testQuery(
      `delete from hunt_find where item_id in (select id from hunt_item where course_id = $1)`,
      [courseId]
    );
    await testQuery(`delete from course where id = $1`, [courseId]); // cascades hunt_item
  }
  await testQuery(`delete from admin_audit where entity = 'location' and entity_id = $1`, [locationAId]);
  for (const locationId of [locationAId, locationBId, locationCId]) {
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
