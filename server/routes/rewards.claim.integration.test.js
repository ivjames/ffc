// Integration coverage for the grant-backed golf claim (POST /api/rewards/claim)
// — redeeming an earned round achievement to a loyalty card as tickets. Unlike
// the game-rewards proxy, golf is grant-backed: the server looks up the stored
// reward_grant, derives the payout itself, and marks the grant redeemed so the
// card and the counter code are mutually exclusive. A stub CenterEdge stands in
// for the vendor so the real chain runs: grant lookup -> server value -> consume
// -> vendor credit -> idempotent replay.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "rewards-claim-test-token";

const { app } = await import("../app.js");
const { createUserSession } = await import("../lib/userAuth.js");

// Stub CenterEdge with vendor-side idempotency + a call log + a failure toggle.
const stub = { calls: [], byKey: new Map(), balance: 5000, failNext: false };
const stubApp = express();
stubApp.use(express.json());
stubApp.post("/api/v1/players/:id/tickets/reward", (req, res) => {
  stub.calls.push({ playerId: req.params.id, ...req.body });
  if (stub.failNext) {
    stub.failNext = false;
    return res.status(500).json({ ok: false, error: "stub POS down" });
  }
  const prior = stub.byKey.get(req.body.idempotencyKey);
  if (prior) return res.json({ ...prior, duplicate: true });
  stub.balance += req.body.tickets;
  const response = {
    ok: true,
    transactionId: `tx-${stub.calls.length}`,
    playerId: req.params.id,
    ticketsAwarded: req.body.tickets,
    newTicketBalance: stub.balance,
    duplicate: false,
  };
  stub.byKey.set(req.body.idempotencyKey, response);
  res.json(response);
});

let baseUrl;
let close;
let stubClose;
let locationId; // gameRewards on
let noRewardsLocationId; // loyalty on, gameRewards off
const locationIds = [];
let seq = 0;

// Claiming banks tickets onto a card, so it is signed-in only and the card is
// the caller's own binding at the round's venue — the round's clientId says
// WHICH grant, never whose card gets paid.
function claim(body, cookie) {
  return fetch(`${baseUrl}/api/rewards/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

let holderSeq = 0;
const holderEmails = [];
/** A signed-in player holding `card` at `loc`. Returns its cookie. */
async function cardHolder(loc, card) {
  const email = `claim-${Date.now()}-${holderSeq++}@example.com`;
  holderEmails.push(email);
  const row = await testQuery(
    `insert into app_user (email, email_verified_at) values ($1, now()) returning id`,
    [email]
  );
  const userId = row.rows[0].id;
  if (loc && card) {
    await testQuery(
      `insert into user_card_link (app_user_id, location_id, card_player_id) values ($1, $2, $3)`,
      [userId, loc, card]
    );
  }
  const { token } = await createUserSession(userId);
  return `ffc_session=${token}`;
}

async function makeLocation(slug, pos) {
  const row = await testQuery(
    `insert into location (name, slug, tz, pos) values ($1, $2, 'UTC', $3::jsonb) returning id`,
    [`Claim ${slug}`, `claim-${slug}`, JSON.stringify(pos)]
  );
  locationIds.push(row.rows[0].id);
  return row.rows[0].id;
}

/** Create a round at `loc` with one reward_grant, returns {clientId, grantId}. */
async function makeGrant(loc, achievement, playerIndex = 0) {
  const n = seq++;
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id)
     values ($1, 'blue', $2, $3) returning id`,
    [`Course ${n}`, `{${Array(18).fill(3).join(",")}}`, loc]
  );
  const clientId = `claim-round-${Date.now()}-${n}`;
  const round = await testQuery(
    `insert into round (course_id, player_tags, client_id, completed_at)
     values ($1, '{MPS,AAA}', $2, now()) returning id`,
    [course.rows[0].id, clientId]
  );
  const grant = await testQuery(
    `insert into reward_grant (round_id, player_index, player_tag, achievement)
     values ($1, $2, 'MPS', $3) returning id`,
    [round.rows[0].id, playerIndex, achievement]
  );
  return { clientId, grantId: grant.rows[0].id };
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const ceStub = await listenEphemeral(stubApp);
  stubClose = ceStub.close;
  process.env.CENTEREDGE_API_BASE = ceStub.baseUrl;

  const loyalty = { vendor: "centeredge", apiBase: "http://127.0.0.1:9", gameRewards: true };
  locationId = await makeLocation(`on-${Date.now()}`, { ordering: null, loyalty });
  noRewardsLocationId = await makeLocation(`off-${Date.now()}`, {
    ordering: null,
    loyalty: { ...loyalty, gameRewards: false },
  });
});

