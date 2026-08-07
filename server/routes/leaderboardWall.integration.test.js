// Integration coverage for GET /api/leaderboard/courses — the per-course
// boards feeding the venue display wall (/tv/wall).
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
let locationId;
let otherLocationId;
let courseA; // gets rounds
let courseB; // stays empty
let courseOther; // other venue — must not appear under locationId

// Insert a completed round + full-card scores directly (no HTTP, no rate limit).
async function seedRound({ courseId, tags, groupTag = null, strokesPerPlayer, completedAgoMs = 0 }) {
  const r = await testQuery(
    `insert into round (course_id, player_tags, group_tag, completed_at, client_id)
       values ($1, $2, $3, now() - ($4 || ' milliseconds')::interval, $5) returning id`,
    [courseId, tags, groupTag, String(completedAgoMs), `wall-${Date.now()}-${Math.random()}`]
  );
  const roundId = r.rows[0].id;
  for (let p = 0; p < tags.length; p++) {
    for (let hole = 1; hole <= 18; hole++) {
      await testQuery(
        `insert into score (round_id, player_index, hole, strokes) values ($1, $2, $3, $4)`,
        [roundId, p, hole, strokesPerPlayer[p]]
      );
    }
  }
}

function getBoards(query = "") {
  return fetch(`${baseUrl}/api/leaderboard/courses${query}`);
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug, tz, sort_order) values ($1, $2, 'America/Los_Angeles', 1) returning id`,
    [`Wall Venue ${stamp}`, `wall-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
  const other = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Wall Other ${stamp}`, `wall-other-${stamp}`]
  );
  otherLocationId = other.rows[0].id;

  const mk = (name, locId, sortOrder) =>
    testQuery(
      `insert into course (name, theme, pars, location_id, sort_order) values ($1, 'test', $2, $3, $4) returning id`,
      [name, Array(18).fill(3), locId, sortOrder]
    );
  courseA = (await mk("Wall Course A", locationId, 10)).rows[0].id;
  courseB = (await mk("Wall Course B", locationId, 20)).rows[0].id;
  courseOther = (await mk("Wall Course Elsewhere", otherLocationId, 10)).rows[0].id;

  // Course A: three players' bests (AAA 36, BBB 54, CCC 72), plus a worse AAA
  // round that must not appear. One team round under WLT.
  await seedRound({ courseId: courseA, tags: ["AAA"], strokesPerPlayer: [2] });
  await seedRound({ courseId: courseA, tags: ["AAA"], strokesPerPlayer: [4], completedAgoMs: 1000 });
  await seedRound({
    courseId: courseA,
    tags: ["BBB", "CCC"],
    groupTag: "WLT",
    strokesPerPlayer: [3, 4],
  });
  // The other venue's course has a round too — it must stay out of scoped calls.
  await seedRound({ courseId: courseOther, tags: ["ZZZ"], strokesPerPlayer: [3] });
});

after(async () => {
  if (close) await close();
  for (const c of [courseA, courseB, courseOther]) {
    await testQuery(`delete from round where course_id = $1`, [c]);
    await testQuery(`delete from course where id = $1`, [c]);
  }
  await testQuery(`delete from location where id = any($1::uuid[])`, [[locationId, otherLocationId]]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("per-course boards: grouped, ranked, best-per-tag, empty courses included", async () => {
  const res = await getBoards(`?locationId=${locationId}&period=all`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.by, "player");
  assert.equal(body.courses.length, 2, "only the venue's courses, in sort order");
  const [a, b] = body.courses;
  assert.equal(a.courseName, "Wall Course A");
  assert.deepEqual(
    a.rows.map((r) => [r.rank, r.tag, r.total]),
    [
      [1, "AAA", 36], // best of AAA's two rounds
      [2, "BBB", 54],
      [3, "CCC", 72],
    ]
  );
  assert.equal(b.courseName, "Wall Course B");
  assert.deepEqual(b.rows, [], "a course with no rounds still gets its column");
  assert.ok(!body.courses.some((c) => c.courseId === courseOther), "other venue excluded");
});

test("limit caps rows per course; unscoped call spans venues", async () => {
  const res = await getBoards(`?locationId=${locationId}&period=all&limit=1`);
  const body = await res.json();
  assert.equal(body.courses[0].rows.length, 1);
  assert.equal(body.courses[0].rows[0].tag, "AAA");

  const all = await (await getBoards(`?period=all`)).json();
  assert.ok(all.courses.some((c) => c.courseId === courseOther), "no locationId = every venue");
});

test("by=team boards use avg-per-player and skip tagless rounds", async () => {
  const res = await getBoards(`?locationId=${locationId}&period=all&by=team`);
  const body = await res.json();
  const a = body.courses.find((c) => c.courseId === courseA);
  // Only the WLT round carried a team tag: (54+72)/2 = 63.
  assert.deepEqual(
    a.rows.map((r) => [r.rank, r.tag, r.total]),
    [[1, "WLT", 63]]
  );
});

test("validation: bad period/by/locationId/limit all 400", async () => {
  for (const q of [
    "?period=fortnight",
    "?by=squad",
    "?locationId=nope",
    "?limit=0",
    "?limit=999",
  ]) {
    const res = await getBoards(q);
    assert.equal(res.status, 400, q);
  }
});
