// Cross-tenant isolation sweep (MULTI-VENUE.md §6 bullet 1): player-facing
// endpoints that accept a course_id / location_id / tenant-owned row id must
// treat a foreign tenant's id exactly like a nonexistent one — same status,
// same body, no existence leak — and the fallback host must still see org-less
// legacy rows. Uses hostRequest so the Host header can be set per request (node
// fetch strips it as forbidden), the tenant.integration.test.js pattern.
//
// lib/vision.js is mocked (the hunt.integration.test.js pattern) so the
// /api/hunt/verify tenant gate is exercised with no network and no API key.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm as rmDir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostRequest } from "../test-support/hostRequest.js";
import { TEST_DATABASE_URL, ensureSchema, testQuery } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.ANTHROPIC_API_KEY = "test-key"; // so isVisionConfigured() is true

const uploadDir = await mkdtemp(join(tmpdir(), "ffc-tenant-iso-"));
process.env.HUNT_UPLOAD_DIR = join(uploadDir, "hunt");
process.env.PHOTO_BOOTH_DIR = join(uploadDir, "booth");

mock.module("../lib/vision.js", {
  namedExports: {
    verifyItemInImage: mock.fn(async () => ({
      present: true,
      confidence: 0.9,
      reason: "mock verdict",
      photoOfPhoto: false,
    })),
    isVisionConfigured: () => true,
    ALLOWED_MEDIA_TYPES: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  },
});

// Apply any real server/.env now, then scrub the anti-cheat bypass before
// routes/hunt.js resolves it at import time (hunt.integration.test.js's rule).
await import("dotenv/config");
delete process.env.HUNT_ALLOW_PHOTO_OF_PHOTO;

const { app } = await import("../app.js");
const { clearTenantCache } = await import("../lib/tenant.js");
const { createUserSession } = await import("../lib/userAuth.js");

const DOMAIN = "minigolf.example";
// An unknown label resolves via fallback to the schema-seeded default org
// (DEFAULT_ORG_SLUG is unset in tests), which also sweeps in org-less rows.
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const slugA = `iso-a-${stamp}`;
const slugB = `iso-b-${stamp}`;
const fallbackLabel = `iso-nope-${stamp}`;

const PNG_BASE64 = Buffer.from("tenant-iso-test-image-bytes").toString("base64");
const deviceId = crypto.randomUUID();
const boothId = `tenant-iso-booth-${stamp}`;

let orgAId, orgBId;
let locAId, locBId, locNoneId;
let courseAId, courseBId, courseNoneId;
let itemAId, itemBId, itemNoneId;
let stickerAId, stickerBId;
let annGlobalId, annBId;
let user; // signed-in player for shared-game create

/** Request with a per-tenant Host header; cache cleared so every case
 *  re-resolves (the 30s TTL outlives a test run). */
function req(method, path, hostLabel, { headers, body } = {}) {
  clearTenantCache();
  return hostRequest(app, { method, path, host: `${hostLabel}.${DOMAIN}`, headers, body });
}