after(async () => {
  if (close) await close();
  if (stubClose) await stubClose();
  // Tear down in FK order: rounds (reward_grant cascades) -> courses -> location.
  await testQuery(
    `delete from round where course_id in (select id from course where location_id = any($1::uuid[]))`,
    [locationIds]
  );
  await testQuery(`delete from course where location_id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from app_user where email = any($1::text[])`, [holderEmails]);
});

test("rejects malformed requests", async () => {
  const { clientId } = await makeGrant(locationId, "hole_in_one");
  const cookie = await cardHolder(locationId, "PL-1");
  const bad = [
    [{ clientId: "", playerIndex: 0, achievement: "hole_in_one" }, /clientId/],
    [{ clientId, playerIndex: 9, achievement: "hole_in_one" }, /playerIndex/],
    [{ clientId, playerIndex: 0, achievement: "bogus" }, /unknown achievement/],
  ];
  for (const [body, msg] of bad) {
    const res = await claim(body, cookie);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, msg);
  }
});

test("a leaked round id can't redirect the reward to someone else's card", async () => {
  const { clientId } = await makeGrant(locationId, "hole_in_one");
  // Anonymous: the round id alone buys nothing any more.
  assert.equal(
    (await claim({ clientId, playerIndex: 0, achievement: "hole_in_one" })).status,
    401
  );
  // Signed in but cardless: nothing to credit, and the grant stays unclaimed.
  const cardless = await cardHolder(null, null);
  const res = await claim({ clientId, playerIndex: 0, achievement: "hole_in_one" }, cardless);
  assert.equal(res.status, 409);
  const g = await testQuery(
    `select redeemed_at ra from reward_grant g join round r on r.id = g.round_id
      where r.client_id = $1`,
    [clientId]
  );
  assert.equal(g.rows[0].ra, null);
});

test("no grant for the round/player/achievement -> 404 (can't mint without one)", async () => {
  const cookie = await cardHolder(locationId, "PL-1");
  const res = await claim(
    { clientId: "does-not-exist", playerIndex: 0, achievement: "hole_in_one" },
    cookie
  );
  assert.equal(res.status, 404);
});

test("credits the SERVER-derived value once and is idempotent on replay", async () => {
  const { clientId } = await makeGrant(locationId, "hole_in_one");
  const before = stub.calls.length;

  const cookie = await cardHolder(locationId, "PL-1001");
  const r1 = await claim({ clientId, playerIndex: 0, achievement: "hole_in_one" }, cookie);
  assert.equal(r1.status, 200);
  const b1 = await r1.json();
  assert.equal(b1.status, "awarded");
  assert.equal(b1.ticketsAwarded, 100); // hole_in_one, server-priced

  // Vendor credited exactly once, under the pre-proxy key, for the server value.
  assert.equal(stub.calls.length, before + 1);
  const call = stub.calls.at(-1);
  assert.equal(call.tickets, 100);
  assert.equal(call.idempotencyKey, `golf:${clientId}:0:hole_in_one`);

  // The grant is consumed: redeemed_at set, credited to the card.
  const g = await testQuery(
    `select redeemed_at as ra, tickets_awarded as t, pos_transaction_id as p, card_player_id as c
       from reward_grant g join round r on r.id = g.round_id where r.client_id = $1`,
    [clientId]
  );
  assert.ok(g.rows[0].ra);
  assert.equal(g.rows[0].t, 100);
  assert.equal(g.rows[0].c, "PL-1001");
  assert.ok(g.rows[0].p);

  // Replay: no second vendor credit, same answer.
  const r2 = await claim({ clientId, playerIndex: 0, achievement: "hole_in_one" }, cookie);
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).ticketsAwarded, 100);
  assert.equal(stub.calls.length, before + 1); // unchanged — settled from the row
});

test("under_par pays its own price (client can't over-pay)", async () => {
  const { clientId } = await makeGrant(locationId, "under_par");
  const cookie = await cardHolder(locationId, "PL-2");
  const res = await claim({ clientId, playerIndex: 0, achievement: "under_par" }, cookie);
  assert.equal((await res.json()).ticketsAwarded, 50);
});

test("venue without the gameRewards add-on -> 403", async () => {
  const { clientId } = await makeGrant(noRewardsLocationId, "hole_in_one");
  const cookie = await cardHolder(noRewardsLocationId, "PL-4");
  const res = await claim({ clientId, playerIndex: 0, achievement: "hole_in_one" }, cookie);
  assert.equal(res.status, 403);
});

