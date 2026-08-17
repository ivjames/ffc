// Integration coverage for GET /api/content — the live-only player catalog.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");

let baseUrl;
let close;
let liveLocationId;
let archivedLocationId;
let liveCourseId;
let archivedCourseId;

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const live = await testQuery(
    `insert into location (name, slug, lat, lng, geofence_km, tz, sort_order)
       values ($1, $2, 1, 2, 3, 'America/Los_Angeles', 5) returning id`,
    [`Content Test Live ${stamp}`, `content-live-${stamp}`]
  );
  liveLocationId = live.rows[0].id;

  const archived = await testQuery(
    `insert into location (name, slug, archived_at) values ($1, $2, now()) returning id`,
    [`Content Test Archived ${stamp}`, `content-archived-${stamp}`]
  );
  archivedLocationId = archived.rows[0].id;

  const liveCourse = await testQuery(
    `insert into course (name, theme, pars, location_id, sort_order) values ($1, $2, $3, $4, 7) returning id`,
    ["Content Live Course", "test", Array(18).fill(3), liveLocationId]
  );
  liveCourseId = liveCourse.rows[0].id;

  const archivedCourse = await testQuery(
    `insert into course (name, theme, pars, location_id, archived_at) values ($1, $2, $3, $4, now()) returning id`,
    ["Content Archived Course", "test", Array(18).fill(3), liveLocationId]
  );
  archivedCourseId = archivedCourse.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from course where id in ($1, $2)`, [liveCourseId, archivedCourseId]);
  await testQuery(`delete from location where id in ($1, $2)`, [
    liveLocationId,
    archivedLocationId,
  ]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("GET /api/content returns only live locations and courses, with the expected shape", async () => {
  const res = await fetch(`${baseUrl}/api/content`);
  assert.equal(res.status, 200);
  const body = await res.json();

  const location = body.locations.find((l) => l.id === liveLocationId);
  assert.ok(location, "live location present");
  assert.match(location.name, /^Content Test Live/);
  assert.equal(location.geofenceKm, 3);
  assert.equal(location.tz, "America/Los_Angeles");
  assert.equal(location.sortOrder, 5);
  assert.ok("orgId" in location);
  assert.equal(
    body.locations.some((l) => l.id === archivedLocationId),
    false,
    "archived location excluded"
  );

  const course = body.courses.find((c) => c.id === liveCourseId);
  assert.ok(course, "live course present");
  assert.equal(course.locationId, liveLocationId);
  assert.equal(course.holeCount, 18);
  assert.equal(course.pars.length, 18);
  assert.equal(course.sortOrder, 7);
  assert.equal(
    body.courses.some((c) => c.id === archivedCourseId),
    false,
    "archived course excluded"
  );
});

// `venueHunt` gates the Home tile for the course-free hunt, so it has to mean
// "a player opening this right now gets something playable" — both halves, not
// just the operator's switch.
test("venueHunt needs BOTH venueMode on and an active item on the venue's list", async () => {
  const read = async () =>
    (await (await fetch(`${baseUrl}/api/content`)).json()).locations.find(
      (l) => l.id === liveLocationId
    ).venueHunt;

  // Neither: off.
  assert.equal(await read(), false);

  // Items but no switch: still off — a staged list must not advertise itself.
  const item = await testQuery(
    `insert into hunt_item (location_id, slug, name) values ($1, 'wheel', 'The wheel') returning id`,
    [liveLocationId]
  );
  assert.equal(await read(), false);

  // Switch but the only item is inactive: still off — the tile would open an
  // empty hunt.
  await testQuery(`update location set hunt = '{"venueMode": true}'::jsonb where id = $1`, [
    liveLocationId,
  ]);
  await testQuery(`update hunt_item set active = false where id = $1`, [item.rows[0].id]);
  assert.equal(await read(), false);

  // Both: on.
  await testQuery(`update hunt_item set active = true where id = $1`, [item.rows[0].id]);
  assert.equal(await read(), true);

  // A course item at the same venue doesn't count — it isn't the venue's list.
  await testQuery(`delete from hunt_item where id = $1`, [item.rows[0].id]);
  await testQuery(
    `insert into hunt_item (course_id, slug, name) values ($1, 'flag', 'A flag')`,
    [liveCourseId]
  );
  assert.equal(await read(), false);

  await testQuery(`update location set hunt = '{}'::jsonb where id = $1`, [liveLocationId]);
  await testQuery(`delete from hunt_item where course_id = $1`, [liveCourseId]);
});