async function insertCourse(name, locationId) {
  const db = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, 'test', $2, $3) returning id`,
    [name, Array(18).fill(3), locationId]
  );
  return db.rows[0].id;
}

async function insertItem(courseId, slug) {
  const db = await testQuery(
    `insert into hunt_item (course_id, slug, name, hint) values ($1, $2, 'A thing', 'find it')
     returning id`,
    [courseId, slug]
  );
  return db.rows[0].id;
}

/** A completed one-hole round so the tag shows on the boards. */
async function insertRound(courseId, tag, total) {
  const db = await testQuery(
    `insert into round (course_id, player_tags, created_at, completed_at, client_id)
       values ($1, $2, now(), now(), $3) returning id`,
    [courseId, [tag], `tenant-iso-${stamp}-${tag}`]
  );
  await testQuery(
    `insert into score (round_id, player_index, hole, strokes) values ($1, 0, 1, $2)`,
    [db.rows[0].id, total]
  );
  return db.rows[0].id;
}

before(async () => {
  await ensureSchema();

  const orgA = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Iso Org A ${stamp}`,
    slugA,
  ]);
  orgAId = orgA.rows[0].id;
  const orgB = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Iso Org B ${stamp}`,
    slugB,
  ]);
  orgBId = orgB.rows[0].id;

  // Two tenant venues plus an org-less legacy venue (the fallback safety net).
  // No `pos` anywhere: the game-rewards tests rely on 403 ("not enabled") vs
  // 404 ("unknown location") to tell "past the tenant gate" from "blocked".
  const mkLoc = async (name, slug, orgId) =>
    (
      await testQuery(
        `insert into location (name, slug, org_id) values ($1, $2, $3) returning id`,
        [name, slug, orgId]
      )
    ).rows[0].id;
  locAId = await mkLoc(`Iso Loc A ${stamp}`, `iso-loc-a-${stamp}`, orgAId);
  locBId = await mkLoc(`Iso Loc B ${stamp}`, `iso-loc-b-${stamp}`, orgBId);
  locNoneId = await mkLoc(`Iso Loc None ${stamp}`, `iso-loc-none-${stamp}`, null);

  courseAId = await insertCourse(`Iso Course A ${stamp}`, locAId);
  courseBId = await insertCourse(`Iso Course B ${stamp}`, locBId);
  courseNoneId = await insertCourse(`Iso Course None ${stamp}`, locNoneId);

  itemAId = await insertItem(courseAId, "iso-a");
  itemBId = await insertItem(courseBId, "iso-b");
  itemNoneId = await insertItem(courseNoneId, "iso-none");

  // Board fixtures: one completed round per course, distinct tags/totals.
  await insertRound(courseAId, "ZTA", 40);
  await insertRound(courseBId, "ZTB", 41);
  await insertRound(courseNoneId, "ZTN", 42);

  // Venue stickers with real asset files, so the own-tenant image read 200s.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`;
  const mkSticker = async (locationId, label) => {
    const path = join(uploadDir, `${label}.svg`);
    await writeFile(path, svg);
    const db = await testQuery(
      `insert into booth_sticker (location_id, svg_path, label) values ($1, $2, $3) returning id`,
      [locationId, path, label]
    );
    return db.rows[0].id;
  };
  stickerAId = await mkSticker(locAId, `iso-sticker-a-${stamp}`);
  stickerBId = await mkSticker(locBId, `iso-sticker-b-${stamp}`);

  const annG = await testQuery(`insert into announcement (title) values ($1) returning id`, [
    `Iso Global ${stamp}`,
  ]);
  annGlobalId = annG.rows[0].id;
  const annB = await testQuery(
    `insert into announcement (title, location_id) values ($1, $2) returning id`,
    [`Iso Pinned B ${stamp}`, locBId]
  );
  annBId = annB.rows[0].id;

  const u = await testQuery(
    `insert into app_user (email, email_verified_at, display_name)
       values ($1, now(), 'Iso Tester') returning id`,
    [`tenant-iso-${stamp}@example.com`]
  );
  const { token } = await createUserSession(u.rows[0].id);
  user = { id: u.rows[0].id, cookie: `ffc_session=${token}` };
});

after(async () => {
  const courseIds = [courseAId, courseBId, courseNoneId];
  await testQuery(`delete from shared_game where course_id = any($1::uuid[])`, [courseIds]);
  await testQuery(`delete from hunt_scan where course_id = any($1::uuid[])`, [courseIds]);
  await testQuery(`delete from hunt_find where round_client_id like $1`, [`tenant-iso-${stamp}%`]);
  await testQuery(`delete from round where course_id = any($1::uuid[])`, [courseIds]); // cascades score/grants
  await testQuery(`delete from course where id = any($1::uuid[])`, [courseIds]); // cascades hunt_item
  await testQuery(`delete from announcement where id in ($1, $2)`, [annGlobalId, annBId]);
  await testQuery(`delete from booth_sticker where id in ($1, $2)`, [stickerAId, stickerBId]);
  await testQuery(`delete from booth_photo where booth_id = $1`, [boothId]);
  await testQuery(`delete from funnel_event where device_id = $1`, [deviceId]);
  await testQuery(`delete from reviewer_feedback where device_id = $1`, [deviceId]);
  await testQuery(`delete from location where id in ($1, $2, $3)`, [locAId, locBId, locNoneId]);
  await testQuery(`delete from org where id in ($1, $2)`, [orgAId, orgBId]);
  await testQuery(`delete from app_user where id = $1`, [user.id]); // cascades session
  await rmDir(uploadDir, { recursive: true, force: true });
  const { pool } = await import("../db.js");
  await pool.end();
});

