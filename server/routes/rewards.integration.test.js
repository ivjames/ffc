// Integration coverage for rewards (punchlist #8 tier 1): server-side grants
// on round completion, the player-facing GET /api/rewards, and the Master
// Control redemption flow.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "rewards-test-token";

const { app } = await import("../app.js");

let baseUrl;
let close;
let locationId;
let courseId; // pars all 3 -> course par 54

function postRound(body) {
  return fetch(`${baseUrl}/api/rounds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function admin(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "rewards-test-token",
      ...opts.headers,
    },
  });
}

const round = (over = {}) => ({
  clientId: `rw-${Date.now()}-${Math.random()}`,
  courseId,
  playerTags: ["ACE"],
  createdAt: Date.now(),
  completedAt: Date.now(),
  scores: { 0: Array(18).fill(3) },
  ...over,
});

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Rewards Venue ${stamp}`, `rewards-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Rewards Test Course", "test", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(
    `delete from admin_audit where entity = 'reward' and entity_id in
       (select g.id from reward_grant g join round r on r.id = g.round_id where r.course_id = $1)`,
    [courseId]
  );
  await testQuery(`delete from hunt_find where item_id in (select id from hunt_item where course_id = $1)`, [courseId]);
  await testQuery(`delete from hunt_item where course_id = $1`, [courseId]);
  await testQuery(`delete from round where course_id = $1`, [courseId]); // cascades score + reward_grant
  await testQuery(`delete from course where id = $1`, [courseId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("a par round earns nothing; an under-par full card and a hole-in-one earn grants", async () => {
  // Par round: all 3s on a par-54 course -> no grants.
  const par = round();
  await postRound(par);
  const none = await (await fetch(`${baseUrl}/api/rewards?clientId=${par.clientId}`)).json();
  assert.deepEqual(none, []);

  // Player 0: all 2s (36 < 54, includes no aces) -> under_par only.
  // Player 1: one ace but a partial card -> hole_in_one only (no under_par on
  // a partial card even though 1 < 54).
  const body = round({
    playerTags: ["UPR", "HIO"],
    scores: { 0: Array(18).fill(2), 1: [1, ...Array(17).fill(null)] },
  });
  await postRound(body);
  const grants = await (await fetch(`${baseUrl}/api/rewards?clientId=${body.clientId}`)).json();
  assert.deepEqual(
    grants.map((g) => [g.playerTag, g.achievement, g.redeemedAt]),
    [
      ["UPR", "under_par", null],
      ["HIO", "hole_in_one", null],
    ]
  );
  // Tickets on the loyalty card are the only payout: the grant carries no
  // redemption code (the column is gone) and the player GET exposes none.
  assert.ok(
    grants.every((g) => !("code" in g)),
    "GET /api/rewards never exposes a code to the player"
  );
});

test("an in-progress sync earns nothing; a re-sync never double-grants", async () => {
  const body = round({ completedAt: null, scores: { 0: [1, ...Array(17).fill(null)] } });
  await postRound(body);
  const none = await (await fetch(`${baseUrl}/api/rewards?clientId=${body.clientId}`)).json();
  assert.deepEqual(none, [], "no grants for an incomplete round");

  // Ace on hole 1 but over par overall (1 + 16×3 + 6 = 55 > 54), so the ace is
  // the only grant.
  const done = round({ scores: { 0: [1, ...Array(16).fill(3), 6] } });
  await postRound(done);
  await postRound(done); // idempotent re-sync
  const grants = await (await fetch(`${baseUrl}/api/rewards?clientId=${done.clientId}`)).json();
  assert.equal(grants.length, 1);
  assert.equal(grants[0].achievement, "hole_in_one");
});

test("hunt master: verified finds covering the course's full list earn the grant", async () => {
  // Two active non-countable items + one countable (which must NOT count
  // toward completion) on this course.
  const itemA = await testQuery(
    `insert into hunt_item (course_id, slug, name) values ($1, 'item-a', 'Item A') returning id`,
    [courseId]
  );
  const itemB = await testQuery(
    `insert into hunt_item (course_id, slug, name) values ($1, 'item-b', 'Item B') returning id`,
    [courseId]
  );
  await testQuery(
    `insert into hunt_item (course_id, slug, name, countable) values ($1, 'item-c', 'Item C', true)`,
    [courseId]
  );

  const body = round({ playerTags: ["HNT", "NOP"] });
  // HNT found both items; NOP found only one.
  for (const [tag, items] of [
    ["HNT", [itemA, itemB]],
    ["NOP", [itemA]],
  ]) {
    for (const item of items) {
      await testQuery(
        `insert into hunt_find (round_client_id, player_tag, item_id, verified) values ($1, $2, $3, true)`,
        [body.clientId, tag, item.rows[0].id]
      );
    }
  }
  await postRound(body);
  const grants = await (await fetch(`${baseUrl}/api/rewards?clientId=${body.clientId}`)).json();
  assert.deepEqual(
    grants.map((g) => [g.playerTag, g.achievement]),
    [["HNT", "hunt_master"]]
  );
});


test("admin summary rolls up achievement issuance per venue + achievement", async () => {
  // A dedicated venue so the per-location rows are isolated from the other
  // tests' grants (the global byAchievement totals are not).
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Summary Venue ${stamp}`, `summary-${stamp}`]
  );
  const sLoc = loc.rows[0].id;
  const crs = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Summary Course", "test", Array(18).fill(3), sLoc]
  );
  const sCourse = crs.rows[0].id;
  const sRound = (over) => ({
    clientId: `sum-${Date.now()}-${Math.random()}`,
    courseId: sCourse,
    createdAt: Date.now(),
    completedAt: Date.now(),
    ...over,
  });
  try {
    // under_par (all 2s = 36 < 54, no ace) and hole_in_one (ace but 55 > 54).
    await postRound(sRound({ playerTags: ["UPR"], scores: { 0: Array(18).fill(2) } }));
    await postRound(
      sRound({ playerTags: ["HIO"], scores: { 0: [1, ...Array(16).fill(3), 6] } })
    );

    const summary = await (await admin(`/api/admin/rewards/summary`)).json();
    assert.equal(summary.days, 30);

    // Per-day/venue drilldown for THIS venue: one row per achievement, freshly
    // earned so nothing is banked to a card yet.
    const mine = summary.rows.filter((r) => r.locationId === sLoc);
    const byAch = Object.fromEntries(mine.map((r) => [r.achievement, r]));
    assert.equal(byAch.under_par.granted, 1);
    assert.equal(byAch.under_par.cardClaims, 0);
    assert.equal(byAch.under_par.tickets, 0);
    assert.equal(byAch.under_par.locationName, `Summary Venue ${stamp}`);
    assert.equal(byAch.hole_in_one.granted, 1);
    assert.equal(byAch.hole_in_one.cardClaims, 0);

    // Global per-achievement totals include (at least) these grants.
    const totals = Object.fromEntries(summary.byAchievement.map((a) => [a.achievement, a]));
    assert.ok(totals.under_par.granted >= 1);
    assert.ok(totals.under_par.unclaimed >= 1);
    assert.ok(totals.hole_in_one.granted >= 1);

    // days is clamped to [1, 90].
    assert.equal((await (await admin(`/api/admin/rewards/summary?days=999`)).json()).days, 90);
    assert.equal((await (await admin(`/api/admin/rewards/summary?days=0`)).json()).days, 1);

    const anon = await fetch(`${baseUrl}/api/admin/rewards/summary`);
    assert.equal(anon.status, 401);
  } finally {
    await testQuery(`delete from round where course_id = $1`, [sCourse]);
    await testQuery(`delete from course where id = $1`, [sCourse]);
    await testQuery(`delete from location where id = $1`, [sLoc]);
  }
});
