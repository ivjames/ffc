// Integration coverage for GET /api/leaderboard — best-per-tag-per-course
// aggregation and calendar-window filtering. Fixture rounds/scores are
// inserted directly (not through POST /api/rounds) so exact totals and
// completed_at timestamps are fully controlled.
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
let courseAId;
let courseBId;
const roundIds = [];

async function insertRound({ courseId, tag, total, completedAt }) {
  const clientId = `lb-${Date.now()}-${Math.random()}`;
  const round = await testQuery(
    `insert into round (course_id, player_tags, created_at, completed_at, client_id)
       values ($1, $2, now(), $3, $4) returning id`,
    [courseId, [tag], completedAt, clientId]
  );
  const roundId = round.rows[0].id;
  roundIds.push(roundId);
  await testQuery(`insert into score (round_id, player_index, hole, strokes) values ($1, 0, 1, $2)`, [
    roundId,
    total,
  ]);
  return roundId;
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug, tz) values ($1, $2, 'America/Los_Angeles') returning id`,
    [`Leaderboard Test Venue ${stamp}`, `lb-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
  const courseA = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["LB Course A", "test", Array(18).fill(3), locationId]
  );
  courseAId = courseA.rows[0].id;
  const courseB = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["LB Course B", "test", Array(18).fill(3), locationId]
  );
  courseBId = courseB.rows[0].id;

  const OLD = new Date("2020-01-01T00:00:00Z");
  const NOW = new Date();

  // Tag TAA on course A: two rounds, best (lowest) total must be 40.
  await insertRound({ courseId: courseAId, tag: "TAA", total: 50, completedAt: NOW });
  await insertRound({ courseId: courseAId, tag: "TAA", total: 40, completedAt: NOW });
  // Tag TBB on course A: single round, sorts ahead of TAA (lower total).
  await insertRound({ courseId: courseAId, tag: "TBB", total: 30, completedAt: NOW });
  // Tag TAA on course B too: best-per-(tag, course) must keep this separate from course A.
  await insertRound({ courseId: courseBId, tag: "TAA", total: 20, completedAt: NOW });
  // Tag TOLD on course A: completed long ago — excluded from day/week/month, present in "all".
  await insertRound({ courseId: courseAId, tag: "TOLD", total: 15, completedAt: OLD });
  // An in-progress round (completedAt null) must never appear, in any period.
  await insertRound({ courseId: courseAId, tag: "TWIP", total: 1, completedAt: null });
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from round where id = any($1::uuid[])`, [roundIds]); // cascades score
  await testQuery(`delete from course where id in ($1, $2)`, [courseAId, courseBId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("GET /api/leaderboard rejects an invalid period", async () => {
  const res = await fetch(`${baseUrl}/api/leaderboard?period=decade`);
  assert.equal(res.status, 400);
});

test("GET /api/leaderboard?period=all keeps each tag's best total per course, sorted ascending", async () => {
  const res = await fetch(`${baseUrl}/api/leaderboard?period=all`);
  assert.equal(res.status, 200);
  const rows = await res.json();

  const forTag = (tag, courseId) => {
    const row = rows.find((r) => r.tag === tag && r.courseId === courseId);
    return row && { ...row, total: Number(row.total) };
  };

  assert.equal(forTag("TAA", courseAId).total, 40, "keeps the lower of TAA's two course-A rounds");
  assert.equal(forTag("TAA", courseBId).total, 20, "TAA on course B is tracked separately");
  assert.equal(forTag("TBB", courseAId).total, 30);
  assert.equal(forTag("TOLD", courseAId).total, 15, "present under period=all");
  assert.equal(forTag("TWIP", courseAId), undefined, "in-progress round never appears");
  assert.equal(forTag("TAA", courseBId).courseName, "LB Course B");

  // totals arrive from Postgres as numeric strings — coerce before comparing.
  const totals = rows.map((r) => Number(r.total));
  const sorted = [...totals].sort((a, b) => a - b);
  assert.deepEqual(totals, sorted, "response is sorted ascending by total");
});

test("GET /api/leaderboard?period=day excludes a round completed long ago", async () => {
  const res = await fetch(`${baseUrl}/api/leaderboard?period=day`);
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(rows.some((r) => r.tag === "TAA" && r.courseId === courseAId), "recent round present");
  assert.ok(!rows.some((r) => r.tag === "TOLD"), "old round excluded from period=day");
});

test("GET /api/leaderboard?period=month excludes a round completed in 2020", async () => {
  const res = await fetch(`${baseUrl}/api/leaderboard?period=month`);
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(!rows.some((r) => r.tag === "TOLD"));
});