// --- POST /api/rounds --------------------------------------------------------

test("rounds: own course syncs; a foreign course id reads as nonexistent; fallback keeps org-less courses", async () => {
  const body = (courseId, n) => ({
    clientId: `tenant-iso-${stamp}-sync-${n}`,
    courseId,
    playerTags: ["ZZQ"],
    createdAt: Date.now(),
    completedAt: null,
    scores: { 0: Array(18).fill(null) },
  });

  const own = await req("post", "/api/rounds", slugA, { body: body(courseAId, 1) });
  assert.equal(own.status, 200);
  assert.ok(own.body.roundId);

  const foreign = await req("post", "/api/rounds", slugA, { body: body(courseBId, 2) });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.error, "courseId does not exist");

  // Fallback host: org-less legacy course still syncs; a real tenant's stays out.
  const orgless = await req("post", "/api/rounds", fallbackLabel, { body: body(courseNoneId, 3) });
  assert.equal(orgless.status, 200);
  const stillForeign = await req("post", "/api/rounds", fallbackLabel, { body: body(courseBId, 4) });
  assert.equal(stillForeign.status, 400);
});

// --- GET /api/leaderboard ------------------------------------------------------

test("leaderboard: scoped to the tenant with or without a locationId; foreign locationId = empty board", async () => {
  const tags = (res) => res.body.map((r) => r.tag);

  const own = await req("get", "/api/leaderboard", slugA);
  assert.equal(own.status, 200);
  assert.ok(tags(own).includes("ZTA"), "own tenant's round shows");
  assert.ok(!tags(own).includes("ZTB"), "other tenant's round hidden without any locationId");
  assert.ok(!tags(own).includes("ZTN"), "org-less round hidden under an exact tenant match");

  // A guessed foreign locationId answers like a nonexistent one: empty board.
  const foreign = await req("get", `/api/leaderboard?locationId=${locBId}`, slugA);
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.body, []);

  const fallback = await req("get", "/api/leaderboard", fallbackLabel);
  assert.equal(fallback.status, 200);
  assert.ok(tags(fallback).includes("ZTN"), "fallback host still sees org-less legacy rounds");
  assert.ok(!tags(fallback).includes("ZTA") && !tags(fallback).includes("ZTB"));
});

test("leaderboard wall: course columns and rows are tenant-scoped too", async () => {
  const own = await req("get", "/api/leaderboard/courses?period=all", slugA);
  assert.equal(own.status, 200);
  const ownIds = own.body.courses.map((c) => c.courseId);
  assert.ok(ownIds.includes(courseAId) && !ownIds.includes(courseBId) && !ownIds.includes(courseNoneId));
  const colA = own.body.courses.find((c) => c.courseId === courseAId);
  assert.deepEqual(colA.rows.map((r) => r.tag), ["ZTA"]);

  // Foreign locationId: no boards, and no course names leak either.
  const foreign = await req("get", `/api/leaderboard/courses?period=all&locationId=${locBId}`, slugA);
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.body.courses, []);

  const fallback = await req("get", "/api/leaderboard/courses?period=all", fallbackLabel);
  const fbIds = fallback.body.courses.map((c) => c.courseId);
  assert.ok(fbIds.includes(courseNoneId), "org-less course on the fallback wall");
  assert.ok(!fbIds.includes(courseAId) && !fbIds.includes(courseBId));
});

// --- Hunt --------------------------------------------------------------------

