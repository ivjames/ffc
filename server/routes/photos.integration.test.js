// Integration coverage for the photo booth (routes/photos.js) — the AI-free
// photo sharing + stickers pipeline — its admin review surface
// (routes/admin/boothPhotos.js), and the retention sweep
// (lib/boothPhotoRetention.js). No vision mock here on purpose: nothing in
// this pipeline may touch the model layer, so the suite runs with no
// ANTHROPIC_API_KEY set and would fail loudly if an AI call ever crept in.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm as rmDir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const APP_TOKEN = `booth-test-token-${Date.now()}`;
process.env.APP_TOKEN = APP_TOKEN;

const uploadDir = await mkdtemp(join(tmpdir(), "ffc-booth-test-"));
process.env.PHOTO_BOOTH_DIR = uploadDir;

const { app } = await import("../app.js");
const { sweepExpiredBoothPhotos } = await import("../lib/boothPhotoRetention.js");

let baseUrl;
let close;
let locationId;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** A fresh unguessable booth key (>= 16 chars, like the client's UUID). */
function newBoothId(label) {
  return `booth-${label}-${stamp}`;
}

function upload(body) {
  return fetch(`${baseUrl}/api/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function uploadBody(boothId, overrides = {}) {
  return {
    boothId,
    imageBase64: Buffer.from("booth-test-image").toString("base64"),
    mediaType: "image/jpeg",
    ...overrides,
  };
}

function adminGet(path) {
  return fetch(`${baseUrl}/api/admin/booth-photos${path}`, {
    headers: { "x-app-token": APP_TOKEN },
  });
}

function adminPost(path) {
  return fetch(`${baseUrl}/api/admin/booth-photos${path}`, {
    method: "POST",
    headers: { "x-app-token": APP_TOKEN },
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Booth Venue ${stamp}`, `booth-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from booth_photo where booth_id like $1`, [`booth-%-${stamp}`]);
  await testQuery(`delete from admin_audit where entity = 'booth_photo'`);
  await testQuery(`delete from location where id = $1`, [locationId]);
  await rmDir(uploadDir, { recursive: true, force: true });
  const { pool } = await import("../db.js");
  await pool.end();
});

test("upload -> list -> image -> delete round-trip, keyed by the booth id", async () => {
  const booth = newBoothId("roundtrip");

  const up = await upload(uploadBody(booth));
  assert.equal(up.status, 200);
  const saved = await up.json();
  assert.ok(saved.ok && saved.id && saved.createdAt);

  // The file is on disk where the row says it is.
  const row = await testQuery(
    `select photo_path, media_type, location_id from booth_photo where id = $1`,
    [saved.id]
  );
  assert.equal(row.rows[0].media_type, "image/jpeg");
  assert.equal(row.rows[0].location_id, null, "no locationId sent -> none stored");
  await access(row.rows[0].photo_path);

  // The gallery lists it, newest first.
  const list = await (
    await fetch(`${baseUrl}/api/photos?booth=${encodeURIComponent(booth)}`)
  ).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, saved.id);

  // The right booth key fetches the actual bytes.
  const img = await fetch(
    `${baseUrl}/api/photos/${saved.id}/image?booth=${encodeURIComponent(booth)}`
  );
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), "booth-test-image");

  // The player deletes their own photo: file and row both go.
  const del = await fetch(
    `${baseUrl}/api/photos/${saved.id}/delete?booth=${encodeURIComponent(booth)}`,
    { method: "POST" }
  );
  assert.equal(del.status, 200);
  await assert.rejects(access(row.rows[0].photo_path), "file must be gone from disk");
  const gone = await testQuery(`select 1 from booth_photo where id = $1`, [saved.id]);
  assert.equal(gone.rowCount, 0, "booth rows carry nothing worth keeping — deleted outright");
});

