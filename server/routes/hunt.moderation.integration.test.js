// Integration coverage for photo auto-moderation: the quarantine flow in
// POST /api/hunt/verify. Vision is mocked (same pattern as
// hunt.integration.test.js) so verdicts are scripted per test.
//
// Auto-mod only for now — the operator review surface is deferred; the
// moderation verdict is still recorded on every find so a future review
// queue starts with full history.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm as rmDir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.ANTHROPIC_API_KEY = "test-key";

const uploadDir = await mkdtemp(join(tmpdir(), "ffc-moderation-test-"));
process.env.HUNT_UPLOAD_DIR = uploadDir;

// The safe default verdict; tests override per call.
const verifyItemInImageMock = mock.fn(async () => ({
  present: true,
  confidence: 0.9,
  reason: "found it",
  photoOfPhoto: false,
  unsafe: false,
  unsafeReason: "",
  peoplePresent: false,
  minorsPresent: false,
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

const verifyBody = () => ({
  itemId,
  courseId,
  playerTag: "MOD",
  roundClientId: `mod-round-${Date.now()}-${Math.random()}`,
  imageBase64: Buffer.from("moderation-test-image").toString("base64"),
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
    [`Moderation Venue ${stamp}`, `moderation-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Moderation Course", "test", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;
  const item = await testQuery(
    `insert into hunt_item (course_id, slug, name) values ($1, 'mod-item', 'The moderation windmill') returning id`,
    [courseId]
  );
  itemId = item.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from hunt_scan where course_id = $1`, [courseId]);
  await testQuery(
    `delete from hunt_find where item_id in (select id from hunt_item where course_id = $1)`,
    [courseId]
  );
  await testQuery(`delete from hunt_item where course_id = $1`, [courseId]);
  await testQuery(`delete from course where id = $1`, [courseId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  await rmDir(uploadDir, { recursive: true, force: true });
  const { pool } = await import("../db.js");
  await pool.end();
});

test("an unsafe photo is not credited, never touches disk, and records a flagged event", async () => {
  verifyItemInImageMock.mock.mockImplementationOnce(async () => ({
    present: true, // the item IS there — content still blocks it
    confidence: 0.95,
    reason: "windmill visible",
    photoOfPhoto: false,
    unsafe: true,
    unsafeReason: "obscene gesture",
    peoplePresent: true,
    minorsPresent: false,
  }));
  const body = verifyBody();
  const res = await postVerify(body);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.verified, false);
  assert.match(json.reason, /family-friendly/);
  assert.doesNotMatch(json.reason, /obscene/, "model's category never reaches the player");

  const row = await testQuery(
    `select verified, moderation, moderation_reason, photo_path, people_present
       from hunt_find where round_client_id = $1`,
    [body.roundClientId]
  );
  assert.equal(row.rows[0].verified, false);
  assert.equal(row.rows[0].moderation, "flagged");
  assert.equal(row.rows[0].moderation_reason, "obscene gesture");
  assert.equal(row.rows[0].photo_path, null, "unsafe photo must never be stored");
  assert.equal(row.rows[0].people_present, true);
});

test("a safe verified photo with people stores the file as auto-approved with people flags", async () => {
  verifyItemInImageMock.mock.mockImplementationOnce(async () => ({
    present: true,
    confidence: 0.9,
    reason: "windmill with the family in front",
    photoOfPhoto: false,
    unsafe: false,
    unsafeReason: "",
    peoplePresent: true,
    minorsPresent: true,
  }));
  const body = verifyBody();
  const res = await postVerify(body);
  assert.equal((await res.json()).verified, true);

  const row = await testQuery(
    `select moderation, photo_path, people_present, minors_present
       from hunt_find where round_client_id = $1`,
    [body.roundClientId]
  );
  assert.equal(row.rows[0].moderation, "approved");
  assert.equal(row.rows[0].people_present, true);
  assert.equal(row.rows[0].minors_present, true);
  assert.ok(row.rows[0].photo_path, "safe verified photo is stored");
  await access(row.rows[0].photo_path); // throws if the file isn't on disk
});

test("photo share: progress marks sharable finds, and the photo endpoint gates on round + approval", async () => {
  verifyItemInImageMock.mock.mockImplementationOnce(async () => ({
    present: true,
    confidence: 0.9,
    reason: "found",
    photoOfPhoto: false,
    unsafe: false,
    unsafeReason: "",
    peoplePresent: true,
    minorsPresent: true, // policy: minors ARE sharable (group shares its own photo)
  }));
  const body = verifyBody();
  await postVerify(body);

  const progress = await (
    await fetch(`${baseUrl}/api/hunt/progress?round=${encodeURIComponent(body.roundClientId)}`)
  ).json();
  assert.equal(progress.length, 1);
  assert.equal(progress[0].sharable, true, "approved photo (minors included) is sharable");
  const findId = progress[0].id;

  // The right round fetches the actual bytes.
  const img = await fetch(
    `${baseUrl}/api/hunt/photo/${findId}?round=${encodeURIComponent(body.roundClientId)}`
  );
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), "moderation-test-image");

  // A different round (wrong group key) gets a generic 404.
  const wrongRound = await fetch(`${baseUrl}/api/hunt/photo/${findId}?round=some-other-round`);
  assert.equal(wrongRound.status, 404);

  // A legacy pre-moderation photo (moderation null) is NOT served or sharable.
  await testQuery(`update hunt_find set moderation = null where id = $1`, [findId]);
  const unmoderated = await fetch(
    `${baseUrl}/api/hunt/photo/${findId}?round=${encodeURIComponent(body.roundClientId)}`
  );
  assert.equal(unmoderated.status, 404);
  const progress2 = await (
    await fetch(`${baseUrl}/api/hunt/progress?round=${encodeURIComponent(body.roundClientId)}`)
  ).json();
  assert.equal(progress2[0].sharable, false);

  const badId = await fetch(`${baseUrl}/api/hunt/photo/nope?round=x`);
  assert.equal(badId.status, 400);
});

test("a verdict without moderation fields (older mock/verdict shape) defaults to safe", async () => {
  verifyItemInImageMock.mock.mockImplementationOnce(async () => ({
    present: true,
    confidence: 0.9,
    reason: "found",
    photoOfPhoto: false,
  }));
  const body = verifyBody();
  const res = await postVerify(body);
  assert.equal((await res.json()).verified, true, "missing moderation fields never block a find");
});
