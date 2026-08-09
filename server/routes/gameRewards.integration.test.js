// Integration coverage for the game ticket award proxy (POST
// /api/game-rewards/award) — the trust boundary between mini-games and the
// venue's ticket system. A stub CenterEdge stands in for the vendor so the
// tests exercise the real chain: validation → per-round clamp → daily cap →
// ledger row → vendor credit → idempotent replay. Also covers the admin
// rollup (GET /api/admin/game-rewards/usage) those ledger rows feed.
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
process.env.APP_TOKEN = "game-rewards-test-token";

const { app } = await import("../app.js");

// --- Stub CenterEdge: /players/:id/tickets/reward with vendor-side
// idempotency, a togglable failure mode, and a call log. -------------------
const stub = {
  calls: [],
  failNext: false,
  byKey: new Map(),
  balance: 1000,
};
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
let locationId; // gameRewards on, default caps
let cappedLocationId; // per-game + daily caps configured
let noRewardsLocationId; // loyalty on, gameRewards off
const locationIds = [];

let sessionSeq = 0;
const session = () => `sess-${Date.now()}-${sessionSeq++}`;

function award(body) {
  return fetch(`${baseUrl}/api/game-rewards/award`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function makeLocation(slugStamp, pos) {
  const row = await testQuery(
    `insert into location (name, slug, tz, pos) values ($1, $2, 'UTC', $3::jsonb) returning id`,
    [`GameRewards ${slugStamp}`, `game-rewards-${slugStamp}`, JSON.stringify(pos)]
  );
  locationIds.push(row.rows[0].id);
  return row.rows[0].id;
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const ceStub = await listenEphemeral(stubApp);
  stubClose = ceStub.close;

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loyalty = (extra = {}) => ({
    ordering: null,
    loyalty: { vendor: "centeredge", apiBase: ceStub.baseUrl, gameRewards: true, ...extra },
  });
  locationId = await makeLocation(`a-${stamp}`, loyalty());
  cappedLocationId = await makeLocation(
    `b-${stamp}`,
    loyalty({ gameRewardCaps: { dailyPerCard: 30, perGame: { skeeball: 10 } } })
  );
  noRewardsLocationId = await makeLocation(`c-${stamp}`, {
    ordering: null,
    loyalty: { vendor: "centeredge", apiBase: ceStub.baseUrl, gameRewards: false },
  });
});

after(async () => {
  if (close) await close();
  if (stubClose) await stubClose();
  await testQuery(`delete from game_ticket_award where location_id = any($1::uuid[])`, [
    locationIds,
  ]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
});

test("rejects malformed requests", async () => {
  const cases = [
    [{ locationId: "nope", playerId: "PL-1", game: "skeeball", tickets: 5, sessionId: session() }, /locationId/],
    [{ locationId, playerId: "", game: "skeeball", tickets: 5, sessionId: session() }, /playerId/],
    [{ locationId, playerId: "PL-1", game: "clawmachine", tickets: 5, sessionId: session() }, /unknown game/],
    [{ locationId, playerId: "PL-1", game: "skeeball", tickets: 0, sessionId: session() }, /tickets/],
    [{ locationId, playerId: "PL-1", game: "skeeball", tickets: 2.5, sessionId: session() }, /tickets/],
    [{ locationId, playerId: "PL-1", game: "skeeball", tickets: 10_001, sessionId: session() }, /tickets/],
    [{ locationId, playerId: "PL-1", game: "skeeball", tickets: 5, sessionId: "short" }, /sessionId/],
  ];
  for (const [body, msg] of cases) {
    const res = await award(body);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, msg);
  }
});

test("gates on the venue's gameRewards add-on", async () => {
  const off = await award({
    locationId: noRewardsLocationId,
    playerId: "PL-1",
    game: "skeeball",
    tickets: 5,
    sessionId: session(),
  });
  assert.equal(off.status, 403);

  const gone = await award({
    locationId: "00000000-0000-4000-8000-000000000000",
    playerId: "PL-1",
    game: "skeeball",
    tickets: 5,
    sessionId: session(),
  });
  assert.equal(gone.status, 404);
});

test("awards, records, and credits the vendor with the game-session key", async () => {
  const sessionId = session();
  const res = await award({ locationId, playerId: "PL-100", game: "trivia", tickets: 25, sessionId });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, "awarded");
  assert.equal(json.ticketsAwarded, 25);
  assert.equal(json.capped, false);
  assert.equal(typeof json.newTicketBalance, "number");

  const call = stub.calls.at(-1);
  assert.equal(call.tickets, 25);
  assert.equal(call.source, "game:trivia");
  assert.equal(call.idempotencyKey, `game:trivia:${sessionId}`);

  const row = await testQuery(
    `select * from game_ticket_award where game = 'trivia' and session_id = $1`,
    [sessionId]
  );
  assert.equal(row.rows[0].status, "awarded");
  assert.equal(row.rows[0].tickets_awarded, 25);
  assert.ok(row.rows[0].pos_transaction_id);
});

