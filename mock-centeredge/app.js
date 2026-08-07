// Mock CenterEdge-style API for local FEC app development.
//
// This is NOT the real CenterEdge API. It's a stand-in that mimics the shapes
// we expect from Advantage Web Services (F&B ordering + player card/loyalty)
// so frontend and state-management work can proceed before real credentials
// arrive. When the sandbox is provisioned, swap the base URL and reconcile
// payload shapes against the official docs.
//
// Zero dependencies — runs on Node 18+ with `node mock-centeredge/server.js`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

// Per-transaction cap on injected tickets. A real integration would enforce
// this server-side too — keeping it here forces the app to handle the error.
export const MAX_TICKETS_PER_REWARD = 1000;

const ORDER_STATUS_STAGES = [
  // seconds since order creation → status the kitchen would report
  { after: 0, status: "received", printStatus: "queued" },
  { after: 3, status: "received", printStatus: "printed" },
  { after: 15, status: "preparing", printStatus: "printed" },
  { after: 60, status: "ready", printStatus: "printed" },
];

function loadSeed(file) {
  return JSON.parse(readFileSync(path.join(DATA_DIR, file), "utf8"));
}

function freshState() {
  return {
    menu: loadSeed("menu.json").menu,
    players: new Map(loadSeed("players.json").players.map((p) => [p.playerId, structuredClone(p)])),
    orders: new Map(),
    rewardIdempotency: new Map(), // `${playerId}:${idempotencyKey}` → stored response
    nextOrderNum: 1,
    nextTxnNum: 1,
  };
}

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function findItem(menu, itemId) {
  for (const cat of menu.categories) {
    const item = cat.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return null;
}

// Validate one cart line's modifiers against the item's groups and return the
// summed price delta. Enforces per-group min/max selections.
function priceModifiers(item, modifierIds) {
  const optionById = new Map();
  for (const group of item.modifierGroups) {
    for (const opt of group.options) optionById.set(opt.id, { opt, group });
  }
  const countByGroup = new Map();
  let deltaCents = 0;
  for (const id of modifierIds) {
    const found = optionById.get(id);
    if (!found) {
      throw new ApiError(422, "UNKNOWN_MODIFIER", `Modifier "${id}" is not valid for item "${item.id}".`);
    }
    deltaCents += found.opt.priceDeltaCents;
    countByGroup.set(found.group.id, (countByGroup.get(found.group.id) ?? 0) + 1);
  }
  for (const group of item.modifierGroups) {
    const count = countByGroup.get(group.id) ?? 0;
    if (count < group.minSelections) {
      throw new ApiError(
        422,
        "MODIFIER_SELECTION_REQUIRED",
        `Item "${item.name}" requires at least ${group.minSelections} selection(s) from "${group.name}".`,
        { itemId: item.id, modifierGroupId: group.id },
      );
    }
    if (count > group.maxSelections) {
      throw new ApiError(
        422,
        "TOO_MANY_MODIFIERS",
        `Item "${item.name}" allows at most ${group.maxSelections} selection(s) from "${group.name}".`,
        { itemId: item.id, modifierGroupId: group.id },
      );
    }
  }
  return deltaCents;
}

function buildOrder(state, body, now) {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ApiError(400, "EMPTY_ORDER", "Order must contain at least one item.");
  }
  const payment = body.payment ?? {};
  const validMethods = ["tokenized-card", "player-credit", "pay-at-counter"];
  if (!validMethods.includes(payment.method)) {
    throw new ApiError(400, "INVALID_PAYMENT_METHOD", `payment.method must be one of: ${validMethods.join(", ")}.`);
  }
  if (payment.method === "tokenized-card" && !payment.token) {
    throw new ApiError(400, "MISSING_PAYMENT_TOKEN", "payment.token is required for tokenized-card payments.");
  }

  let player = null;
  if (body.playerId != null || payment.method === "player-credit") {
    player = state.players.get(body.playerId);
    if (!player) {
      throw new ApiError(404, "PLAYER_NOT_FOUND", `No player with id "${body.playerId}".`);
    }
  }

  const lines = [];
  let subtotalCents = 0;
  for (const line of body.items) {
    const qty = line.quantity;
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw new ApiError(400, "INVALID_QUANTITY", "quantity must be an integer between 1 and 20.");
    }
    const item = findItem(state.menu, line.itemId);
    if (!item) {
      throw new ApiError(422, "UNKNOWN_ITEM", `No menu item with id "${line.itemId}".`);
    }
    if (!item.available) {
      throw new ApiError(422, "ITEM_UNAVAILABLE", `"${item.name}" is currently unavailable.`, { itemId: item.id });
    }
    const modifierIds = line.modifiers ?? [];
    const deltaCents = priceModifiers(item, modifierIds);
    const unitPriceCents = item.priceCents + deltaCents;
    const lineTotalCents = unitPriceCents * qty;
    subtotalCents += lineTotalCents;
    lines.push({
      itemId: item.id,
      name: item.name,
      quantity: qty,
      modifiers: modifierIds,
      notes: typeof line.notes === "string" ? line.notes.slice(0, 200) : undefined,
      unitPriceCents,
      lineTotalCents,
    });
  }

  const taxCents = Math.round((subtotalCents * state.menu.taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents;

  if (payment.method === "player-credit") {
    if (player.status !== "active") {
      throw new ApiError(409, "PLAYER_CARD_INACTIVE", `Player card is ${player.status}; cannot charge it.`);
    }
    if (player.balances.cashBalanceCents < totalCents) {
      throw new ApiError(402, "INSUFFICIENT_FUNDS", "Player cash balance cannot cover this order.", {
        balanceCents: player.balances.cashBalanceCents,
        totalCents,
      });
    }
    player.balances.cashBalanceCents -= totalCents;
    player.recentActivity.unshift({
      transactionId: `txn-${String(state.nextTxnNum++).padStart(4, "0")}`,
      type: "fnb-purchase",
      description: "Mobile F&B order",
      amountCents: -totalCents,
      occurredAt: new Date(now).toISOString(),
    });
  }

  const orderId = `ord-${String(state.nextOrderNum++).padStart(5, "0")}`;
  const order = {
    orderId,
    status: "received",
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    playerId: player?.playerId ?? null,
    guestName: body.guestName ?? null,
    deliverTo: body.deliverTo ?? null,
    items: lines,
    payment: { method: payment.method, approved: payment.method !== "pay-at-counter" },
    kitchen: { station: "kitchen-1", printStatus: "queued" },
    totals: { subtotalCents, taxCents, totalCents },
    estimatedReadyMinutes: 12,
  };
  state.orders.set(orderId, order);
  return order;
}

// Advance an order's status based on wall-clock time since creation, so the
// app can exercise its polling / status UI without a real kitchen.
function orderWithLiveStatus(order, now) {
  const elapsedSec = (now - order.createdAtMs) / 1000;
  let stage = ORDER_STATUS_STAGES[0];
  for (const s of ORDER_STATUS_STAGES) if (elapsedSec >= s.after) stage = s;
  const { createdAtMs, ...publicOrder } = order;
  return {
    ...publicOrder,
    status: stage.status,
    kitchen: { ...order.kitchen, printStatus: stage.printStatus },
  };
}

function rewardTickets(state, playerId, body, now) {
  const player = state.players.get(playerId);
  if (!player) {
    throw new ApiError(404, "PLAYER_NOT_FOUND", `No player with id "${playerId}".`);
  }
  if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 8) {
    throw new ApiError(400, "MISSING_IDEMPOTENCY_KEY", "idempotencyKey (string, >= 8 chars) is required.");
  }
  const idemKey = `${playerId}:${body.idempotencyKey}`;
  const prior = state.rewardIdempotency.get(idemKey);
  if (prior) return { ...prior, idempotent: true };

  const tickets = body.tickets;
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > MAX_TICKETS_PER_REWARD) {
    throw new ApiError(
      400,
      "INVALID_TICKET_AMOUNT",
      `tickets must be an integer between 1 and ${MAX_TICKETS_PER_REWARD}.`,
    );
  }
  if (typeof body.source !== "string" || body.source.length === 0) {
    throw new ApiError(400, "MISSING_SOURCE", 'source is required (e.g. "app-minigame").');
  }
  if (player.status !== "active") {
    throw new ApiError(409, "PLAYER_CARD_INACTIVE", `Player card is ${player.status}; cannot award tickets.`);
  }

  player.balances.tickets += tickets;
  const transactionId = `txn-${String(state.nextTxnNum++).padStart(4, "0")}`;
  player.recentActivity.unshift({
    transactionId,
    type: "ticket-reward",
    description: body.gameId ? `App reward — ${body.gameId}` : "App reward",
    tickets,
    occurredAt: new Date(now).toISOString(),
  });
  const result = {
    transactionId,
    playerId,
    ticketsAwarded: tickets,
    newTicketBalance: player.balances.tickets,
    awardedAt: new Date(now).toISOString(),
    idempotent: false,
  };
  state.rewardIdempotency.set(idemKey, result);
  return result;
}

