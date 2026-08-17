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
const { createUserSession } = await import("../lib/userAuth.js");

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

// Awards are signed-in only, and the card credited is the one bound to the
// caller's account at that venue — never a card id in the body. `cardHolder`
// below mints a user with a given card linked, and every award rides its
// cookie. A test that needs two different cards at one venue needs two users:
// the (user, location) binding is unique.
function award(body, cookie) {
  return fetch(`${baseUrl}/api/game-rewards/award`, {
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
/** A signed-in player holding `cardPlayerId` at `loc`. Returns its cookie. */
async function cardHolder(loc, cardPlayerId) {
  const email = `game-rewards-${Date.now()}-${holderSeq++}@example.com`;
  holderEmails.push(email);
  const row = await testQuery(
    `insert into app_user (email, email_verified_at) values ($1, now()) returning id`,
    [email]
  );
  const userId = row.rows[0].id;
  if (loc && cardPlayerId) {
    await testQuery(
      `insert into user_card_link (app_user_id, location_id, card_player_id) values ($1, $2, $3)`,
      [userId, loc, cardPlayerId]
    );
  }
  const { token } = await createUserSession(userId);
  return `ffc_session=${token}`;
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

  // The server-side credit path deliberately IGNORES the venue-set apiBase
  // (org_admin-writable — honoring it would let a venue exfiltrate the
  // credential); it uses trusted env config only. Point env at the stub and
  // give every venue a dead apiBase to prove awards never follow it.
  process.env.CENTEREDGE_API_BASE = ceStub.baseUrl;

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loyalty = (extra = {}) => ({
    ordering: null,
    loyalty: { vendor: "centeredge", apiBase: "http://127.0.0.1:9", gameRewards: true, ...extra },
  });
  locationId = await makeLocation(`a-${stamp}`, loyalty());
  cappedLocationId = await makeLocation(
    `b-${stamp}`,
    loyalty({ gameRewardCaps: { dailyPerCard: 30, perGame: { skeeball: 10 } } })
  );
  noRewardsLocationId = await makeLocation(`c-${stamp}`, {
    ordering: null,
    loyalty: { vendor: "centeredge", apiBase: "http://127.0.0.1:9", gameRewards: false },
  });
});

after(async () => {
  if (close) await close();
  if (stubClose) await stubClose();
  await testQuery(`delete from game_ticket_award where location_id = any($1::uuid[])`, [
    locationIds,
  ]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from app_user where email = any($1::text[])`, [holderEmails]);
});

test("rejects malformed requests", async () => {
  const cookie = await cardHolder(locationId, "PL-1");
  const cases = [
    [{ locationId: "nope", game: "skeeball", tickets: 5, sessionId: session() }, /locationId/],
    [{ locationId, game: "coinpusher", tickets: 5, sessionId: session() }, /unknown game/],
    [{ locationId, game: "skeeball", tickets: 0, sessionId: session() }, /tickets/],
    [{ locationId, game: "skeeball", tickets: 2.5, sessionId: session() }, /tickets/],
    [{ locationId, game: "skeeball", tickets: 10_001, sessionId: session() }, /tickets/],
    [{ locationId, game: "skeeball", tickets: 5, sessionId: "short" }, /sessionId/],
  ];
  for (const [body, msg] of cases) {
    const res = await award(body, cookie);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, msg);
  }
});

test("an anonymous caller cannot credit any card", async () => {
  const res = await award({ locationId, game: "skeeball", tickets: 5, sessionId: session() });
  assert.equal(res.status, 401);
});

test("a signed-in player with no linked card has nothing to credit", async () => {
  const cookie = await cardHolder(null, null);
  const res = await award(
    { locationId, game: "skeeball", tickets: 5, sessionId: session() },
    cookie
  );
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /no rewards card linked/);
});

test("gates on the venue's gameRewards add-on", async () => {
  const offCookie = await cardHolder(noRewardsLocationId, "PL-1");
  const off = await award(
    { locationId: noRewardsLocationId, game: "skeeball", tickets: 5, sessionId: session() },
    offCookie
  );
  assert.equal(off.status, 403);

  const gone = await award(
    {
      locationId: "00000000-0000-4000-8000-000000000000",
      game: "skeeball",
      tickets: 5,
      sessionId: session(),
    },
    offCookie
  );
  assert.equal(gone.status, 404);
});

test("awards, records, and credits the vendor with the game-session key", async () => {
  const sessionId = session();
  const cookie = await cardHolder(locationId, "PL-100");
  const res = await award({ locationId, game: "trivia", tickets: 25, sessionId }, cookie);
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
  const cookie = await cardHolder(locationId, "PL-101");
  const res = await award(
    { locationId, game: "battingcages", tickets: 5000, sessionId: session() },
    cookie
  );
  const json = await res.json();
  assert.equal(json.status, "awarded");
  assert.equal(json.ticketsAwarded, 100);
  assert.equal(json.capped, true);
});

test("venue per-game cap tightens the ceiling", async () => {
  const cookie = await cardHolder(cappedLocationId, "PL-102");
  const res = await award(
    { locationId: cappedLocationId, game: "skeeball", tickets: 80, sessionId: session() },
    cookie
  );
  const json = await res.json();
  assert.equal(json.ticketsAwarded, 10);
  assert.equal(json.capped, true);
});

test("daily per-card cap clamps then stops the card for the day", async () => {
  const cookie = await cardHolder(cappedLocationId, "PL-103"); // dailyPerCard 30
  const first = await (
    await award({ locationId: cappedLocationId, game: "trivia", tickets: 20, sessionId: session() }, cookie)
  ).json();
  assert.equal(first.ticketsAwarded, 20);

  const second = await (
    await award({ locationId: cappedLocationId, game: "darts", tickets: 20, sessionId: session() }, cookie)
  ).json();
  assert.equal(second.ticketsAwarded, 10); // clamped to the remaining 10
  assert.equal(second.capped, true);

  const third = await (
    await award({ locationId: cappedLocationId, game: "pinball", tickets: 20, sessionId: session() }, cookie)
  ).json();
  assert.equal(third.status, "daily-cap");
  assert.equal(third.ticketsAwarded, 0);
  assert.equal(third.dailyCap, 30);

  // Another card at the same venue is unaffected.
  const otherCookie = await cardHolder(cappedLocationId, "PL-104");
  const other = await (
    await award({ locationId: cappedLocationId, game: "trivia", tickets: 20, sessionId: session() }, otherCookie)
  ).json();
  assert.equal(other.ticketsAwarded, 20);
});

test("a replayed session settles from the ledger without re-crediting", async () => {
  const sessionId = session();
  const cookie = await cardHolder(locationId, "PL-105");
  const body = { locationId, game: "bowling", tickets: 40, sessionId };
  const first = await (await award(body, cookie)).json();
  assert.equal(first.ticketsAwarded, 40);

  const callsBefore = stub.calls.length;
  const replay = await (await award(body, cookie)).json();
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

test("a failed vendor credit holds the reservation; a retry settles it", async () => {
  const sessionId = session();
  const cookie = await cardHolder(locationId, "PL-106");
  const body = { locationId, game: "darts", tickets: 15, sessionId };

  stub.failNext = true;
  const failed = await award(body, cookie);
  assert.equal(failed.status, 502);
  // The failure is ambiguous (the credit may have landed) — the reservation
  // stays pending, still holding its slice of the daily budget.
  const held = await testQuery(
    `select status from game_ticket_award where game = 'darts' and session_id = $1`,
    [sessionId]
  );
  assert.equal(held.rows[0].status, "pending");

  // Retrying the same session replays the vendor call under the same
  // idempotency key and settles the row.
  const retry = await (await award(body, cookie)).json();
  assert.equal(retry.status, "awarded");
  assert.equal(retry.ticketsAwarded, 15);
  const settled = await testQuery(
    `select status, count(*) over ()::int as n from game_ticket_award
      where game = 'darts' and session_id = $1`,
    [sessionId]
  );
  assert.equal(settled.rows[0].status, "awarded");
  assert.equal(settled.rows[0].n, 1);
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
  assert.ok(metaJson.games.some((g) => g.key === "clawmachine")); // skill grip now earns
  assert.ok(!metaJson.games.some((g) => g.key === "coinpusher")); // pure chance never earns
});
