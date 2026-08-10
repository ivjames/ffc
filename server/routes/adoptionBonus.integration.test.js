// Integration coverage for the adoption bonus (POST /api/game-rewards/bonus) —
// the one-time install/sign-in ticket reward. A stub CenterEdge stands in for
// the vendor so the tests exercise the real chain: validation -> venue config
// -> one-time reservation -> vendor credit -> idempotent replay.
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

const { app } = await import("../app.js");

// Stub CenterEdge credit endpoint, with vendor-side idempotency + a call log.
const stub = { calls: [], byKey: new Map(), balance: 1000 };
const stubApp = express();
stubApp.use(express.json());
stubApp.post("/api/v1/players/:id/tickets/reward", (req, res) => {
  stub.calls.push({ playerId: req.params.id, ...req.body });
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
let defaultLoc; // gameRewards on, default bonus (50/50)
let tunedLoc; // install disabled, signin tuned to 200
let noRewardsLoc; // loyalty on, gameRewards off
const locationIds = [];

async function makeLocation(slug, pos) {
  const row = await testQuery(
    `insert into location (name, slug, tz, pos) values ($1, $2, 'UTC', $3::jsonb) returning id`,
    [`Bonus ${slug}`, `bonus-${slug}`, JSON.stringify(pos)]
  );
  locationIds.push(row.rows[0].id);
  return row.rows[0].id;
}

function bonus(body) {
  return fetch(`${baseUrl}/api/game-rewards/bonus`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const ceStub = await listenEphemeral(stubApp);
  stubClose = ceStub.close;
  // Server-side credit uses trusted env config, not the venue apiBase.
  process.env.CENTEREDGE_API_BASE = ceStub.baseUrl;

  const stamp = `${Date.now()}`;
  const loyalty = (extra = {}) => ({
    ordering: null,
    loyalty: { vendor: "centeredge", apiBase: "http://127.0.0.1:9", gameRewards: true, ...extra },
  });
  defaultLoc = await makeLocation(`a-${stamp}`, loyalty());
  tunedLoc = await makeLocation(`b-${stamp}`, loyalty({ adoptionBonus: { install: 0, signin: 200 } }));
  noRewardsLoc = await makeLocation(`c-${stamp}`, {
    ordering: null,
    loyalty: { vendor: "centeredge", apiBase: "http://127.0.0.1:9", gameRewards: false },
  });
});

after(async () => {
  if (close) await close();
  if (stubClose) await stubClose();
  await testQuery(`delete from bonus_award where location_id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
});

test("rejects malformed requests", async () => {
  const cases = [
    [{ locationId: "nope", playerId: "PL-1", kind: "install" }, /locationId/],
    [{ locationId: defaultLoc, playerId: "", kind: "install" }, /playerId/],
    [{ locationId: defaultLoc, playerId: "PL-1", kind: "referral" }, /kind/],
  ];
  for (const [body, msg] of cases) {
    const res = await bonus(body);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, msg);
  }
});

test("gates on the venue's ticket rewards add-on", async () => {
  const res = await bonus({ locationId: noRewardsLoc, playerId: "PL-1", kind: "install" });
  assert.equal(res.status, 403);
});

test("awards the default bonus once, then replays without double-crediting", async () => {
  const before = stub.calls.length;
  const first = await (await bonus({ locationId: defaultLoc, playerId: "PL-A", kind: "install" })).json();
  assert.equal(first.status, "awarded");
  assert.equal(first.ticketsAwarded, 50); // platform default
  assert.equal(first.duplicate, false);

  const replay = await (await bonus({ locationId: defaultLoc, playerId: "PL-A", kind: "install" })).json();
  assert.equal(replay.status, "awarded");
  assert.equal(replay.ticketsAwarded, 50);
  assert.equal(replay.duplicate, true);

  // Exactly one credit landed for this (card, kind), and one ledger row.
  const creditsForKey = stub.calls
    .slice(before)
    .filter((c) => c.idempotencyKey === "bonus:install:PL-A");
  assert.equal(creditsForKey.length, 1);
  const rows = (
    await testQuery(
      "select count(*)::int as n from bonus_award where location_id = $1 and player_id = 'PL-A' and kind = 'install'",
      [defaultLoc]
    )
  ).rows[0].n;
  assert.equal(rows, 1);
});

test("install and sign-in are separate one-time milestones", async () => {
  const install = await (await bonus({ locationId: defaultLoc, playerId: "PL-B", kind: "install" })).json();
  const signin = await (await bonus({ locationId: defaultLoc, playerId: "PL-B", kind: "signin" })).json();
  assert.equal(install.status, "awarded");
  assert.equal(signin.status, "awarded");
  assert.equal(install.ticketsAwarded, 50);
  assert.equal(signin.ticketsAwarded, 50);
});

test("a disabled milestone is a clean no-op; a tuned one pays the venue amount", async () => {
  const off = await (await bonus({ locationId: tunedLoc, playerId: "PL-C", kind: "install" })).json();
  assert.equal(off.status, "disabled");
  assert.equal(off.ticketsAwarded, 0);

  const on = await (await bonus({ locationId: tunedLoc, playerId: "PL-C", kind: "signin" })).json();
  assert.equal(on.status, "awarded");
  assert.equal(on.ticketsAwarded, 200); // venue-tuned
});
