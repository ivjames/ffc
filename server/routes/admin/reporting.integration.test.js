// Integration coverage for office reporting (punchlist #2): the overview
// trend series and the rounds CSV export.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "reporting-test-token";

const { app } = await import("../../app.js");

let baseUrl;
let close;
let locationId;
let courseId;
let roundId;

function admin(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "reporting-test-token",
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
    [`Reporting Venue ${stamp}`, `reporting-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Reporting Course", "test", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;
  // One completed two-player team round, completed now.
  const r = await testQuery(
    `insert into round (course_id, player_tags, group_tag, completed_at, client_id)
       values ($1, $2, 'TMR', now(), $3) returning id`,
    [courseId, ["RPA", "RPB"], `reporting-${stamp}`]
  );
  roundId = r.rows[0].id;
  for (const [idx, strokes] of [
    [0, 2],
    [1, 4],
  ]) {
    for (let hole = 1; hole <= 18; hole++) {
      await testQuery(
        `insert into score (round_id, player_index, hole, strokes) values ($1, $2, $3, $4)`,
        [roundId, idx, hole, strokes]
      );
    }
  }
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from round where course_id = $1`, [courseId]);
  await testQuery(`delete from course where id = $1`, [courseId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("GET /api/admin/overview/series returns zero-filled daily buckets including today's round", async () => {
  const res = await admin("/api/admin/overview/series?days=7");
  assert.equal(res.status, 200);
  const { days, series } = await res.json();
  assert.equal(days, 7);
  assert.equal(series.length, 7);
  for (const bucket of series) {
    assert.match(bucket.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof bucket.rounds, "number");
    assert.equal(typeof bucket.players, "number");
    assert.equal(typeof bucket.huntFinds, "number");
  }
  // Dates ascend and end today (in the admin zone — allow yesterday to avoid
  // a midnight-boundary flake).
  const dates = series.map((b) => b.date);
  assert.deepEqual(dates, [...dates].sort());
  const last = series[series.length - 1];
  assert.ok(last.rounds >= 1, "the seeded round lands in the last bucket");
  assert.ok(last.players >= 2, "both distinct tags counted");

  const bad = await admin("/api/admin/overview/series?days=1000");
  assert.equal(bad.status, 400);
});

test("GET /api/admin/export/rounds.csv streams one row per player with venue context", async () => {
  const res = await admin(`/api/admin/export/rounds.csv?locationId=${locationId}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/csv/);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="rounds_/);

  const text = await res.text();
  const lines = text.trim().split("\r\n");
  assert.equal(
    lines[0],
    "completed_at_local,location,course,course_par,round_id,team_tag,player_tag,holes_entered,total_strokes"
  );
  assert.equal(lines.length, 3, "header + one row per player");
  const rowA = lines.find((l) => l.includes("RPA"));
  const rowB = lines.find((l) => l.includes("RPB"));
  assert.ok(rowA && rowB);
  assert.match(rowA, /,TMR,RPA,18,36$/);
  assert.match(rowB, /,TMR,RPB,18,72$/);
  assert.ok(rowA.includes("Reporting Course"));

  const bad = await admin("/api/admin/export/rounds.csv?from=08-01-2026");
  assert.equal(bad.status, 400);

  const anon = await fetch(`${baseUrl}/api/admin/export/rounds.csv`);
  assert.equal(anon.status, 401);
});