test("hunt items: a foreign course id answers like a course with no list", async () => {
  const own = await req("get", `/api/hunt/items?course=${courseAId}`, slugA);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.map((i) => i.slug), ["iso-a"]);

  const foreign = await req("get", `/api/hunt/items?course=${courseBId}`, slugA);
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.body, []);

  const fallback = await req("get", `/api/hunt/items?course=${courseNoneId}`, fallbackLabel);
  assert.equal(fallback.status, 200);
  assert.deepEqual(fallback.body.map((i) => i.slug), ["iso-none"]);
});

test("hunt verify: foreign course/item burns nothing and reads as nonexistent", async () => {
  const body = (itemId, courseId) => ({
    itemId,
    courseId,
    playerTag: "ZZQ",
    roundClientId: `tenant-iso-${stamp}-hunt`,
    imageBase64: PNG_BASE64,
    mediaType: "image/jpeg",
  });

  const foreign = await req("post", "/api/hunt/verify", slugA, { body: body(itemBId, courseBId) });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.error, "itemId does not exist on this course");
  const scans = await testQuery(`select count(*)::int as n from hunt_scan where item_id = $1`, [
    itemBId,
  ]);
  assert.equal(scans.rows[0].n, 0, "no vision spend metered for the foreign attempt");

  const own = await req("post", "/api/hunt/verify", slugA, { body: body(itemAId, courseAId) });
  assert.equal(own.status, 200);
  assert.equal(own.body.verified, true);

  const orgless = await req("post", "/api/hunt/verify", fallbackLabel, {
    body: body(itemNoneId, courseNoneId),
  });
  assert.equal(orgless.status, 200);
  assert.equal(orgless.body.verified, true);
});

// --- Booth stickers ------------------------------------------------------------

test("stickers: a foreign location id answers like a venue with no sheet; assets 404 across tenants", async () => {
  const own = await req("get", `/api/photos/stickers?location=${locAId}`, slugA);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.map((s) => s.id), [stickerAId]);

  const foreign = await req("get", `/api/photos/stickers?location=${locBId}`, slugA);
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.body, []);

  const foreignAsset = await req("get", `/api/photos/stickers/${stickerBId}/image`, slugA);
  assert.equal(foreignAsset.status, 404);
  const ownAsset = await req("get", `/api/photos/stickers/${stickerBId}/image`, slugB);
  assert.equal(ownAsset.status, 200);
});

// --- Booth photo upload attribution ---------------------------------------------

test("booth upload: a foreign locationId attributes like an unknown one (stored null)", async () => {
  const body = (locationId) => ({ boothId, locationId, imageBase64: PNG_BASE64, mediaType: "image/jpeg" });

  const foreign = await req("post", "/api/photos", slugA, { body: body(locBId) });
  assert.equal(foreign.status, 200);
  const fRow = await testQuery(`select location_id from booth_photo where id = $1`, [foreign.body.id]);
  assert.equal(fRow.rows[0].location_id, null, "foreign venue not planted in another tenant's review queue");

  const own = await req("post", "/api/photos", slugA, { body: body(locAId) });
  assert.equal(own.status, 200);
  const oRow = await testQuery(`select location_id from booth_photo where id = $1`, [own.body.id]);
  assert.equal(oRow.rows[0].location_id, locAId);
});

// --- Game ticket awards -----------------------------------------------------------

test("game rewards: foreign location = 404 unknown; own location gets past the tenant gate", async () => {
  const award = (locationId) => ({
    locationId,
    playerId: "card-1",
    game: "skeeball",
    tickets: 10,
    sessionId: `tenant-iso-${stamp}-award`,
  });
  const foreign = await req("post", "/api/game-rewards/award", slugA, { body: award(locBId) });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "unknown location");
  // Own venue (no POS configured): 403 "not enabled" proves the tenant gate
  // passed and the venue-config gate is what stopped it — not a 404.
  const own = await req("post", "/api/game-rewards/award", slugA, { body: award(locAId) });
  assert.equal(own.status, 403);

  const bonus = (locationId) => ({ locationId, playerId: "card-1", kind: "install" });
  const foreignBonus = await req("post", "/api/game-rewards/bonus", slugA, { body: bonus(locBId) });
  assert.equal(foreignBonus.status, 404);
  const ownBonus = await req("post", "/api/game-rewards/bonus", slugA, { body: bonus(locAId) });
  assert.equal(ownBonus.status, 403);
});

