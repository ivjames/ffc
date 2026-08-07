// Integration coverage for the team tag (punchlist #4 tier 1): groupTag on
// POST /api/rounds and the team aggregation on GET /api/leaderboard?by=team.
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
let courseId;

// All 18 holes entered at `strokes` each.
const fullCard = (strokes) => Array(18).fill(strokes);

function postRound(body) {
  return fetch(`${baseUrl}/api/rounds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const round = (over = {}) => ({
  clientId: `team-${Date.now()}-${Math.random()}`,
  courseId,
  playerTags: ["AAA", "BBB"],
  groupTag: "TMX",
  createdAt: Date.now(),
  completedAt: Date.now(),
  scores: { 0: fullCard(2), 1: fullCard(4) },
  ...over,
});

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug, tz) values ($1, $2, 'America/Los_Angeles') returning id`,
    [`Team Venue ${stamp}`, `team-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Team Test Course", "test", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from round where course_id = $1`, [courseId]);
  await testQuery(`delete from course where id = $1`, [courseId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("POST /api/rounds rejects an invalid or blocked groupTag, accepts a valid or absent one", async () => {
  const bad = await postRound(round({ groupTag: "ab" }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /groupTag/);

  const blocked = await postRound(round({ groupTag: "FUK" }));
  assert.equal(blocked.status, 400);

  // completedAt: null keeps this fixture off the team board the next test reads.
  const ok = await postRound(round({ groupTag: "TM1", completedAt: null }));
  assert.equal(ok.status, 200);
  const { roundId } = await ok.json();
  const row = await testQuery(`select group_tag from round where id = $1`, [roundId]);
  assert.equal(row.rows[0].group_tag, "TM1");

  const none = await postRound(round({ groupTag: undefined }));
  assert.equal(none.status, 200);
  const { roundId: r2 } = await none.json();
  const row2 = await testQuery(`select group_tag from round where id = $1`, [r2]);
  assert.equal(row2.rows[0].group_tag, null);
});

test("GET /api/leaderboard?by=team averages per player and keeps each team's best", async () => {
  const now = Date.now();
  // TMA round 1: players at 2 and 4 strokes/hole -> avg (36+72)/2 = 54.
  await postRound(
    round({ groupTag: "TMA", completedAt: now - 60_000, scores: { 0: fullCard(2), 1: fullCard(4) } })
  );
  // TMA round 2 (worse): both at 4 -> avg 72. Best must remain 54.
  await postRound(
    round({ groupTag: "TMA", completedAt: now - 30_000, scores: { 0: fullCard(4), 1: fullCard(4) } })
  );
  // TMB: solo team at 3 -> avg 54 too, but completed later -> sorts after TMA.
  await postRound(
    round({ groupTag: "TMB", completedAt: now, playerTags: ["CCC"], scores: { 0: fullCard(3) } })
  );
  // A tagless round must not appear on the team board.
  await postRound(round({ groupTag: undefined }));

  const res = await fetch(`${baseUrl}/api/leaderboard?by=team&period=all`);
  assert.equal(res.status, 200);
  const rows = (await res.json()).filter((r) => r.courseId === courseId);
  assert.deepEqual(
    rows.map((r) => [r.tag, r.total]),
    [
      ["TMA", 54],
      ["TMB", 54],
    ]
  );

  const bad = await fetch(`${baseUrl}/api/leaderboard?by=nope`);
  assert.equal(bad.status, 400);
});

test("player board is unchanged by team rounds (regression)", async () => {
  const res = await fetch(`${baseUrl}/api/leaderboard?period=all`);
  assert.equal(res.status, 200);
  const rows = (await res.json()).filter((r) => r.courseId === courseId);
  // Best per player tag: AAA played 2s (36) in its best round. The legacy
  // player board returns SQL bigint sums as strings — coerce, don't change
  // the shipped contract.
  const aaa = rows.find((r) => r.tag === "AAA");
  assert.equal(Number(aaa.total), 36);
});
