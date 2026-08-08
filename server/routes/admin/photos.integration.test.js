// Integration coverage for the hunt-photo review surface (routes/admin/photos.js)
// and the retention sweep (lib/photoRetention.js): list/filter, image bytes,
// operator removal (file + moderation state + audit), and age-based deletion.
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
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const APP_TOKEN = `photos-test-token-${Date.now()}`;
process.env.APP_TOKEN = APP_TOKEN;

const { app } = await import("../../app.js");
const { sweepExpiredHuntPhotos } = await import("../../lib/photoRetention.js");

const uploadDir = await mkdtemp(join(tmpdir(), "ffc-admin-photos-test-"));

let baseUrl;
let close;
let locationId;
let courseId;
let itemId;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function get(path) {
  return fetch(`${baseUrl}/api/admin/photos${path}`, {
    headers: { "x-app-token": APP_TOKEN },
  });
}

function post(path) {
  return fetch(`${baseUrl}/api/admin/photos${path}`, {
    method: "POST",
    headers: { "x-app-token": APP_TOKEN },
  });
}

/** Insert a hunt_find with a real file on disk; returns { id, photoPath }. */
async function insertPhotoFind({ tag = "PIC", minors = false, content = "photo-bytes", ageDays = 0 }) {
  const photoPath = join(uploadDir, `${stamp}-${Math.random().toString(36).slice(2)}.jpg`);
  await writeFile(photoPath, content);
  const row = await testQuery(
    `insert into hunt_find
       (round_client_id, player_tag, item_id, verified, confidence, reason, photo_path,
        moderation, people_present, minors_present, created_at)
     values ($1, $2, $3, true, 0.9, 'found', $4, 'approved', $5, $6, now() - ($7::int * interval '1 day'))
     returning id`,
    [`photos-round-${stamp}`, tag, itemId, photoPath, minors, minors, ageDays]
  );
  return { id: row.rows[0].id, photoPath };
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Photos Venue ${stamp}`, `photos-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, 'test', $2, $3) returning id`,
    ["Photos Course", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;
  const item = await testQuery(
    `insert into hunt_item (course_id, slug, name) values ($1, 'photos-item', 'The photo windmill') returning id`,
    [courseId]
  );
  itemId = item.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(
    `delete from hunt_find where item_id in (select id from hunt_item where course_id = $1)`,
    [courseId]
  );
  await testQuery(`delete from hunt_item where course_id = $1`, [courseId]);
  await testQuery(`delete from course where id = $1`, [courseId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  await testQuery(`delete from admin_audit where entity = 'hunt_find'`);
  await rmDir(uploadDir, { recursive: true, force: true });
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("the surface is admin-gated", async () => {
  const res = await fetch(`${baseUrl}/api/admin/photos`);
  assert.equal(res.status, 401);
});

test("list returns stored photos with metadata, and minors=1 filters", async () => {
  const plain = await insertPhotoFind({ tag: "AAA", minors: false });
  const withMinor = await insertPhotoFind({ tag: "BBB", minors: true });

  const all = await (await get("")).json();
  const ids = all.map((r) => r.id);
  assert.ok(ids.includes(plain.id) && ids.includes(withMinor.id));
  const row = all.find((r) => r.id === withMinor.id);
  assert.equal(row.playerTag, "BBB");
  assert.equal(row.itemName, "The photo windmill");
  assert.equal(row.courseName, "Photos Course");
  assert.equal(row.minorsPresent, true);
  assert.equal(row.moderation, "approved");

  const minorsOnly = await (await get("?minors=1")).json();
  const minorIds = minorsOnly.map((r) => r.id);
  assert.ok(minorIds.includes(withMinor.id));
  assert.ok(!minorIds.includes(plain.id));
});

test("image endpoint serves the bytes; bad/unknown ids 400/404", async () => {
  const { id } = await insertPhotoFind({ content: "admin-review-bytes" });
  const img = await get(`/${id}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), "admin-review-bytes");

  assert.equal((await get("/not-a-uuid/image")).status, 400);
  assert.equal((await get("/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/image")).status, 404);
});

test("remove deletes the file, marks the find rejected, audits, and keeps the credit", async () => {
  const { id, photoPath } = await insertPhotoFind({ tag: "DEL" });

  const res = await post(`/${id}/remove`);
  assert.equal(res.status, 200);

  await assert.rejects(access(photoPath), "file must be gone from disk");
  const row = await testQuery(
    `select verified, photo_path, moderation from hunt_find where id = $1`,
    [id]
  );
  assert.equal(row.rows[0].photo_path, null);
  assert.equal(row.rows[0].moderation, "rejected");
  assert.equal(row.rows[0].verified, true, "gameplay credit survives photo removal");

  const auditRow = await testQuery(
    `select actor, action from admin_audit where entity = 'hunt_find' and entity_id = $1`,
    [id]
  );
  assert.equal(auditRow.rows[0].action, "hunt_photo.remove");
  assert.equal(auditRow.rows[0].actor, "app-token");

  // Once removed it disappears from the surface entirely.
  assert.equal((await get(`/${id}/image`)).status, 404);
  assert.equal((await post(`/${id}/remove`)).status, 404);
  const list = await (await get("")).json();
  assert.ok(!list.map((r) => r.id).includes(id));
});

test("retention sweep deletes only photos older than the window", async (t) => {
  t.after(() => {
    delete process.env.HUNT_PHOTO_RETENTION_DAYS;
  });
  const fresh = await insertPhotoFind({ tag: "NEW", ageDays: 0 });
  const stale = await insertPhotoFind({ tag: "OLD", ageDays: 45 });

  process.env.HUNT_PHOTO_RETENTION_DAYS = "30";
  const { swept } = await sweepExpiredHuntPhotos();
  assert.ok(swept >= 1);

  await assert.rejects(access(stale.photoPath), "expired photo must be gone from disk");
  const staleRow = await testQuery(`select photo_path, verified from hunt_find where id = $1`, [stale.id]);
  assert.equal(staleRow.rows[0].photo_path, null);
  assert.equal(staleRow.rows[0].verified, true, "the find row outlives its photo");

  await access(fresh.photoPath); // still on disk
  const freshRow = await testQuery(`select photo_path from hunt_find where id = $1`, [fresh.id]);
  assert.ok(freshRow.rows[0].photo_path);

  // 0 disables the sweep entirely.
  process.env.HUNT_PHOTO_RETENTION_DAYS = "0";
  const older = await insertPhotoFind({ tag: "KEP", ageDays: 400 });
  assert.deepEqual(await sweepExpiredHuntPhotos(), { swept: 0 });
  await access(older.photoPath);
});
