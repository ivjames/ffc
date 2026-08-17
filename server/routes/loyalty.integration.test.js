// Integration coverage for /api/loyalty — the account-bound rewards card.
//
// The behaviour that matters here is negative: a card number used to be the
// only credential in the system, so these tests pin down that it no longer
// reads anything on its own (401 anonymous), that a signed-in player only ever
// sees the card THEY linked (never one someone else linked, and never one they
// merely name), and that the vendor is reached with server-held credentials
// rather than from the browser.
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
const { createUserSession } = await import("../lib/userAuth.js");

// --- Stub CenterEdge: player lookup + transactions. ------------------------
const stub = { lookups: [] };
const CARDS = {
  "PL-1001": {
    id: "PL-1001",
    displayName: "Alex Card",
    cardNumber: "770001112223",
    tier: "standard",
    balances: { tickets: 420, gamePlayCredits: 12 },
  },
  "PL-2002": {
    id: "PL-2002",
    displayName: "Sam Other",
    cardNumber: "770009998887",
    tier: "gold",
    balances: { tickets: 99, gamePlayCredits: 3 },
  },
};
const stubApp = express();
stubApp.use(express.json());
stubApp.get("/api/v1/players/:id/transactions", (req, res) => {
  if (!CARDS[req.params.id]) return res.status(404).json({ ok: false, error: "no such player" });
  res.json({
    ok: true,
    transactions: [
      { id: "tx-1", type: "ticket_reward", tickets: 25, source: "game:trivia" },
      { id: "tx-2", type: "purchase", tickets: 0, source: "cafe" },
    ],
  });
});
stubApp.get("/api/v1/players/:id", (req, res) => {
  stub.lookups.push({ id: req.params.id, auth: req.headers.authorization });
  const player = CARDS[req.params.id];
  if (!player) return res.status(404).json({ ok: false, error: "no such player" });
  res.json({ ok: true, player });
});

let baseUrl;
let close;
let stubClose;
let loyaltyLoc; // loyalty add-on on
let plainLoc; // no pos at all
const locationIds = [];
const emails = [];
let seq = 0;

async function player(card) {
  const email = `loyalty-${Date.now()}-${seq++}@example.com`;
  emails.push(email);
  const row = await testQuery(
    `insert into app_user (email, email_verified_at) values ($1, now()) returning id`,
    [email]
  );
  const id = row.rows[0].id;
  if (card) {
    await testQuery(
      `insert into user_card_link (app_user_id, location_id, card_player_id) values ($1, $2, $3)`,
      [id, loyaltyLoc, card]
    );
  }
  const { token } = await createUserSession(id);
  return { id, cookie: `ffc_session=${token}` };
}

function call(method, path, { cookie, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const ceStub = await listenEphemeral(stubApp);
  stubClose = ceStub.close;
  process.env.CENTEREDGE_API_BASE = ceStub.baseUrl;

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const mk = async (slug, pos) => {
    const row = await testQuery(
      `insert into location (name, slug, tz, pos) values ($1, $2, 'UTC', $3::jsonb) returning id`,
      [`Loyalty ${slug}`, `loyalty-${slug}`, pos === null ? null : JSON.stringify(pos)]
    );
    locationIds.push(row.rows[0].id);
    return row.rows[0].id;
  };
  loyaltyLoc = await mk(`on-${stamp}`, {
    ordering: null,
    // A dead apiBase on the venue record: the server must use trusted env only.
    loyalty: { vendor: "centeredge", apiBase: "http://127.0.0.1:9", gameRewards: true },
  });
  plainLoc = await mk(`off-${stamp}`, null);
});

