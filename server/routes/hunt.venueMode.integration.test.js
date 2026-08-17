// Integration coverage for the COURSE-FREE hunt (routes/hunt.js venue mode) —
// the list a venue owns directly (hunt_item.location_id) and plays without a
// mini-golf round:
//
//   - the owner param is exclusive: exactly one of course/location, both on
//     the items read and the verify write;
//   - location.hunt.venueMode gates the whole mode — off reads as "no hunt
//     here" (empty list) and refuses verifies, so switching it off stops spend
//     immediately even for a client mid-session;
//   - a verify against a venue list credits a find and meters a hunt_scan row
//     with a NULL course_id and the venue's location_id/org_id stamps, which is
//     what the daily venue cap and the usage rollup read;
//   - an item can't be played against a list it doesn't belong to (the
//     cross-list guard the courseId check already gave course hunts);
//   - the group key (`roundClientId`) works exactly as it does on a course
//     hunt: dedupe, progress and the per-item attempt cap all key off it.
//
// Separate file from the other hunt tests for the reason those are separate
// from each other: node --test runs each file in its own process, so this one
// gets a fresh per-IP rate-limit counter (20/min).
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

const uploadDir = await mkdtemp(join(tmpdir(), "ffc-hunt-venuemode-test-"));
process.env.HUNT_UPLOAD_DIR = uploadDir;

const MOCK_USAGE = { model: "claude-haiku-4-5", inputTokens: 1200, outputTokens: 70 };
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

// Clear the anti-cheat bypass a real server/.env might set (the deploy gate
// runs on the droplet) before routes/hunt.js resolves it at import time.
await import("dotenv/config");
delete process.env.HUNT_ALLOW_PHOTO_OF_PHOTO;

const { app } = await import("../app.js");

// The seeded default org. Verify resolves the tenant from the host and
// 127.0.0.1 falls back to this org, so a venue under any other org would
// answer like a nonexistent one — see hunt.venueCap.integration.test.js.
const ORG_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

let baseUrl;
let close;
// Venue ON: venueMode true, two items (one countable) — the live hunt.
let liveVenueId;
let liveItemId;
let countableItemId;
// Venue OFF: has items, but venueMode is absent — a staged, unswitched list.
let darkVenueId;
let darkItemId;
// A course at the live venue, for the "item from another list" guard.
let courseId;
let courseItemId;

const image = () => Buffer.from("venue-hunt-test-bytes").toString("base64");
let roundSeq = 0;
const newGroupKey = () => `venue-session-${Date.now()}-${roundSeq++}`;

