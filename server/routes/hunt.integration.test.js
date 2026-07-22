// Integration coverage for routes/hunt.js — the largest previously-untested
// surface, and the one with a public, unauthenticated photo-upload endpoint.
//
// lib/vision.js (the real Anthropic call) is mocked via node:test's
// mock.module so these run with no network access and no API key; the mock
// must be registered before app.js (which imports hunt.js) is ever imported.
// Requires a reachable Postgres at TEST_DATABASE_URL and
// --experimental-test-module-mocks (see package.json's "test" script).
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm as rmDir } from "node:fs/promises";
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

const uploadDir = await mkdtemp(join(tmpdir(), "ffc-hunt-test-"));
process.env.HUNT_UPLOAD_DIR = uploadDir;

const verifyItemInImageMock = mock.fn(async () => ({
  present: true,
  confidence: 0.9,
  reason: "default mock verdict — override per test",
  photoOfPhoto: false,
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
let locationId;
let courseId;
let itemId;
let countableItemId;

const validBody = () => ({
  itemId,
  courseId,
  playerTag: "T01",
  roundClientId: `round-${Date.now()}-${Math.random()}`,
  imageBase64: Buffer.from("test-image-bytes").toString("base64"),
  mediaType: "image/jpeg",
});

function postVerify(body) {
  return fetch(`${baseUrl}/api/hunt/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Hunt Test Venue ${stamp}`, `hunt-test-${stamp}`]
  );
  locationId = loc.rows[0].id;

  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Hunt Test Course", "test", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;

  const item = await testQuery(
    `insert into hunt_item (course_id, slug, name, hint, countable)
       values ($1, 'widget', 'A test widget', 'look for it', false) returning id`,
    [courseId]
  );
  itemId = item.rows[0].id;

  const countableItem = await testQuery(
    `insert into hunt_item (course_id, slug, name, hint, countable)
       values ($1, 'coin', 'A test coin', 'find as many as you can', true) returning id`,
    [courseId]
  );
  countableItemId = countableItem.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from hunt_find where item_id in ($1, $2)`, [itemId, countableItemId]);
  await testQuery(`delete from course where id = $1`, [courseId]); // cascades hunt_item
  await testQuery(`delete from location where id = $1`, [locationId]);
  await rmDir(uploadDir, { recursive: true, force: true });
  const { pool } = await import("../db.js");
  await pool.end();
});

// --- GET /api/hunt/items -----------------------------------------------------

test("GET /api/hunt/items requires a uuid course", async () => {
  const res = await fetch(`${baseUrl}/api/hunt/items?course=not-a-uuid`);
  assert.equal(res.status, 400);
});

test("GET /api/hunt/items returns this course's active items", async () => {
  const res = await fetch(`${baseUrl}/api/hunt/items?course=${courseId}`);
  assert.equal(res.status, 200);
  const items = await res.json();
  const slugs = items.map((i) => i.slug).sort();
  assert.deepEqual(slugs, ["coin", "widget"]);
});

// --- GET /api/hunt/progress --------------------------------------------------

test("GET /api/hunt/progress requires a round id", async () => {
  const res = await fetch(`${baseUrl}/api/hunt/progress`);
  assert.equal(res.status, 400);
});

test("GET /api/hunt/progress returns only verified finds for that round", async () => {
  const roundClientId = `round-progress-${Date.now()}`;
  verifyItemInImageMock.mock.mockImplementation(async () => ({
    present: true,
    confidence: 0.9,
    reason: "ok",
    photoOfPhoto: false,
  }));
  await postVerify({ ...validBody(), playerTag: "T09", roundClientId });

  const res = await fetch(`${baseUrl}/api/hunt/progress?round=${roundClientId}`);
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemSlug, "widget");
  assert.equal(rows[0].playerTag, "T09");
});

// --- POST /api/hunt/verify ---------------------------------------------------

test("POST /api/hunt/verify validates each required field", async () => {
  const cases = [
    { override: { itemId: "not-a-uuid" }, match: /itemId must be a uuid/ },
    { override: { courseId: "not-a-uuid" }, match: /courseId must be a uuid/ },
    { override: { playerTag: "ab" }, match: /playerTag is invalid/ },
    { override: { roundClientId: "" }, match: /roundClientId is required/ },
    { override: { mediaType: "image/bmp" }, match: /mediaType must be a supported image type/ },
    { override: { imageBase64: "" }, match: /imageBase64 is required/ },
  ];
  for (const { override, match } of cases) {
    const res = await postVerify({ ...validBody(), ...override });
    assert.equal(res.status, 400, `case ${JSON.stringify(override)}`);
    const body = await res.json();
    assert.match(body.error, match, `case ${JSON.stringify(override)}`);
  }
});

test("POST /api/hunt/verify 400s when itemId doesn't exist on this course", async () => {
  const res = await postVerify({
    ...validBody(),
    itemId: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /does not exist on this course/);
});

test("verified find is persisted to disk + DB; a repeat submission dedupes without a second vision call", async () => {
  verifyItemInImageMock.mock.resetCalls();
  verifyItemInImageMock.mock.mockImplementation(async () => ({
    present: true,
    confidence: 0.87,
    reason: "clearly a widget",
    photoOfPhoto: false,
  }));
  const body = { ...validBody(), playerTag: "T02", roundClientId: `round-happy-${Date.now()}` };

  const res1 = await postVerify(body);
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  assert.equal(json1.verified, true);
  assert.equal(json1.flagged, false);
  assert.equal(json1.alreadyFound, undefined);
  assert.equal(verifyItemInImageMock.mock.callCount(), 1);

  const dbRow = await testQuery(
    `select verified, flagged, photo_path from hunt_find
      where round_client_id = $1 and player_tag = $2 and item_id = $3`,
    [body.roundClientId, body.playerTag, itemId]
  );
  assert.equal(dbRow.rowCount, 1);
  assert.equal(dbRow.rows[0].verified, true);
  assert.equal(dbRow.rows[0].flagged, false);
  assert.ok(dbRow.rows[0].photo_path);
  const savedBytes = await readFile(dbRow.rows[0].photo_path);
  assert.equal(savedBytes.toString(), "test-image-bytes");

  // Repeat submission for the same (round, player, item) — dedupe short-circuit.
  const res2 = await postVerify(body);
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.alreadyFound, true);
  assert.equal(verifyItemInImageMock.mock.callCount(), 1, "no second vision call on dedupe");
});

test("a photo-of-a-photo is flagged, not verified, and no photo file is kept", async () => {
  verifyItemInImageMock.mock.mockImplementation(async () => ({
    present: true,
    confidence: 0.5,
    reason: "looks like a screen",
    photoOfPhoto: true,
  }));
  const body = { ...validBody(), playerTag: "T03", roundClientId: `round-flag-${Date.now()}` };
  const res = await postVerify(body);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.verified, false);
  assert.equal(json.flagged, true);

  const dbRow = await testQuery(
    `select verified, flagged, photo_path from hunt_find
      where round_client_id = $1 and player_tag = $2 and item_id = $3`,
    [body.roundClientId, body.playerTag, itemId]
  );
  assert.equal(dbRow.rowCount, 1);
  assert.equal(dbRow.rows[0].verified, false);
  assert.equal(dbRow.rows[0].flagged, true);
  assert.equal(dbRow.rows[0].photo_path, null);
});

test("a countable item never dedupes and the response carries a running count", async () => {
  verifyItemInImageMock.mock.mockImplementation(async () => ({
    present: true,
    confidence: 0.95,
    reason: "a coin",
    photoOfPhoto: false,
  }));
  const roundClientId = `round-countable-${Date.now()}`;
  for (let i = 1; i <= 3; i++) {
    const res = await postVerify({
      ...validBody(),
      itemId: countableItemId,
      playerTag: "T04",
      roundClientId,
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.verified, true);
    assert.equal(json.count, i);
  }
  const rows = await testQuery(
    `select count(*)::int as n from hunt_find
      where round_client_id = $1 and item_id = $2 and verified`,
    [roundClientId, countableItemId]
  );
  assert.equal(rows.rows[0].n, 3);
});

test("a no-output vision response is a retryable 200 with nothing persisted", async () => {
  verifyItemInImageMock.mock.mockImplementation(async () => {
    const err = new Error("vision returned no text content");
    err.code = "VISION_NO_OUTPUT";
    throw err;
  });
  const body = { ...validBody(), playerTag: "T05", roundClientId: `round-noout-${Date.now()}` };
  const res = await postVerify(body);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.verified, false);
  assert.match(json.reason, /try another shot/);

  const rows = await testQuery(
    `select count(*)::int as n from hunt_find
      where round_client_id = $1 and player_tag = $2 and item_id = $3`,
    [body.roundClientId, body.playerTag, itemId]
  );
  assert.equal(rows.rows[0].n, 0);
});

// Last on purpose: it's designed to trip the shared per-IP counter, so any
// test after it would be affected. Prior tests in this file cost ~14 requests
// against the same 20/min cap; firing 15 more guarantees at least one 429.
test("per-IP rate limit eventually trips 429", async () => {
  verifyItemInImageMock.mock.mockImplementation(async () => ({
    present: true,
    confidence: 0.9,
    reason: "ok",
    photoOfPhoto: false,
  }));
  const statuses = [];
  for (let i = 0; i < 15; i++) {
    const res = await postVerify({
      ...validBody(),
      playerTag: "T06",
      roundClientId: `round-rl-${i}-${Date.now()}`,
    });
    statuses.push(res.status);
  }
  assert.ok(statuses.includes(429), `expected a 429 among ${JSON.stringify(statuses)}`);
});
