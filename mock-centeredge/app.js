// Mock CenterEdge Advantage Web Services backend. In-memory only — restart =
// clean slate (or POST /api/v1/_reset). Exports a factory so tests boot fresh
// isolated instances; index.js is the process entrypoint.
//
// Contract notes (kept intentionally close to what we expect from the real
// API so the swap later is a base-URL + auth change, not a reshape):
// - Auth: OAuth-ish client-credentials → Bearer token. A static dev token
//   (`ce-mock-dev-token`, override MOCK_STATIC_TOKEN) also works for curl.
// - Money is integer cents everywhere.
// - The server is the price authority: POST /orders recomputes the total from
//   the menu and rejects a mismatched payment amount, so the frontend's cart
//   math gets exercised against an independent implementation.
// - Order status is derived from elapsed time since creation (received →
//   sent_to_kitchen → preparing → ready), so polling GET /orders/:id shows a
//   realistic progression with no timers to leak.
//
// Failure simulation (for state-management dev):
// - payment token "tok_declined"  → 402 payment_declined
// - header  x-mock-force-error: <status> → that status on any /api/v1 route
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { MENU, PLAYERS } from './seed.js';

export const STATIC_TOKEN = process.env.MOCK_STATIC_TOKEN || 'ce-mock-dev-token';

// Elapsed-ms thresholds for the derived order status, exported for tests.
export const STATUS_TIMELINE = [
  { untilMs: 5_000, status: 'received' },
  { untilMs: 20_000, status: 'sent_to_kitchen' },
  { untilMs: 45_000, status: 'preparing' },
  { untilMs: Infinity, status: 'ready' },
];

// Loyalty earn rate on food orders placed with a linked player card:
// 1 ticket per this many cents of the order total (i.e. per full dollar).
export const EARN_CENTS_PER_TICKET = 100;

export function orderStatus(createdAtMs, now = Date.now()) {
  const elapsed = now - createdAtMs;
  return STATUS_TIMELINE.find((s) => elapsed < s.untilMs).status;
}

function freshState() {
  return {
    tokens: new Set(),
    players: new Map(PLAYERS.map((p) => [p.id, structuredClone(p)])),
    orders: new Map(),
    // idempotencyKey → completed reward transaction (replayed on duplicates)
    rewardsByKey: new Map(),
    // playerId → newest-first transaction list
    transactions: new Map(),
    nextOrderNumber: 1001,
  };
}

// Menu lookups don't change per instance — index once at module load.
const ITEMS_BY_ID = new Map();
for (const cat of MENU.categories) {
  for (const item of cat.items) ITEMS_BY_ID.set(item.id, item);
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

export function createApp() {
  const state = freshState();
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
      lines.push({
        menuItemId: raw.menuItemId,
        name: ITEMS_BY_ID.get(raw.menuItemId).name,
        quantity: raw.quantity,
        modifierIds: raw.modifierIds ?? [],
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

    const order = {
      id: `ord-${randomUUID()}`,
      orderNumber: state.nextOrderNumber++,
      status: 'received',
      items: lines,
      subtotalCents,
      taxCents,
      totalCents,
      playerId: player?.id ?? null,
      guestName: typeof guestName === 'string' ? guestName.slice(0, 100) : null,
      notes: notes ?? null,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
    };
    state.orders.set(order.id, order);
    // Purchases on a linked card earn loyalty tickets (1 per full dollar) —
    // the "earn on food orders" half of the loyalty story.
    let loyalty = null;
    if (player) {
      const earnedTickets = Math.floor(totalCents / EARN_CENTS_PER_TICKET);
      player.balances.tickets += earnedTickets;
      loyalty = { earnedTickets, newTicketBalance: player.balances.tickets };
      pushTransaction(state, player.id, {
        id: `tx-${randomUUID()}`,
        type: 'food_order',
        orderId: order.id,
        amountCents: totalCents,
        earnedTickets,
        createdAt: order.createdAt,
      });
    }
    const { createdAtMs, ...publicOrder } = order;
    res.status(201).json({
      ok: true,
      order: publicOrder,
      kitchen: { printed: true, station: 'kitchen-1' },
      loyalty,
    });
  });

  app.get('/api/v1/orders/:id', (req, res) => {
    const order = state.orders.get(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'order not found' });
    const { createdAtMs, ...publicOrder } = order;
    res.json({ ok: true, order: { ...publicOrder, status: orderStatus(createdAtMs) } });
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
    res.json(response);
  });

  // ---- Dev helpers --------------------------------------------------------

  // Reset every balance/order back to the seed (issued tokens survive).
  app.post('/api/v1/_reset', (req, res) => {
    const tokens = state.tokens;
    Object.assign(state, freshState());
    state.tokens = tokens;
    res.json({ ok: true });
  });

  app.use('/api/v1', (req, res) => res.status(404).json({ ok: false, error: 'not found' }));
  return app;
}