test("golf shares one daily cap: a claim clamps to the remaining budget, then holds", async () => {
  const capLoc = await makeLocation(`cap-${Date.now()}`, {
    ordering: null,
    loyalty: {
      vendor: "centeredge",
      apiBase: "http://127.0.0.1:9",
      gameRewards: true,
      gameRewardCaps: { dailyPerCard: 120, perGame: {} },
    },
  });
  const cookie = await cardHolder(capLoc, "PL-CAP-GOLF");

  // 1) hole_in_one (100) pays in full — 20 of the 120 budget left.
  const g1 = await makeGrant(capLoc, "hole_in_one");
  const r1 = await claim({ clientId: g1.clientId, playerIndex: 0, achievement: "hole_in_one" }, cookie);
  assert.equal((await r1.json()).ticketsAwarded, 100);

  // 2) under_par (50) with only 20 left — clamped to 20 and the grant is
  //    consumed at that value (partial, like the mini-games clamp).
  const g2 = await makeGrant(capLoc, "under_par");
  const r2 = await claim({ clientId: g2.clientId, playerIndex: 0, achievement: "under_par" }, cookie);
  assert.equal((await r2.json()).ticketsAwarded, 20);
  const gg2 = await testQuery(
    `select tickets_awarded t, redeemed_at ra from reward_grant g
       join round r on r.id = g.round_id where r.client_id = $1`,
    [g2.clientId]
  );
  assert.equal(gg2.rows[0].t, 20);
  assert.ok(gg2.rows[0].ra);

  // 3) budget exhausted — daily-cap, nothing credited, and the grant is NOT
  //    consumed so the achievement stays claimable another day.
  const g3 = await makeGrant(capLoc, "under_par");
  const r3 = await claim({ clientId: g3.clientId, playerIndex: 0, achievement: "under_par" }, cookie);
  const b3 = await r3.json();
  assert.equal(b3.status, "daily-cap");
  assert.equal(b3.ticketsAwarded, 0);
  assert.equal(b3.dailyCap, 120);
  const gg3 = await testQuery(
    `select redeemed_at ra from reward_grant g
       join round r on r.id = g.round_id where r.client_id = $1`,
    [g3.clientId]
  );
  assert.equal(gg3.rows[0].ra, null);
});

test("golf and games draw down the SAME per-card daily budget", async () => {
  const capLoc = await makeLocation(`cap2-${Date.now()}`, {
    ordering: null,
    loyalty: {
      vendor: "centeredge",
      apiBase: "http://127.0.0.1:9",
      gameRewards: true,
      gameRewardCaps: { dailyPerCard: 120, perGame: {} },
    },
  });
  const cookie = await cardHolder(capLoc, "PL-CAP-SHARED");

  // Golf spends 100 of the 120 budget first.
  const g = await makeGrant(capLoc, "hole_in_one");
  const rg = await claim({ clientId: g.clientId, playerIndex: 0, achievement: "hole_in_one" }, cookie);
  assert.equal((await rg.json()).ticketsAwarded, 100);

  // A mini-game award on the same card now sees only 20 left — the game
  // endpoint counts the golf claim through the shared pool.
  const gameRes = await fetch(`${baseUrl}/api/game-rewards/award`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      locationId: capLoc,
      game: "skeeball",
      tickets: 100,
      sessionId: `cross-${Date.now()}`,
    }),
  });
  const gb = await gameRes.json();
  assert.equal(gb.ok, true);
  assert.equal(gb.ticketsAwarded, 20);
});

test("a held (vendor-failed) claim retries against the RESERVED card", async () => {
  const { clientId } = await makeGrant(locationId, "hole_in_one");
  const cookie = await cardHolder(locationId, "PL-RESERVED");
  stub.failNext = true; // first vendor credit fails → claim held, not settled
  const r1 = await claim({ clientId, playerIndex: 0, achievement: "hole_in_one" }, cookie);
  assert.equal(r1.status, 502);

  // The player re-links a DIFFERENT card, then retries: the credit must still
  // go to the card the claim reserved, not the one linked now.
  await testQuery(
    `update user_card_link set card_player_id = 'PL-OTHER'
      where location_id = $1 and card_player_id = 'PL-RESERVED'`,
    [locationId]
  );
  const r2 = await claim({ clientId, playerIndex: 0, achievement: "hole_in_one" }, cookie);
  assert.equal(r2.status, 200);
  assert.equal(stub.calls.at(-1).playerId, "PL-RESERVED");
});