function checkAuth(req) {
  const header = req.headers["authorization"] ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    throw new ApiError(401, "UNAUTHENTICATED", "Missing Authorization: Bearer <token> header.");
  }
  const token = match[1];
  // Magic token so the app can exercise its token-refresh path on demand.
  if (token === "expired-token") {
    throw new ApiError(401, "TOKEN_EXPIRED", "The access token has expired.");
  }
  const required = process.env.MOCK_API_TOKEN;
  if (required && token !== required) {
    throw new ApiError(403, "FORBIDDEN", "Token not authorized for this resource.");
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 256kb.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
}

// Returns { handler, resetState } — handler is a plain (req, res) function so
// tests can mount it on their own http.Server.
export function createMockApi() {
  let state = freshState();

  async function route(req, url, now) {
    const { pathname } = url;
    const send = (status, body) => ({ status, body });

    if (req.method === "GET" && pathname === "/api/v1/health") {
      return send(200, { ok: true, service: "mock-centeredge", time: new Date(now).toISOString() });
    }
    if (req.method === "POST" && pathname === "/api/v1/_mock/reset") {
      state = freshState();
      return send(200, { ok: true, reset: true });
    }

    // Everything below requires (mock) authentication.
    checkAuth(req);

    if (req.method === "GET" && pathname === "/api/v1/menu") {
      return send(200, { menu: state.menu });
    }

    if (req.method === "POST" && pathname === "/api/v1/orders") {
      const body = await readJsonBody(req);
      const order = buildOrder(state, body, now);
      return send(201, orderWithLiveStatus(order, now));
    }

    let m = /^\/api\/v1\/orders\/([^/]+)$/.exec(pathname);
    if (req.method === "GET" && m) {
      const order = state.orders.get(m[1]);
      if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", `No order with id "${m[1]}".`);
      return send(200, orderWithLiveStatus(order, now));
    }

    m = /^\/api\/v1\/players\/([^/]+)$/.exec(pathname);
    if (req.method === "GET" && m) {
      const player = state.players.get(m[1]);
      if (!player) throw new ApiError(404, "PLAYER_NOT_FOUND", `No player with id "${m[1]}".`);
      return send(200, player);
    }

    m = /^\/api\/v1\/players\/([^/]+)\/tickets\/reward$/.exec(pathname);
    if (req.method === "POST" && m) {
      const body = await readJsonBody(req);
      const result = rewardTickets(state, m[1], body, now);
      return send(result.idempotent ? 200 : 201, result);
    }

    throw new ApiError(404, "NOT_FOUND", `No route for ${req.method} ${pathname}.`);
  }

  async function handler(req, res) {
    // Permissive CORS so a Vite/Metro dev server can call this directly.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Mock-Delay, X-Mock-Fail");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    try {
      // Chaos knobs: X-Mock-Delay adds latency; X-Mock-Fail forces a status.
      const delay = Math.min(Number(req.headers["x-mock-delay"]) || 0, 10_000);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const forcedFail = Number(req.headers["x-mock-fail"]) || 0;
      if (forcedFail >= 400 && forcedFail <= 599) {
        throw new ApiError(forcedFail, "MOCK_FORCED_ERROR", `Forced ${forcedFail} via X-Mock-Fail header.`);
      }

      const url = new URL(req.url, "http://localhost");
      const { status, body } = await route(req, url, Date.now());
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body, null, 2));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      const payload = {
        error: {
          code: err instanceof ApiError ? err.code : "INTERNAL_ERROR",
          message: err instanceof ApiError ? err.message : "Unexpected mock server error.",
          ...(err instanceof ApiError && err.details ? { details: err.details } : {}),
        },
      };
      if (!(err instanceof ApiError)) console.error(err);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload, null, 2));
    }
  }

  return { handler, resetState: () => (state = freshState()) };
}
