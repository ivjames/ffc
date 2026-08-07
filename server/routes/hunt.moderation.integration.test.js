// Integration coverage for photo auto-moderation: the quarantine flow in
// POST /api/hunt/verify and the Master Control review surface
// (/api/admin/photos). Vision is mocked (same pattern as
// hunt.integration.test.js) so verdicts are scripted per test.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, writeFile, rm as rmDir } from "node:fs/promises";
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
process.env.APP_TOKEN = "photos-test-token";

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

function admin(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "photos-test-token",
      ...opts.headers,
    },
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
  await testQuery(
    `delete from admin_audit where entity = 'photo' and entity_id in
       (select f.id from hunt_find f join hunt_item i on i.id = f.item_id where i.course_id = $1)`,
    [courseId]
  );
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

test("admin queue filters, image streaming, and reject (file deleted, credit kept)", async () => {
  // One stored people-photo via the real endpoint.
  verifyItemInImageMock.mock.mockImplementationOnce(async () => ({
    present: true,
    confidence: 0.9,
    reason: "found",
    photoOfPhoto: false,
    unsafe: false,
    unsafeReason: "",
    peoplePresent: true,
    minorsPresent: false,
  }));
  const body = verifyBody();
  await postVerify(body);
  const stored = await testQuery(
    `select id, photo_path from hunt_find where round_client_id = $1`,
    [body.roundClientId]
  );
  const findId = stored.rows[0].id;
  const photoPath = stored.rows[0].photo_path;

  // people filter includes it, with venue context.
  const people = await (await admin(`/api/admin/photos?filter=people`)).json();
  const mine = people.find((p) => p.id === findId);
  assert.ok(mine, "stored people-photo appears under filter=people");
  assert.equal(mine.courseName, "Moderation Course");
  assert.equal(mine.hasPhoto, true);

  // flagged filter carries the earlier unsafe event (no photo).
  const flagged = await (await admin(`/api/admin/photos?filter=flagged`)).json();
  assert.ok(flagged.some((p) => p.moderationReason === "obscene gesture" && p.hasPhoto === false));

  // Image endpoint streams the bytes.
  const img = await admin(`/api/admin/photos/${findId}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), "moderation-test-image");

  // Reject: file gone from disk, path nulled, moderation flipped, verified
  // credit untouched, audited.
  const rej = await admin(`/api/admin/photos/${findId}/reject`, { method: "POST" });
  assert.equal(rej.status, 200);
  await assert.rejects(access(photoPath), "rejected photo file must be deleted from disk");
  const after = await testQuery(
    `select verified, moderation, photo_path from hunt_find where id = $1`,
    [findId]
  );
  assert.equal(after.rows[0].verified, true, "gameplay credit survives rejection");
  assert.equal(after.rows[0].moderation, "rejected");
  assert.equal(after.rows[0].photo_path, null);
  const img2 = await admin(`/api/admin/photos/${findId}/image`);
  assert.equal(img2.status, 404);

  const auditRows = await testQuery(
    `select action from admin_audit where entity = 'photo' and entity_id = $1`,
    [findId]
  );
  assert.deepEqual(auditRows.rows.map((r) => r.action), ["photo.reject"]);
});

test("a legacy pre-moderation photo shows in the review queue and can be approved", async () => {
  // Simulate a photo stored before moderation existed: file on disk, moderation null.
  const legacyPath = join(uploadDir, "legacy.jpg");
  await writeFile(legacyPath, "legacy-bytes");
  const legacy = await testQuery(
    `insert into hunt_find (round_client_id, player_tag, item_id, verified, photo_path)
       values ($1, 'LGC', $2, true, $3) returning id`,
    [`legacy-round-${Date.now()}`, itemId, legacyPath]
  );
  const id = legacy.rows[0].id;

  const review = await (await admin(`/api/admin/photos`)).json(); // default filter=review
  assert.ok(review.some((p) => p.id === id), "legacy row is in the review queue");

  const ok = await admin(`/api/admin/photos/${id}/approve`, { method: "POST" });
  assert.equal(ok.status, 200);
  const after = await testQuery(`select moderation from hunt_find where id = $1`, [id]);
  assert.equal(after.rows[0].moderation, "approved");

  const reviewAfter = await (await admin(`/api/admin/photos`)).json();
  assert.ok(!reviewAfter.some((p) => p.id === id), "approved row leaves the review queue");
});

test("photo admin surface requires auth and validates input", async () => {
  const anon = await fetch(`${baseUrl}/api/admin/photos`);
  assert.equal(anon.status, 401);
  const badFilter = await admin(`/api/admin/photos?filter=nope`);
  assert.equal(badFilter.status, 400);
  const badId = await admin(`/api/admin/photos/not-a-uuid/image`);
  assert.equal(badId.status, 400);
  const missing = await admin(`/api/admin/photos/00000000-0000-4000-8000-000000000000/approve`, {
    method: "POST",
  });
  assert.equal(missing.status, 404);
});