test("a wrong booth key sees nothing: empty list, generic 404s on image and delete", async () => {
  const booth = newBoothId("mine");
  const otherBooth = newBoothId("othergroup");
  const saved = await (await upload(uploadBody(booth))).json();

  const list = await (
    await fetch(`${baseUrl}/api/photos?booth=${encodeURIComponent(otherBooth)}`)
  ).json();
  assert.deepEqual(list, []);

  const img = await fetch(
    `${baseUrl}/api/photos/${saved.id}/image?booth=${encodeURIComponent(otherBooth)}`
  );
  assert.equal(img.status, 404);

  const del = await fetch(
    `${baseUrl}/api/photos/${saved.id}/delete?booth=${encodeURIComponent(otherBooth)}`,
    { method: "POST" }
  );
  assert.equal(del.status, 404);
  // Still there for the rightful owner.
  const stillThere = await testQuery(`select 1 from booth_photo where id = $1`, [saved.id]);
  assert.equal(stillThere.rowCount, 1);
});

test("upload validation: short booth key, bad media type, missing image all 400", async () => {
  const booth = newBoothId("valid");
  assert.equal((await upload(uploadBody("short"))).status, 400);
  assert.equal(
    (await upload(uploadBody(booth, { mediaType: "application/pdf" }))).status,
    400
  );
  assert.equal((await upload(uploadBody(booth, { imageBase64: "" }))).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/photos?booth=x`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/photos/not-a-uuid/image?booth=${newBoothId("q")}`)).status, 400);
});