function postVerify(body) {
  return fetch(`${baseUrl}/api/hunt/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const venueBody = (over = {}) => ({
  itemId: liveItemId,
  locationId: liveVenueId,
  playerTag: "V01",
  roundClientId: newGroupKey(),
  imageBase64: image(),
  mediaType: "image/jpeg",
  ...over,
});

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const live = await testQuery(
    `insert into location (name, slug, org_id, hunt)
       values ($1, $2, $3, '{"venueMode": true}'::jsonb) returning id`,
    [`Venue Hunt Live ${stamp}`, `venue-hunt-live-${stamp}`, ORG_ID]
  );
  liveVenueId = live.rows[0].id;

  const dark = await testQuery(
    `insert into location (name, slug, org_id) values ($1, $2, $3) returning id`,
    [`Venue Hunt Dark ${stamp}`, `venue-hunt-dark-${stamp}`, ORG_ID]
  );
  darkVenueId = dark.rows[0].id;

  const liveItem = await testQuery(
    `insert into hunt_item (location_id, slug, name, hint, countable)
       values ($1, 'ferris-wheel', 'The ferris wheel', 'look up', false) returning id`,
    [liveVenueId]
  );
  liveItemId = liveItem.rows[0].id;

  const countable = await testQuery(
    `insert into hunt_item (location_id, slug, name, countable)
       values ($1, 'token', 'An arcade token', true) returning id`,
    [liveVenueId]
  );
  countableItemId = countable.rows[0].id;

  // Inactive items stay out of the player-facing list, same as on a course.
  await testQuery(
    `insert into hunt_item (location_id, slug, name, active)
       values ($1, 'retired', 'A retired prop', false)`,
    [liveVenueId]
  );

  const darkItem = await testQuery(
    `insert into hunt_item (location_id, slug, name)
       values ($1, 'slide', 'The big slide') returning id`,
    [darkVenueId]
  );
  darkItemId = darkItem.rows[0].id;

  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Venue Mode Test Course", "test", Array(18).fill(3), liveVenueId]
  );
  courseId = course.rows[0].id;
  const courseItem = await testQuery(
    `insert into hunt_item (course_id, slug, name) values ($1, 'flag', 'A course flag') returning id`,
    [courseId]
  );
  courseItemId = courseItem.rows[0].id;
});

after(async () => {
  if (close) await close();
  const venues = [liveVenueId, darkVenueId];
  await testQuery(
    `delete from hunt_find where item_id in (select id from hunt_item
       where location_id = any($1::uuid[]) or course_id = $2)`,
    [venues, courseId]
  );
  await testQuery(`delete from hunt_scan where location_id = any($1::uuid[])`, [venues]);
  await testQuery(`delete from hunt_item where course_id = $1`, [courseId]);
  await testQuery(`delete from course where id = $1`, [courseId]);
  // hunt_item.location_id cascades on venue delete.
  await testQuery(`delete from location where id = any($1::uuid[])`, [venues]);
  await rmDir(uploadDir, { recursive: true, force: true });
  const { pool } = await import("../db.js");
  await pool.end();
});

// --- GET /api/hunt/items -----------------------------------------------------

test("items: a venue's list returns its ACTIVE items only", async () => {
  const res = await fetch(`${baseUrl}/api/hunt/items?location=${liveVenueId}`);
  assert.equal(res.status, 200);
  const items = await res.json();
  assert.deepEqual(
    items.map((i) => i.slug).sort(),
    ["ferris-wheel", "token"],
    "the inactive item must not be offered to players"
  );
  // The course at the same venue keeps its own separate list.
  assert.ok(!items.some((i) => i.slug === "flag"));
});

test("items: a venue's list is empty while venueMode is off", async () => {
  const res = await fetch(`${baseUrl}/api/hunt/items?location=${darkVenueId}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [], "a staged list must stay invisible until switched on");
});

test("items: exactly one owner param — neither or both is a 400", async () => {
  const neither = await fetch(`${baseUrl}/api/hunt/items`);
  assert.equal(neither.status, 400);
  const both = await fetch(
    `${baseUrl}/api/hunt/items?course=${courseId}&location=${liveVenueId}`
  );
  assert.equal(both.status, 400);
});

test("items: a non-uuid location is a 400, not an empty list", async () => {
  const res = await fetch(`${baseUrl}/api/hunt/items?location=nope`);
  assert.equal(res.status, 400);
});

// --- POST /api/hunt/verify ---------------------------------------------------

test("verify: exactly one owner — neither or both is a 400 before any model call", async () => {
  const before = verifyItemInImageMock.mock.callCount();

  const neither = await postVerify({
    itemId: liveItemId,
    playerTag: "V01",
    roundClientId: newGroupKey(),
    imageBase64: image(),
    mediaType: "image/jpeg",
  });
  assert.equal(neither.status, 400);

  const both = await postVerify(venueBody({ courseId }));
  assert.equal(both.status, 400);

  assert.equal(
    verifyItemInImageMock.mock.callCount(),
    before,
    "a malformed owner must never reach (and bill) the model"
  );
});

