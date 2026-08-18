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

function postRound(body, cookie) {
  return fetch(`${baseUrl}/api/rounds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** A signed-in player. Grand Hunter is scoped to the ACCOUNT that owns the
 *  rounds — a 3-char tag is a display label, not a person — so the badge needs
 *  a real session behind the syncs. */
async function signedIn() {
  const { createUserSession } = await import("../lib/userAuth.js");
  const user = await testQuery(
    `insert into app_user (email) values ($1) returning id`,
    [`hunter-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`]
  );
  const { token } = await createUserSession(user.rows[0].id);
  return `ffc_session=${token}`;
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
    grants.map((g) => [g.playerTag, g.achievement]),
    [
      ["UPR", "under_par"],
      ["HIO", "hole_in_one"],
    ]
  );
  // Achievements are badges — they pay nothing. The row carries no redemption
  // code and no payout/claim state for the player to act on.
  assert.ok(
    grants.every(
      (g) =>
        !("code" in g) &&
        !("redeemedAt" in g) &&
        !("ticketsAwarded" in g)
    ),
    "GET /api/rewards exposes no payout or redemption state"
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
  const mine = grants.filter((g) => g.playerTag === "HNT").map((g) => g.achievement).sort();
  // Covering the list earns Hunt Master, and the badges that ride on a clean
  // completed hunt: nothing was rejected (naturalist) and nothing was flagged
  // by anti-cheat (above_board), plus the first verified find.
  assert.deepEqual(mine, ["above_board", "first_find", "hunt_master", "naturalist"]);
  // NOP found only one of the two items — no hunt_master, and none of the
  // badges that require a completed hunt.
  const theirs = grants.filter((g) => g.playerTag === "NOP").map((g) => g.achievement).sort();
  assert.deepEqual(theirs, ["first_find"]);
  // Grand Hunter is NOT granted: this venue has a single course, where it would
  // mean exactly what Hunt Master already means.
  assert.ok(!grants.some((g) => g.achievement === "grand_hunter"));
});


test("multitasker and grand hunter — the two composed in the grant path", async () => {
  // A venue with TWO courses, so "every course's hunt" is a real bar.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Hunt Venue ${stamp}`, `hunt-${stamp}`]
  );
  const venue = loc.rows[0].id;
  const mkCourse = async (name) =>
    (
      await testQuery(
        `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
        [name, "test", Array(18).fill(3), venue]
      )
    ).rows[0].id;
  const courseA = await mkCourse(`A ${stamp}`);
  const courseB = await mkCourse(`B ${stamp}`);
  const mkItem = async (courseId, slug) =>
    (
      await testQuery(
        `insert into hunt_item (course_id, slug, name) values ($1, $2, $3) returning id`,
        [courseId, slug, slug]
      )
    ).rows[0].id;
  const itemA = await mkItem(courseA, `a-${stamp}`);
  const itemB = await mkItem(courseB, `b-${stamp}`);

  const cookie = await signedIn();
  const playHunt = async (courseId, itemId, strokes) => {
    const clientId = `hunt-${courseId}-${stamp}`;
    await testQuery(
      `insert into hunt_find (round_client_id, player_tag, item_id, verified) values ($1, 'GHT', $2, true)`,
      [clientId, itemId]
    );
    await postRound(
      {
        clientId,
        courseId,
        playerTags: ["GHT"],
        createdAt: Date.now(),
        completedAt: Date.now(),
        scores: { 0: Array(18).fill(strokes) },
      },
      cookie
    );
    return (await (await fetch(`${baseUrl}/api/rewards?clientId=${clientId}`)).json())
      .map((g) => g.achievement)
      .sort();
  };

  // Course A, carding 2s: under par (36 < 54) AND the hunt done — multitasker.
  const first = await playHunt(courseA, itemA, 2);
  assert.ok(first.includes("hunt_master"));
  assert.ok(first.includes("under_par"));
  assert.ok(first.includes("multitasker"), "hunt + under par in one round");
  // Only one of the venue's two courses is done, so not yet Grand Hunter.
  assert.ok(!first.includes("grand_hunter"));

  // Course B at par: the venue is now complete.
  const second = await playHunt(courseB, itemB, 3);
  assert.ok(second.includes("grand_hunter"), "every course at the venue hunted");
  // Par is not under par, so this round is not a multitasker.
  assert.ok(!second.includes("multitasker"));
});


test("grand hunter is scoped to the account, not a reusable 3-char tag", async () => {
  // Two venues' worth of setup, but the point is identity: a second guest who
  // happens to pick the same tag must not inherit the first one's progress.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Tag Venue ${stamp}`, `tag-${stamp}`]
  );
  const venue = loc.rows[0].id;
  const mkCourse = async (n) =>
    (
      await testQuery(
        `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
        [`${n} ${stamp}`, "test", Array(18).fill(3), venue]
      )
    ).rows[0].id;
  const courseA = await mkCourse("TA");
  const courseB = await mkCourse("TB");
  const mkItem = async (courseId, slug) =>
    (
      await testQuery(
        `insert into hunt_item (course_id, slug, name) values ($1, $2, $3) returning id`,
        [courseId, slug, slug]
      )
    ).rows[0].id;
  const itemA = await mkItem(courseA, `ta-${stamp}`);
  const itemB = await mkItem(courseB, `tb-${stamp}`);

  const play = async (who, courseId, itemId, suffix) => {
    const clientId = `tag-${courseId}-${suffix}-${stamp}`;
    await testQuery(
      `insert into hunt_find (round_client_id, player_tag, item_id, verified) values ($1, 'SAM', $2, true)`,
      [clientId, itemId]
    );
    await postRound(
      {
        clientId,
        courseId,
        playerTags: ["SAM"],
        createdAt: Date.now(),
        completedAt: Date.now(),
        scores: { 0: Array(18).fill(3) },
      },
      who
    );
    return (await (await fetch(`${baseUrl}/api/rewards?clientId=${clientId}`)).json())
      .map((g) => g.achievement);
  };

  const alice = await signedIn();
  const bob = await signedIn();
  await play(alice, courseA, itemA, "alice");
  // Bob shares the tag "SAM" and finishes the OTHER course. Under a tag-scoped
  // rule he'd inherit Alice's course and take Grand Hunter on his first visit.
  const bobsSecond = await play(bob, courseB, itemB, "bob");
  assert.ok(!bobsSecond.includes("grand_hunter"), "another guest's history is not yours");
  // Alice finishing the second course herself does earn it.
  const alicesSecond = await play(alice, courseB, itemB, "alice2");
  assert.ok(alicesSecond.includes("grand_hunter"));
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

    // Per-day/venue drilldown for THIS venue: one row per achievement earned.
    // Issuance only — achievements pay nothing, so there is no banked/pending/
    // ticket state to report.
    const mine = summary.rows.filter((r) => r.locationId === sLoc);
    const byAch = Object.fromEntries(mine.map((r) => [r.achievement, r]));
    assert.equal(byAch.under_par.granted, 1);
    assert.equal(byAch.under_par.locationName, `Summary Venue ${stamp}`);
    assert.equal(byAch.hole_in_one.granted, 1);
    for (const row of mine) {
      assert.ok(
        !("cardClaims" in row) && !("pending" in row) && !("tickets" in row),
        "the rollup reports no payout state"
      );
    }

    // Global per-achievement totals include (at least) these grants.
    const totals = Object.fromEntries(summary.byAchievement.map((a) => [a.achievement, a]));
    assert.ok(totals.under_par.granted >= 1);
    assert.ok(totals.hole_in_one.granted >= 1);
    assert.ok(
      !("unclaimed" in totals.under_par) && !("tickets" in totals.under_par),
      "per-achievement totals report no payout state"
    );

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

