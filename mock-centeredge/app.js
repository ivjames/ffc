// Mock CenterEdge Advantage Web Services backend. Exports a factory so tests
// boot fresh isolated instances; index.js is the process entrypoint.
//
// State: in-memory, but OPTIONALLY persisted to disk when the factory is given
// a `stateFile` (index.js does this; tests don't, so they stay isolated). The
// real vendor keeps balances across our deploys, so the mock must too —
// otherwise a redeploy silently wipes every card's ticket balance back to the
// seed. We persist the loyalty-relevant slice (player balances, transaction
// history, and the reward idempotency map so a replay after a restart still
// de-dupes); the fake kitchen's orders stay ephemeral. POST /api/v1/_reset
// still restores the seed on demand.
//
// Contract notes (kept intentionally close to what we expect from the real
// API so the swap later is a base-URL + auth change, not a reshape):
// - Auth: OAuth-ish client-credentials → Bearer token. A static dev token
//   (`ce-mock-dev-token`, override MOCK_STATIC_TOKEN) also works for curl.
// - Money is integer cents everywhere.
// - The server is the price authority: POST /orders recomputes the total from
//   the menu and rejects a mismatched payment amount, so the frontend's cart
//   math gets exercised against an independent implementation.
// - Orders are serviced by a fake kitchen (kitchen.js): tickets queue for a
//   fixed number of stations with per-item prep times, statuses derive from
//   the schedule (received → sent_to_kitchen → preparing → ready → picked_up),
//   and staff can bump tickets from the KDS page at GET /kitchen.
//
// Failure simulation (for state-management dev):
// - payment token "tok_declined"  → 402 payment_declined
// - header  x-mock-force-error: <status> → that status on any /api/v1 route
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MENU, PLAYERS } from './seed.js';
import {
  freshKitchen,
  scheduleTicket,
  ticketStatus,
  bumpTicket,
  pickUpTicket,
  completedAtMs,
  makePickupCode,
} from './kitchen.js';
import { kdsPage } from './kds.js';

export const STATIC_TOKEN = process.env.MOCK_STATIC_TOKEN || 'ce-mock-dev-token';

// How many simulated cooks work the fake kitchen — more stations = less
// queueing under a burst of orders.
const STATION_COUNT = Math.max(1, Number(process.env.MOCK_KITCHEN_STATIONS) || 2);

function freshState() {
  return {
    tokens: new Set(),
    players: new Map(PLAYERS.map((p) => [p.id, structuredClone(p)])),
    orders: new Map(),
    kitchen: freshKitchen(STATION_COUNT),
    // idempotencyKey → completed reward transaction (replayed on duplicates)
    rewardsByKey: new Map(),
    // playerId → newest-first transaction list
    transactions: new Map(),
    nextOrderNumber: 1001,
  };
}

// The persisted slice of state (see the header note): balances, history, and
// the reward idempotency map. Orders/kitchen/tokens are deliberately left out —
// they're ephemeral demo sim state, safe to reset on restart.
function serializeState(state) {
  return JSON.stringify({
    v: 1,
    players: [...state.players.values()],
    transactions: [...state.transactions.entries()],
    rewardsByKey: [...state.rewardsByKey.entries()],
    nextOrderNumber: state.nextOrderNumber,
  });
}