test("locationId: a real venue is recorded for the review surface; an unknown one stores null", async () => {
  const booth = newBoothId("venue");
  const withVenue = await (await upload(uploadBody(booth, { locationId }))).json();
  const row = await testQuery(`select location_id from booth_photo where id = $1`, [withVenue.id]);
  assert.equal(row.rows[0].location_id, locationId);

  const bogus = await (
    await upload(uploadBody(booth, { locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" }))
  ).json();
  const row2 = await testQuery(`select location_id from booth_photo where id = $1`, [bogus.id]);
  assert.equal(row2.rows[0].location_id, null, "an unknown venue never fails the upload");
});

test("the per-booth stored cap 429s further uploads until something is deleted", async (t) => {
  t.after(() => {
    delete process.env.PHOTO_BOOTH_CAP;
  });
  process.env.PHOTO_BOOTH_CAP = "1";
  const booth = newBoothId("capped");

  const first = await upload(uploadBody(booth));
  assert.equal(first.status, 200);
  const second = await upload(uploadBody(booth));
  assert.equal(second.status, 429);
  assert.match((await second.json()).error, /photo limit/);

  // Deleting makes room again.
  const { id } = await first.json();
  await fetch(`${baseUrl}/api/photos/${id}/delete?booth=${encodeURIComponent(booth)}`, {
    method: "POST",
  });
  assert.equal((await upload(uploadBody(booth))).status, 200);
});

test("the global disk budget counts real stored bytes and 429s past it", async (t) => {
  t.after(() => {
    delete process.env.PHOTO_BOOTH_DISK_BUDGET_MB;
  });
  const booth = newBoothId("budget");

  // Stored bytes are recorded per photo — the budget's raw material.
  const saved = await (await upload(uploadBody(booth))).json();
  const row = await testQuery(`select bytes from booth_photo where id = $1`, [saved.id]);
  assert.equal(row.rows[0].bytes, Buffer.from("booth-test-image").length);

  // 0 = kill switch: any upload exceeds a zero budget, whatever the booth id —
  // rotating ids (the attack the budget exists for) doesn't help.
  process.env.PHOTO_BOOTH_DISK_BUDGET_MB = "0";
  const blocked = await upload(uploadBody(newBoothId("budget-rotated")));
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /full right now/);

  // Room in the budget again -> uploads flow.
  process.env.PHOTO_BOOTH_DISK_BUDGET_MB = "1024";
  assert.equal((await upload(uploadBody(booth))).status, 200);
});

test("GET /api/photos/retention reports the live retention config", async (t) => {
  t.after(() => {
    delete process.env.PHOTO_BOOTH_RETENTION_DAYS;
  });
  delete process.env.PHOTO_BOOTH_RETENTION_DAYS;
  assert.deepEqual(await (await fetch(`${baseUrl}/api/photos/retention`)).json(), { days: 30 });
  process.env.PHOTO_BOOTH_RETENTION_DAYS = "7";
  assert.deepEqual(await (await fetch(`${baseUrl}/api/photos/retention`)).json(), { days: 7 });
  process.env.PHOTO_BOOTH_RETENTION_DAYS = "0";
  assert.deepEqual(await (await fetch(`${baseUrl}/api/photos/retention`)).json(), { days: 0 });
});

test("retention sweep deletes expired photos — file AND row — and spares fresh ones", async (t) => {
  t.after(() => {
    delete process.env.PHOTO_BOOTH_RETENTION_DAYS;
  });
  const booth = newBoothId("sweep");
  const fresh = await (await upload(uploadBody(booth))).json();

  // A stale photo, planted directly: real file, backdated row.
  const stalePath = join(uploadDir, `stale-${stamp}.jpg`);
  await writeFile(stalePath, "stale-bytes");
  const stale = await testQuery(
    `insert into booth_photo (booth_id, photo_path, media_type, created_at)
     values ($1, $2, 'image/jpeg', now() - interval '45 days')
     returning id`,
    [booth, stalePath]
  );

  process.env.PHOTO_BOOTH_RETENTION_DAYS = "30";
  const { swept } = await sweepExpiredBoothPhotos();
  assert.ok(swept >= 1);

  await assert.rejects(access(stalePath), "expired photo must be gone from disk");
  const staleRow = await testQuery(`select 1 from booth_photo where id = $1`, [stale.rows[0].id]);
  assert.equal(staleRow.rowCount, 0, "the row goes with the file — no tombstones");

  const freshRow = await testQuery(
    `select photo_path from booth_photo where id = $1`,
    [fresh.id]
  );
  assert.equal(freshRow.rowCount, 1);
  await access(freshRow.rows[0].photo_path);

  // 0 disables the sweep entirely.
  process.env.PHOTO_BOOTH_RETENTION_DAYS = "0";
  assert.deepEqual(await sweepExpiredBoothPhotos(), { swept: 0 });
});

test("admin review: gated, lists with venue name, serves bytes, removes with audit", async () => {
  assert.equal((await fetch(`${baseUrl}/api/admin/booth-photos`)).status, 401);

  const booth = newBoothId("adminreview");
  const saved = await (await upload(uploadBody(booth, { locationId }))).json();

  const list = await (await adminGet("?limit=500")).json();
  const row = list.find((r) => r.id === saved.id);
  assert.ok(row, "stored booth photo appears in the review list");
  assert.equal(row.locationName, `Booth Venue ${stamp}`);

  const img = await adminGet(`/${saved.id}/image`);
  assert.equal(img.status, 200);
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), "booth-test-image");
  assert.equal((await adminGet("/not-a-uuid/image")).status, 400);
  assert.equal((await adminGet("?before=not-a-date")).status, 400);

  const photoPath = (
    await testQuery(`select photo_path from booth_photo where id = $1`, [saved.id])
  ).rows[0].photo_path;
  const removed = await adminPost(`/${saved.id}/remove`);
  assert.equal(removed.status, 200);
  await assert.rejects(access(photoPath), "file must be gone from disk");
  const gone = await testQuery(`select 1 from booth_photo where id = $1`, [saved.id]);
  assert.equal(gone.rowCount, 0);

  const auditRow = await testQuery(
    `select actor, action from admin_audit where entity = 'booth_photo' and entity_id = $1`,
    [saved.id]
  );
  assert.equal(auditRow.rows[0].action, "booth_photo.remove");
  assert.equal(auditRow.rows[0].actor, "app-token");

  // And the player's gallery no longer shows it.
  const playerList = await (
    await fetch(`${baseUrl}/api/photos?booth=${encodeURIComponent(booth)}`)
  ).json();
  assert.ok(!playerList.map((p) => p.id).includes(saved.id));

  assert.equal((await adminPost(`/${saved.id}/remove`)).status, 404);
});