// --- Funnel + feedback attribution ------------------------------------------------

test("funnel beacon: a foreign locationId records the event with location null", async () => {
  const eventId1 = crypto.randomUUID();
  const eventId2 = crypto.randomUUID();
  const res = await req("post", "/api/events", slugA, {
    body: {
      deviceId,
      events: [
        { id: eventId1, name: "nudge_shown", locationId: locBId },
        { id: eventId2, name: "nudge_shown", locationId: locAId },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.recorded, 2);
  const rows = await testQuery(
    `select client_event_id as id, location_id from funnel_event where client_event_id in ($1, $2)`,
    [eventId1, eventId2]
  );
  const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.location_id]));
  assert.equal(byId[eventId1], null, "foreign venue attribution dropped");
  assert.equal(byId[eventId2], locAId, "own venue attribution kept");
});

test("feedback: a foreign locationId files with location null", async () => {
  const foreign = await req("post", "/api/feedback", slugA, {
    body: { body: "tenant iso foreign", deviceId, locationId: locBId },
  });
  assert.equal(foreign.status, 201);
  const own = await req("post", "/api/feedback", slugA, {
    body: { body: "tenant iso own", deviceId, locationId: locAId },
  });
  assert.equal(own.status, 201);
  const rows = await testQuery(
    `select id, location_id from reviewer_feedback where id in ($1, $2)`,
    [foreign.body.id, own.body.id]
  );
  const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.location_id]));
  assert.equal(byId[foreign.body.id], null);
  assert.equal(byId[own.body.id], locAId);
});

// --- Announcement view beacon -------------------------------------------------------

test("announcement views: a foreign pinned id is dropped like a nonexistent one; global rows count everywhere", async () => {
  const foreign = await req("post", "/api/announcements/views", slugA, {
    body: { deviceId, ids: [annBId] },
  });
  assert.equal(foreign.status, 200);
  assert.equal(foreign.body.recorded, 0, "another tenant's promo can't be view-stuffed by id");

  const mixed = await req("post", "/api/announcements/views", slugB, {
    body: { deviceId, ids: [annBId, annGlobalId] },
  });
  assert.equal(mixed.status, 200);
  assert.equal(mixed.body.recorded, 2, "own pinned + global both count on the owning tenant");
});

// --- Shared games ----------------------------------------------------------------

test("shared games: the course lookup is tenant-scoped; the social graph stays global", async () => {
  const foreign = await req("post", "/api/games", slugA, {
    headers: { Cookie: user.cookie },
    body: { courseId: courseBId, tag: "ZZQ" },
  });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.error, "courseId does not exist");

  const own = await req("post", "/api/games", slugA, {
    headers: { Cookie: user.cookie },
    body: { courseId: courseAId, tag: "ZZQ" },
  });
  assert.equal(own.status, 200);

  // Deliberately global from here: the join code is the capability, so a
  // friend on ANY subdomain can join the game (player accounts are global).
  const join = await req("post", "/api/games/join", slugB, {
    body: { joinCode: own.body.game.joinCode, tag: "ZZR" },
  });
  assert.equal(join.status, 200);
});

// --- Public locations list -----------------------------------------------------------

test("locations list: one subdomain cannot enumerate another client's venues", async () => {
  const own = await req("get", "/api/locations", slugA);
  assert.equal(own.status, 200);
  const ownIds = own.body.map((l) => l.id);
  assert.ok(ownIds.includes(locAId) && !ownIds.includes(locBId) && !ownIds.includes(locNoneId));

  const fallback = await req("get", "/api/locations", fallbackLabel);
  const fbIds = fallback.body.map((l) => l.id);
  assert.ok(fbIds.includes(locNoneId), "org-less venue still listed on the fallback host");
  assert.ok(!fbIds.includes(locAId) && !fbIds.includes(locBId));
});
