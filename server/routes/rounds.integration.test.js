// Integration coverage for POST /api/rounds — idempotent round sync.
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

const validBody = () => ({
  clientId: `client-${Date.now()}-${Math.random()}`,
  courseId,
  playerTags: ["ABC"],
  createdAt: Date.now(),
  completedAt: Date.now(),
  scores: { 0: [3, 2, null, 4, ...Array(14).fill(null)] },
});

function postRound(body) {
  return fetch(`${baseUrl}/api/rounds`, {
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
    [`Rounds Test Venue ${stamp}`, `rounds-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Rounds Test Course", "test", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from round where course_id = $1`, [courseId]); // cascades score
  await testQuery(`delete from course where id = $1`, [courseId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("POST /api/rounds validates each required field", async () => {
  const cases = [
    { override: { clientId: "" }, match: /clientId is required/ },
    { override: { courseId: "not-a-uuid" }, match: /courseId must be a uuid/ },
    { override: { playerTags: [] }, match: /playerTags/ },
    { override: { playerTags: ["FUK"] }, match: /invalid or blocked tag/ },
    { override: { createdAt: "nope" }, match: /createdAt must be a ms-epoch number/ },
    { override: { completedAt: "nope" }, match: /completedAt must be a ms-epoch number or null/ },
    { override: { scores: "nope" }, match: /scores must be an object/ },
    {
      override: { scores: { 5: Array(18).fill(null) } },
      match: /scores has invalid player index/,
    },
    { override: { scores: { 0: [1, 2] } }, match: /must be an array of length 18/ },
    {
      override: { scores: { 0: [0, ...Array(17).fill(null)] } },
      match: /must be an integer >= 1 or null/,
    },
  ];
  for (const { override, match } of cases) {
    const res = await postRound({ ...validBody(), ...override });
    assert.equal(res.status, 400, `case ${JSON.stringify(override)}`);
    const body = await res.json();
    assert.match(body.error, match, `case ${JSON.stringify(override)}`);
  }
});

test("POST /api/rounds 400s when courseId doesn't exist", async () => {
  const res = await postRound({
    ...validBody(),
    courseId: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /courseId does not exist/);
});

test("POST /api/rounds creates a round and only inserts non-null holes", async () => {
  const body = {
    ...validBody(),
    playerTags: ["ABC", "XYZ"],
    scores: {
      0: [3, 2, null, ...Array(15).fill(null)],
      1: [4, null, 5, ...Array(15).fill(null)],
    },
  };
  const res = await postRound(body);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(json.roundId);

  const round = await testQuery(`select player_tags, completed_at from round where id = $1`, [
    json.roundId,
  ]);
  assert.deepEqual(round.rows[0].player_tags, ["ABC", "XYZ"]);
  assert.ok(round.rows[0].completed_at);

  const scores = await testQuery(
    `select player_index, hole, strokes from score where round_id = $1 order by player_index, hole`,
    [json.roundId]
  );
  assert.deepEqual(
    scores.rows.map((r) => [r.player_index, r.hole, r.strokes]),
    [
      [0, 1, 3],
      [0, 2, 2],
      [1, 1, 4],
      [1, 3, 5],
    ]
  );
});

test("POST /api/rounds is idempotent on clientId: a re-sync returns the same round and never touches its scores", async () => {
  const body = {
    ...validBody(),
    clientId: `client-idempotent-${Date.now()}`,
    scores: { 0: [3, ...Array(17).fill(null)] },
  };
  const res1 = await postRound(body);
  assert.equal(res1.status, 200);
  const { roundId } = await res1.json();

  // Re-sync with DIFFERENT scores — must be ignored; the original round wins.
  const res2 = await postRound({ ...body, scores: { 0: [9, ...Array(17).fill(null)] } });
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.roundId, roundId);

  const scores = await testQuery(
    `select strokes from score where round_id = $1 and player_index = 0 and hole = 1`,
    [roundId]
  );
  assert.equal(scores.rows[0].strokes, 3, "original score must be untouched by the re-sync");

  const roundCount = await testQuery(`select count(*)::int as n from round where id = $1`, [
    roundId,
  ]);
  assert.equal(roundCount.rows[0].n, 1);
});

test("POST /api/rounds accepts completedAt: null (an in-progress round)", async () => {
  const res = await postRound({ ...validBody(), completedAt: null });
  assert.equal(res.status, 200);
  const json = await res.json();
  const round = await testQuery(`select completed_at from round where id = $1`, [json.roundId]);
  assert.equal(round.rows[0].completed_at, null);
});

// Last on purpose: designed to trip the shared per-IP counter (30/min).
test("per-IP rate limit eventually trips 429", async () => {
  const statuses = [];
  for (let i = 0; i < 35; i++) {
    const res = await postRound({ ...validBody(), clientId: `client-rl-${i}-${Date.now()}` });
    statuses.push(res.status);
  }
  assert.ok(statuses.includes(429), `expected a 429 among ${JSON.stringify(statuses)}`);
});