test("clamps a forged count to the hard per-round max", async () => {
  const res = await award({
    locationId,
    playerId: "PL-101",
    game: "battingcages",
    tickets: 5000,
    sessionId: session(),
  });
  const json = await res.json();
  assert.equal(json.status, "awarded");
  assert.equal(json.ticketsAwarded, 100);
  assert.equal(json.capped, true);
});

test("venue per-game cap tightens the ceiling", async () => {
  const res = await award({
    locationId: cappedLocationId,
    playerId: "PL-102",
    game: "skeeball",
    tickets: 80,
    sessionId: session(),
  });
  const json = await res.json();
  assert.equal(json.ticketsAwarded, 10);
  assert.equal(json.capped, true);
});

test("daily per-card cap clamps then stops the card for the day", async () => {
  const playerId = "PL-103"; // cappedLocation: dailyPerCard 30
  const first = await (
    await award({ locationId: cappedLocationId, playerId, game: "trivia", tickets: 20, sessionId: session() })
  ).json();
  assert.equal(first.ticketsAwarded, 20);

  const second = await (
    await award({ locationId: cappedLocationId, playerId, game: "darts", tickets: 20, sessionId: session() })
  ).json();
  assert.equal(second.ticketsAwarded, 10); // clamped to the remaining 10
  assert.equal(second.capped, true);

  const third = await (
    await award({ locationId: cappedLocationId, playerId, game: "pinball", tickets: 20, sessionId: session() })
  ).json();
  assert.equal(third.status, "daily-cap");
  assert.equal(third.ticketsAwarded, 0);
  assert.equal(third.dailyCap, 30);

  // Another card at the same venue is unaffected.
  const other = await (
    await award({ locationId: cappedLocationId, playerId: "PL-104", game: "trivia", tickets: 20, sessionId: session() })
  ).json();
  assert.equal(other.ticketsAwarded, 20);
});

test("a replayed session settles from the ledger without re-crediting", async () => {
  const sessionId = session();
  const body = { locationId, playerId: "PL-105", game: "bowling", tickets: 40, sessionId };
  const first = await (await award(body)).json();
  assert.equal(first.ticketsAwarded, 40);

  const callsBefore = stub.calls.length;
  const replay = await (await award(body)).json();
  assert.equal(replay.status, "awarded");
  assert.equal(replay.ticketsAwarded, 40);
  assert.equal(replay.duplicate, true);
  assert.equal(stub.calls.length, callsBefore); // answered from the ledger

  // Only one ledger row, so the daily cap counted the round once.
  const rows = await testQuery(
    `select count(*)::int as n from game_ticket_award where game = 'bowling' and session_id = $1`,
    [sessionId]
  );
  assert.equal(rows.rows[0].n, 1);
});

test("a failed vendor credit releases the reservation for a clean retry", async () => {
  const sessionId = session();
  const body = { locationId, playerId: "PL-106", game: "darts", tickets: 15, sessionId };

  stub.failNext = true;
  const failed = await award(body);
  assert.equal(failed.status, 502);
  const gone = await testQuery(
    `select count(*)::int as n from game_ticket_award where game = 'darts' and session_id = $1`,
    [sessionId]
  );
  assert.equal(gone.rows[0].n, 0); // budget released

  const retry = await (await award(body)).json();
  assert.equal(retry.status, "awarded");
  assert.equal(retry.ticketsAwarded, 15);
});

test("admin usage rollup reports issuance and the daily-cap hits", async () => {
  const res = await fetch(`${baseUrl}/api/admin/game-rewards/usage?days=7`, {
    headers: { "x-app-token": "game-rewards-test-token" },
  });
  assert.equal(res.status, 200);
  const json = await res.json();

  const capped = json.rows.filter((r) => r.locationId === cappedLocationId);
  assert.ok(capped.length > 0);
  const pinball = capped.find((r) => r.game === "pinball");
  assert.equal(pinball.cappedRounds, 1); // PL-103's blocked round
  assert.equal(pinball.tickets, 0);

  const top = json.topCards.find((c) => c.playerId === "PL-103");
  assert.equal(top.tickets, 30); // exactly the daily cap

  const meta = await fetch(`${baseUrl}/api/admin/game-rewards/meta`, {
    headers: { "x-app-token": "game-rewards-test-token" },
  });
  const metaJson = await meta.json();
  assert.equal(metaJson.hardMaxPerRound, 100);
  assert.ok(metaJson.games.some((g) => g.key === "skeeball"));
  assert.ok(!metaJson.games.some((g) => g.key === "clawmachine")); // chance games never earn
});