test("verify: a venue find is credited and metered with no course, stamped to the venue", async () => {
  const roundClientId = newGroupKey();
  const res = await postVerify(venueBody({ roundClientId }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.verified, true);

  // The gameplay record.
  const find = await testQuery(
    `select verified, player_tag, photo_path from hunt_find
      where round_client_id = $1 and item_id = $2`,
    [roundClientId, liveItemId]
  );
  assert.equal(find.rowCount, 1);
  assert.equal(find.rows[0].verified, true);
  assert.equal(find.rows[0].player_tag, "V01");
  assert.ok(find.rows[0].photo_path, "a verified venue find stores its photo like any other");

  // The billing record: no course to attribute to, so location_id/org_id carry
  // it — exactly what the venue daily cap and the usage rollup read.
  const scan = await testQuery(
    `select course_id, location_id, org_id, kind, model, input_tokens, output_tokens, verified
       from hunt_scan where round_client_id = $1`,
    [roundClientId]
  );
  assert.equal(scan.rowCount, 1);
  assert.equal(scan.rows[0].course_id, null, "a venue hunt has no course to bill against");
  assert.equal(scan.rows[0].location_id, liveVenueId);
  assert.equal(scan.rows[0].org_id, ORG_ID);
  assert.equal(scan.rows[0].kind, "verify");
  assert.equal(scan.rows[0].input_tokens, MOCK_USAGE.inputTokens);
  assert.equal(scan.rows[0].output_tokens, MOCK_USAGE.outputTokens);
  assert.equal(scan.rows[0].verified, true);
});

test("verify: the group key dedupes a repeat find without paying for it again", async () => {
  const roundClientId = newGroupKey();
  const first = await postVerify(venueBody({ roundClientId }));
  assert.equal(first.status, 200);
  const callsAfterFirst = verifyItemInImageMock.mock.callCount();

  const second = await postVerify(venueBody({ roundClientId }));
  assert.equal(second.status, 200);
  const body = await second.json();
  assert.equal(body.alreadyFound, true);
  assert.equal(
    verifyItemInImageMock.mock.callCount(),
    callsAfterFirst,
    "a dedupe short-circuit must not reach the model"
  );

  // And progress reads back through the same endpoint a course hunt uses.
  const progress = await fetch(`${baseUrl}/api/hunt/progress?round=${roundClientId}`);
  const rows = await progress.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemSlug, "ferris-wheel");
});

test("verify: venueMode off refuses the item, without a model call", async () => {
  const before = verifyItemInImageMock.mock.callCount();
  const res = await postVerify(
    venueBody({ itemId: darkItemId, locationId: darkVenueId, roundClientId: newGroupKey() })
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /does not exist in this venue's hunt/);
  assert.equal(
    verifyItemInImageMock.mock.callCount(),
    before,
    "switching the hunt off must stop spend immediately, mid-session included"
  );
});

test("verify: an item can't be played against a list it doesn't belong to", async () => {
  // The course's item, submitted against the venue's list — both live, both at
  // the same venue, so only the ownership check separates them.
  const crossed = await postVerify(venueBody({ itemId: courseItemId }));
  assert.equal(crossed.status, 400);

  // And the mirror: the venue's item submitted against the course's list.
  const mirrored = await postVerify({
    itemId: liveItemId,
    courseId,
    playerTag: "V01",
    roundClientId: newGroupKey(),
    imageBase64: image(),
    mediaType: "image/jpeg",
  });
  assert.equal(mirrored.status, 400);
});

test("verify: a countable venue item keeps counting, like its course counterpart", async () => {
  const roundClientId = newGroupKey();
  const first = await postVerify(
    venueBody({ itemId: countableItemId, roundClientId, playerTag: "V02" })
  );
  assert.equal((await first.json()).count, 1);
  const second = await postVerify(
    venueBody({ itemId: countableItemId, roundClientId, playerTag: "V02" })
  );
  const body = await second.json();
  assert.equal(body.verified, true);
  assert.equal(body.count, 2, "countable items are exempt from the one-find dedupe");
});
