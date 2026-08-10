// Integration coverage for synthetic (bot) rounds on POST /api/rounds:
//   - the x-synthetic-key guard (feature off / wrong key / authorised),
//   - the round.synthetic column is persisted,
//   - SYNTHETIC_MINT_REWARDS gates whether a synthetic round mints grants,
//   - SYNTHETIC_COUNT_ON_BOARD gates whether it appears on the leaderboard,
//   - real rounds are never affected by any of the above.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SYNTHETIC_BOT_KEY = "test-bot-key"; // feature enabled for this file

const { app } = await import("../app.js");

let baseUrl;
let close;
let locationId;
let courseId;

// A round with a hole-in-one (stroke of 1) → guaranteed a reward grant.
const aceBody = (overrides = {}) => ({
  clientId: `syn-${Date.now()}-${Math.random()}`,
  courseId,
  playerTags: ["BOT"],
  createdAt: Date.now(),
  completedAt: Date.now(),
  scores: { 0: [1, ...Array(17).fill(3)] },
  ...overrides,
});

function postRound(body, headers = {}) {
  return fetch(`${baseUrl}/api/rounds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const grantCount = async (roundId) =>
  Number(
    (await testQuery(`select count(*)::int as n from reward_grant where round_id = $1`, [roundId]))
      .rows[0].n
  );

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Synthetic Venue ${stamp}`, `syn-${stamp}`]
  );
  locationId = loc.rows[0].id;
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Synthetic Course", "test", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;
});

after(async () => {
  if (close) await close();
  // This file creates more than one course under the venue (board isolation),
  // so tear down by location: rounds → courses → location.
  await testQuery(
    `delete from round where course_id in (select id from course where location_id = $1)`,
    [locationId]
  ); // cascades score + reward_grant
  await testQuery(`delete from course where location_id = $1`, [locationId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("synthetic:true is rejected without the key (403)", async () => {
  const res = await postRound(aceBody({ synthetic: true }));
  assert.equal(res.status, 403);
  const j = await res.json();
  assert.match(j.error, /x-synthetic-key/);
});

test("synthetic:true is rejected with the WRONG key (403)", async () => {
  const res = await postRound(aceBody({ synthetic: true }), { "x-synthetic-key": "nope" });
  assert.equal(res.status, 403);
});

test("a normal round is stored synthetic=false", async () => {
  const res = await postRound(aceBody());
  assert.equal(res.status, 200);
  const { roundId } = await res.json();
  const row = await testQuery(`select synthetic from round where id = $1`, [roundId]);
  assert.equal(row.rows[0].synthetic, false);
});

test("authorised synthetic round is stored synthetic=true", async () => {
  const res = await postRound(aceBody({ synthetic: true }), {
    "x-synthetic-key": "test-bot-key",
  });
  assert.equal(res.status, 200);
  const { roundId } = await res.json();
  const row = await testQuery(`select synthetic from round where id = $1`, [roundId]);
  assert.equal(row.rows[0].synthetic, true);
});

test("SYNTHETIC_MINT_REWARDS default (on): synthetic round mints grants", async () => {
  const res = await postRound(aceBody({ synthetic: true }), {
    "x-synthetic-key": "test-bot-key",
  });
  const { roundId } = await res.json();
  assert.ok((await grantCount(roundId)) > 0, "expected a hole-in-one grant");
});

test("SYNTHETIC_MINT_REWARDS=false: synthetic mints nothing, real still mints", async () => {
  const prev = process.env.SYNTHETIC_MINT_REWARDS;
  process.env.SYNTHETIC_MINT_REWARDS = "false";
  try {
    const synRes = await postRound(aceBody({ synthetic: true }), {
      "x-synthetic-key": "test-bot-key",
    });
    const { roundId: synId } = await synRes.json();
    assert.equal(await grantCount(synId), 0, "synthetic round must not mint when flag off");

    const realRes = await postRound(aceBody()); // real round, same ace
    const { roundId: realId } = await realRes.json();
    assert.ok((await grantCount(realId)) > 0, "real round must still mint");
  } finally {
    if (prev === undefined) delete process.env.SYNTHETIC_MINT_REWARDS;
    else process.env.SYNTHETIC_MINT_REWARDS = prev;
  }
});

// Board isolation: a dedicated course whose ONLY round is synthetic, so the
// board flag is the only thing that can make its tag appear or disappear.
let boardCourseId;
const BOARD_TAG = "BZZ";

async function tagOnBoard() {
  const res = await fetch(
    `${baseUrl}/api/leaderboard?period=all&by=player&locationId=${locationId}`
  );
  const rows = await res.json();
  return rows.some((r) => r.courseId === boardCourseId && r.tag === BOARD_TAG);
}

test("SYNTHETIC_COUNT_ON_BOARD gates board visibility for a synthetic-only course", async () => {
  const c = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1,$2,$3,$4) returning id`,
    ["Synthetic Board Course", "test", Array(18).fill(3), locationId]
  );
  boardCourseId = c.rows[0].id;

  // One synthetic round, tag BZZ, on this course only.
  const res = await postRound(
    aceBody({ synthetic: true, courseId: boardCourseId, playerTags: [BOARD_TAG] }),
    { "x-synthetic-key": "test-bot-key" }
  );
  assert.equal(res.status, 200);

  // Default (flag on): visible.
  assert.equal(await tagOnBoard(), true, "synthetic round should count by default");

  // Flag off: hidden.
  const prev = process.env.SYNTHETIC_COUNT_ON_BOARD;
  process.env.SYNTHETIC_COUNT_ON_BOARD = "false";
  try {
    assert.equal(await tagOnBoard(), false, "synthetic round should be excluded when flag off");
  } finally {
    if (prev === undefined) delete process.env.SYNTHETIC_COUNT_ON_BOARD;
    else process.env.SYNTHETIC_COUNT_ON_BOARD = prev;
  }
});