// Overlay a persisted snapshot onto a fresh state. Tolerant of a missing or
// malformed file (returns without changes) so a corrupt snapshot degrades to
// the seed rather than crashing the mock on boot.
function loadPersisted(state, stateFile) {
  let data;
  try {
    data = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[mock-centeredge] ignoring unreadable state file ${stateFile}: ${err.message}`);
    }
    return;
  }
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data.players)) {
    // Overlay ONLY the mutable balances onto the current seed roster — never
    // replace it. Otherwise an old snapshot would shadow the live seed forever:
    // a later release's new demo card would 404 and updated card metadata would
    // stay stale until a balance-destroying _reset. Cards no longer in the seed
    // are simply dropped; new seed cards keep their seed balance.
    const savedBalances = new Map(
      data.players.filter((p) => p && p.id).map((p) => [p.id, p.balances]),
    );
    for (const [id, player] of state.players) {
      const saved = savedBalances.get(id);
      if (saved && typeof saved === 'object') {
        player.balances = { ...player.balances, ...saved };
      }
    }
  }
  if (Array.isArray(data.transactions)) state.transactions = new Map(data.transactions);
  if (Array.isArray(data.rewardsByKey)) state.rewardsByKey = new Map(data.rewardsByKey);
  if (Number.isInteger(data.nextOrderNumber)) state.nextOrderNumber = data.nextOrderNumber;
}

// Menu lookups don't change per instance — index once at module load.
const ITEMS_BY_ID = new Map();
const MODIFIER_NAME_BY_ID = new Map();
for (const cat of MENU.categories) {
  for (const item of cat.items) {
    ITEMS_BY_ID.set(item.id, item);
    for (const group of item.modifierGroups) {
      for (const o of group.options) MODIFIER_NAME_BY_ID.set(o.id, o.name);
    }
  }
}

/** Wire shape of an order: internal scheduling stripped, status and ETA
 *  derived from the fake kitchen's ticket at read time. */
function publicOrder(order, now = Date.now()) {
  const { createdAtMs, ticket, ...pub } = order;
  return {
    ...pub,
    status: ticketStatus(ticket, now),
    station: ticket.station,
    estimatedReadyAt: new Date(ticket.readyAtMs).toISOString(),
  };
}

/** A pickup code not currently in use by any OPEN (not-yet-collected) order,
 *  so the KDS never shows two live tickets with the same code (staff match the
 *  guest's code to a ticket, so collisions would misroute a hand-off). A
 *  completed order's code is free to reuse — it's off the board. Retries a
 *  bounded number of times, then accepts a code rather than looping forever
 *  (there are 9000 codes; a demo never has that many open orders). */
function uniquePickupCode(state, nowMs) {
  const inUse = new Set();
  for (const o of state.orders.values()) {
    if (ticketStatus(o.ticket, nowMs) !== 'picked_up') inUse.add(o.pickupCode);
  }
  for (let i = 0; i < 50; i++) {
    const code = makePickupCode();
    if (!inUse.has(code)) return code;
  }
  return makePickupCode();
}

/** Recompute an order line's price from the menu (server is price authority).
 *  Returns { priceCents } or { error }. */
function priceLine(line) {
  const item = ITEMS_BY_ID.get(line.menuItemId);
  if (!item) return { error: `unknown menuItemId: ${line.menuItemId}` };
  if (!item.available) return { error: `item unavailable: ${item.name}` };
  const qty = line.quantity;
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
    return { error: `quantity must be an integer 1..20 (${item.name})` };
  }
  const chosen = line.modifierIds ?? [];
  if (!Array.isArray(chosen) || chosen.some((m) => typeof m !== 'string')) {
    return { error: `modifierIds must be an array of strings (${item.name})` };
  }
  let modTotal = 0;
  const validIds = new Set();
  for (const group of item.modifierGroups) {
    const inGroup = group.options.filter((o) => chosen.includes(o.id));
    if (group.required && inGroup.length < group.minSelect) {
      return { error: `"${group.name}" selection required for ${item.name}` };
    }
    if (inGroup.length > group.maxSelect) {
      return { error: `too many "${group.name}" selections for ${item.name} (max ${group.maxSelect})` };
    }
    for (const o of inGroup) {
      modTotal += o.priceCents;
      validIds.add(o.id);
    }
  }
  const unknown = chosen.filter((id) => !validIds.has(id));
  if (unknown.length) return { error: `modifiers not valid for ${item.name}: ${unknown.join(', ')}` };
  if (line.notes != null && (typeof line.notes !== 'string' || line.notes.length > 200)) {
    return { error: `notes must be a string of at most 200 chars (${item.name})` };
  }
  return { priceCents: (item.priceCents + modTotal) * qty };
}

function findPlayer(state, idOrCard) {
  return (
    state.players.get(idOrCard) ??
    [...state.players.values()].find((p) => p.cardNumber === idOrCard) ??
    null
  );
}

function pushTransaction(state, playerId, tx) {
  const list = state.transactions.get(playerId) ?? [];
  list.unshift(tx);
  state.transactions.set(playerId, list);
}

export function createApp({ stateFile = null } = {}) {
  const state = freshState();
  // Persistence is opt-in: only the long-running process passes a stateFile.
  // Tests call createApp() with none, so they stay fully in-memory and isolated.
  if (stateFile) {
    try {
      mkdirSync(dirname(stateFile), { recursive: true });
    } catch (err) {
      console.warn(`[mock-centeredge] could not create state dir for ${stateFile}: ${err.message}`);
    }
    loadPersisted(state, stateFile);
  }
  // Write the persisted slice atomically (tmp + rename). Best-effort: a failed
  // write is logged but never breaks the request that triggered it — the mock
  // keeps serving from memory.
  const persist = () => {
    if (!stateFile) return;
    try {
      const tmp = `${stateFile}.tmp`;
      writeFileSync(tmp, serializeState(state));
      renameSync(tmp, stateFile);
    } catch (err) {
      console.warn(`[mock-centeredge] failed to persist state to ${stateFile}: ${err.message}`);
    }
  };

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Optional artificial latency so loading states are visible in the UI.
  const latencyMs = Number(process.env.MOCK_LATENCY_MS || 0);
  if (latencyMs > 0) {
    app.use((req, res, next) => setTimeout(next, latencyMs));
  }

  // Chaos hook: force any status from the client to exercise error paths.
  app.use('/api/v1', (req, res, next) => {
    const forced = Number(req.get('x-mock-force-error'));
    if (Number.isInteger(forced) && forced >= 400 && forced <= 599) {
      return res.status(forced).json({ ok: false, error: `forced by x-mock-force-error: ${forced}` });
    }
    next();
  });

  app.get('/api/v1/health', (req, res) => res.json({ ok: true, mock: 'centeredge' }));

  // The fake kitchen's display screen — a plain browser page (no auth, not
  // under /api/v1), served here so the demo needs nothing but the mock:
  // http://localhost:8070/kitchen locally, /ce/kitchen deployed.
  app.get('/kitchen', (req, res) => {
    res.type('html').send(kdsPage(STATIC_TOKEN));
  });

  app.post('/api/v1/auth/token', (req, res) => {
    const { clientId, clientSecret } = req.body ?? {};
    if (!clientId || !clientSecret) {
      return res.status(400).json({ ok: false, error: 'clientId and clientSecret are required' });
    }
    // Any non-empty credentials work — the point is that the frontend builds
    // the token round-trip + Authorization header now, not real security.
    const token = `ce-mock-${randomUUID()}`;
    state.tokens.add(token);
    res.json({ access_token: token, token_type: 'Bearer', expires_in: 3600 });
  });

  // Everything below requires a Bearer token (issued above, or the static dev token).
  app.use('/api/v1', (req, res, next) => {
    const auth = req.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || (token !== STATIC_TOKEN && !state.tokens.has(token))) {
      return res.status(401).json({ ok: false, error: 'missing or invalid bearer token' });
    }
    next();
  });

  // ---- F&B ----------------------------------------------------------------

  app.get('/api/v1/menu', (req, res) => res.json(MENU));

  app.post('/api/v1/orders', (req, res) => {
    const { items, payment, playerId, guestName, notes } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
      return res.status(400).json({ ok: false, error: 'items must be a non-empty array (max 30 lines)' });
    }
    const lines = [];
    let subtotalCents = 0;
    for (const raw of items) {
      const priced = priceLine(raw ?? {});
      if (priced.error) return res.status(400).json({ ok: false, error: priced.error });
      subtotalCents += priced.priceCents;
      const modifierIds = raw.modifierIds ?? [];
      lines.push({
        menuItemId: raw.menuItemId,
        name: ITEMS_BY_ID.get(raw.menuItemId).name,
        quantity: raw.quantity,
        modifierIds,
        // Resolved names so the kitchen ticket (and the player's receipt) can
        // show "16\" Large, Pepperoni" without a menu lookup.
        modifierNames: modifierIds.map((id) => MODIFIER_NAME_BY_ID.get(id)),
        notes: raw.notes ?? null,
        lineTotalCents: priced.priceCents,
      });
    }
    const taxCents = Math.round((subtotalCents * MENU.taxRatePct) / 100);
    const totalCents = subtotalCents + taxCents;

    if (!payment || typeof payment.token !== 'string' || payment.token.length === 0) {
      return res.status(400).json({ ok: false, error: 'payment.token (tokenized card) is required' });
    }
    if (payment.amountCents !== totalCents) {
      return res.status(400).json({
        ok: false,
        error: 'payment.amountCents does not match the server-computed total',
        expected: { subtotalCents, taxCents, totalCents },
      });
    }
    if (payment.token === 'tok_declined') {
      return res.status(402).json({ ok: false, error: 'payment_declined' });
    }
    let player = null;
    if (playerId != null) {
      player = findPlayer(state, playerId);
      if (!player) return res.status(404).json({ ok: false, error: `unknown player: ${playerId}` });
    }
    if (notes != null && (typeof notes !== 'string' || notes.length > 500)) {
      return res.status(400).json({ ok: false, error: 'notes must be a string of at most 500 chars' });
    }

    const nowMs = Date.now();
    const order = {
      id: `ord-${randomUUID()}`,
      orderNumber: state.nextOrderNumber++,
      items: lines,
      subtotalCents,
      taxCents,
      totalCents,
      playerId: player?.id ?? null,
      guestName: typeof guestName === 'string' ? guestName.slice(0, 100) : null,
      notes: notes ?? null,
      // Shown big on the guest's Ready screen and on the KDS ticket; matching
      // the two is the pickup hand-off (either side can then complete it).
      // Unique among open orders so staff never see two live tickets alike.
      pickupCode: uniquePickupCode(state, nowMs),
      createdAt: new Date(nowMs).toISOString(),
      createdAtMs: nowMs,
      // Hand the ticket to the fake kitchen: reserves a station and fixes the
      // print/start/ready schedule this order's status derives from.
      ticket: scheduleTicket(state.kitchen, lines, nowMs),
    };
    state.orders.set(order.id, order);
    // A linked-card order lands in that player's history (a receipt trail) but
    // does NOT earn tickets — whether/how CenterEdge awards points on F&B spend
    // is an open question, so the mock deliberately doesn't invent a rate.
    if (player) {
      pushTransaction(state, player.id, {
        id: `tx-${randomUUID()}`,
        type: 'food_order',
        orderId: order.id,
        amountCents: totalCents,
        createdAt: order.createdAt,
      });
    }
    persist(); // nextOrderNumber + any linked-card transaction
    res.status(201).json({
      ok: true,
      order: publicOrder(order, nowMs),
      kitchen: {
        printed: true,
        station: order.ticket.station,
        estimatedReadyAt: new Date(order.ticket.readyAtMs).toISOString(),
      },
    });
  });

  app.get('/api/v1/orders/:id', (req, res) => {
    const order = state.orders.get(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'order not found' });
    res.json({ ok: true, order: publicOrder(order) });
  });

  // Guest-side pickup — the app's "I've picked it up" button. Either side can
  // complete the hand-off, so this mirrors the KDS bump's ready → picked_up
  // step, but only once the food is ready: collecting an order that's still
  // cooking is a 409, not a silent no-op. Idempotent once picked up.
  app.post('/api/v1/orders/:id/pickup', (req, res) => {
    const order = state.orders.get(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'order not found' });
    const status = pickUpTicket(order.ticket, Date.now());
    if (status !== 'picked_up') {
      return res.status(409).json({ ok: false, error: 'order is not ready for pickup yet' });
    }
    res.json({ ok: true, order: publicOrder(order) });
  });

  // ---- The fake kitchen ---------------------------------------------------

  // The live board: open tickets oldest-first (what a KDS shows), plus the
  // last few completed ones and station occupancy. Everything is derived at
  // read time — the sim has no background loop.
  app.get('/api/v1/kitchen/orders', (req, res) => {
    const now = Date.now();
    const all = [...state.orders.values()];
    const open = all
      .filter((o) => ticketStatus(o.ticket, now) !== 'picked_up')
      .sort((a, b) => a.createdAtMs - b.createdAtMs)
      .map((o) => publicOrder(o, now));
    const recentlyCompleted = all
      .filter((o) => ticketStatus(o.ticket, now) === 'picked_up')
      .sort((a, b) => completedAtMs(b.ticket) - completedAtMs(a.ticket))
      .slice(0, 5)
      .map((o) => publicOrder(o, now));
    res.json({
      ok: true,
      stations: {
        count: STATION_COUNT,
        busy: state.kitchen.stationFreeAtMs.filter((t) => t > now).length,
      },
      orders: open,
      recentlyCompleted,
    });
  });

  // Staff bump: not yet ready → ready now; ready → picked_up. Idempotent once
  // picked up, so a double-tap on the board is harmless.
  app.post('/api/v1/kitchen/orders/:id/bump', (req, res) => {
    const order = state.orders.get(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'order not found' });
    bumpTicket(order.ticket, Date.now());
    res.json({ ok: true, order: publicOrder(order) });
  });

  // ---- Player card / loyalty ---------------------------------------------

  app.get('/api/v1/players/:id', (req, res) => {
    const player = findPlayer(state, req.params.id);
    if (!player) return res.status(404).json({ ok: false, error: 'player not found' });
    res.json({ ok: true, player });
  });

  app.get('/api/v1/players/:id/transactions', (req, res) => {
    const player = findPlayer(state, req.params.id);
    if (!player) return res.status(404).json({ ok: false, error: 'player not found' });
    res.json({ ok: true, transactions: state.transactions.get(player.id) ?? [] });
  });

  app.post('/api/v1/players/:id/tickets/reward', (req, res) => {
    const player = findPlayer(state, req.params.id);
    if (!player) return res.status(404).json({ ok: false, error: 'player not found' });
    const { tickets, source, idempotencyKey } = req.body ?? {};
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 100) {
      return res.status(400).json({ ok: false, error: 'idempotencyKey (string, 1..100 chars) is required' });
    }
    if (!Number.isInteger(tickets) || tickets < 1 || tickets > 10_000) {
      return res.status(400).json({ ok: false, error: 'tickets must be an integer 1..10000' });
    }
    // Replay: a retried request must not double-credit the balance.
    const prior = state.rewardsByKey.get(idempotencyKey);
    if (prior) return res.json({ ...prior, duplicate: true });

    player.balances.tickets += tickets;
    const tx = {
      id: `tx-${randomUUID()}`,
      type: 'ticket_reward',
      tickets,
      source: typeof source === 'string' ? source.slice(0, 100) : 'app',
      createdAt: new Date().toISOString(),
    };
    pushTransaction(state, player.id, tx);
    const response = {
      ok: true,
      transactionId: tx.id,
      playerId: player.id,
      ticketsAwarded: tickets,
      newTicketBalance: player.balances.tickets,
      duplicate: false,
    };
    state.rewardsByKey.set(idempotencyKey, response);
    persist(); // balance + transaction + idempotency record must survive restart
    res.json(response);
  });

  // ---- Dev helpers --------------------------------------------------------

  // Reset every balance/order back to the seed (issued tokens survive).
  app.post('/api/v1/_reset', (req, res) => {
    const tokens = state.tokens;
    Object.assign(state, freshState());
    state.tokens = tokens;
    persist(); // overwrite the snapshot with the seed so the reset survives restart
    res.json({ ok: true });
  });

  app.use('/api/v1', (req, res) => res.status(404).json({ ok: false, error: 'not found' }));
  return app;
}