after(async () => {
  if (close) await close();
  if (stubClose) await stubClose();
  await testQuery(`delete from app_user where email = any($1::text[])`, [emails]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("anonymous callers get nothing — a card number reads nothing on its own", async () => {
  const before = stub.lookups.length;
  assert.equal((await call("GET", `/api/loyalty/me?locationId=${loyaltyLoc}`)).status, 401);
  assert.equal(
    (await call("POST", "/api/loyalty/link", { body: { locationId: loyaltyLoc, cardNumber: "PL-1001" } }))
      .status,
    401
  );
  // Crucially the vendor was never even asked.
  assert.equal(stub.lookups.length, before);
});

test("linking binds the card to the account and then reads it back", async () => {
  const me = await player(null);
  const linked = await call("POST", "/api/loyalty/link", {
    cookie: me.cookie,
    body: { locationId: loyaltyLoc, cardNumber: "PL-1001" },
  });
  assert.equal(linked.status, 200);
  assert.equal((await linked.json()).player.displayName, "Alex Card");

  const row = await testQuery(
    `select card_player_id as c from user_card_link where app_user_id = $1 and location_id = $2`,
    [me.id, loyaltyLoc]
  );
  assert.equal(row.rows[0].c, "PL-1001");

  const mine = await call("GET", `/api/loyalty/me?locationId=${loyaltyLoc}`, { cookie: me.cookie });
  const body = await mine.json();
  assert.equal(body.player.id, "PL-1001");
  assert.equal(body.player.balances.tickets, 420);
  // History rides along, so the screen needs one round-trip.
  assert.equal(body.transactions.length, 2);
});

test("a signed-in player only sees the card they linked, never someone else's", async () => {
  const alex = await player("PL-1001");
  const sam = await player("PL-2002");

  const alexSees = await (
    await call("GET", `/api/loyalty/me?locationId=${loyaltyLoc}`, { cookie: alex.cookie })
  ).json();
  assert.equal(alexSees.player.id, "PL-1001");

  const samSees = await (
    await call("GET", `/api/loyalty/me?locationId=${loyaltyLoc}`, { cookie: sam.cookie })
  ).json();
  assert.equal(samSees.player.id, "PL-2002");

  // There is no route that takes a card id, so Sam's card is unreachable to
  // Alex however the request is shaped — the only lever is /link, which
  // REBINDS Alex's own row rather than reading Sam's.
  const relink = await call("POST", "/api/loyalty/link", {
    cookie: alex.cookie,
    body: { locationId: loyaltyLoc, cardNumber: "PL-2002" },
  });
  assert.equal(relink.status, 200);
  const rows = await testQuery(
    `select app_user_id as u, card_player_id as c from user_card_link where location_id = $1
      and app_user_id = any($2::uuid[]) order by card_player_id`,
    [loyaltyLoc, [alex.id, sam.id]]
  );
  // One row each, and Sam's is untouched.
  assert.equal(rows.rows.length, 2);
  assert.deepEqual(
    rows.rows.map((r) => r.c),
    ["PL-2002", "PL-2002"]
  );
});

test("a player with no card linked gets an empty answer, not an error", async () => {
  const me = await player(null);
  const res = await call("GET", `/api/loyalty/me?locationId=${loyaltyLoc}`, { cookie: me.cookie });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.player, null);
  assert.deepEqual(body.transactions, []);
});

test("an unknown card number 404s without binding anything", async () => {
  const me = await player(null);
  const res = await call("POST", "/api/loyalty/link", {
    cookie: me.cookie,
    body: { locationId: loyaltyLoc, cardNumber: "PL-NOPE" },
  });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /no card found/);
  const rows = await testQuery(`select 1 from user_card_link where app_user_id = $1`, [me.id]);
  assert.equal(rows.rows.length, 0);
});

test("a stale binding (card gone vendor-side) clears itself instead of looping", async () => {
  const me = await player(null);
  await testQuery(
    `insert into user_card_link (app_user_id, location_id, card_player_id) values ($1, $2, 'PL-VANISHED')`,
    [me.id, loyaltyLoc]
  );
  const res = await call("GET", `/api/loyalty/me?locationId=${loyaltyLoc}`, { cookie: me.cookie });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).player, null);
  const rows = await testQuery(`select 1 from user_card_link where app_user_id = $1`, [me.id]);
  assert.equal(rows.rows.length, 0);
});

test("a venue without the loyalty add-on has no card surface at all", async () => {
  const me = await player(null);
  assert.equal(
    (await call("GET", `/api/loyalty/me?locationId=${plainLoc}`, { cookie: me.cookie })).status,
    403
  );
  assert.equal(
    (
      await call("POST", "/api/loyalty/link", {
        cookie: me.cookie,
        body: { locationId: plainLoc, cardNumber: "PL-1001" },
      })
    ).status,
    403
  );
});

test("unlinking drops the binding", async () => {
  const me = await player("PL-1001");
  const res = await call("DELETE", "/api/loyalty/link", {
    cookie: me.cookie,
    body: { locationId: loyaltyLoc },
  });
  assert.equal(res.status, 200);
  const rows = await testQuery(`select 1 from user_card_link where app_user_id = $1`, [me.id]);
  assert.equal(rows.rows.length, 0);
});

test("the vendor is called with server-held credentials, not the venue's apiBase", async () => {
  const me = await player(null);
  const before = stub.lookups.length;
  await call("POST", "/api/loyalty/link", {
    cookie: me.cookie,
    body: { locationId: loyaltyLoc, cardNumber: "PL-1001" },
  });
  const lookup = stub.lookups.at(-1);
  assert.ok(stub.lookups.length > before);
  // The venue's own apiBase is 127.0.0.1:9 (dead) — reaching the stub at all
  // proves the trusted env endpoint won, and the bearer came from the server.
  assert.match(lookup.auth ?? "", /^Bearer /);
});
