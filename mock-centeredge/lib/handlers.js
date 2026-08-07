// Route handlers for the CenterEdge mock. Shapes here are our best guess at
// the real Advantage Web Services contracts (menu/orders for F&B, players/
// tickets for the loyalty card database) — kept in one place so that when the
// real API docs arrive, the deltas are edits to this file plus the seed JSON,
// and the frontend client code stays put.
import {
  menu,
  players,
  orders,
  rewardLog,
  rewardsByReference,
  itemsById,
  optionsById,
  nextOrderNumber,
  newId,
  orderStatus,
  reset,
} from "./store.js";

// The real integration will hand out a bearer token per venue. The mock
// accepts any non-empty token by default so the frontend is forced to wire
// the Authorization header now; set MOCK_API_TOKEN to require an exact match.
export function checkAuth(req) {
  const header = req.headers["authorization"] ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return { ok: false, error: "missing bearer token" };
  const expected = process.env.MOCK_API_TOKEN;
  if (expected && match[1] !== expected) return { ok: false, error: "invalid token" };
  return { ok: true };
}

const MAX_TICKETS_PER_REWARD = 10000;
const MAX_QTY_PER_LINE = 20;

function taxCents(subtotalCents) {
  return Math.round((subtotalCents * menu.taxRatePercent) / 100);
}

// ---------------------------------------------------------------------------
// GET /api/v1/menu
export function getMenu() {
  return { status: 200, body: menu };
}

// ---------------------------------------------------------------------------
// POST /api/v1/orders
// Prices are computed server-side from the menu — the client's cart never
// dictates money. Invalid lines fail the whole order (422) so the app has to
// re-sync its menu instead of silently dropping items from a guest's order.
export function createOrder(body) {
  if (!body || typeof body !== "object") {
    return err(400, "invalid_body", "JSON object body required");
  }
  const { playerId, guestName, items, payment, tipCents } = body;

  if (playerId !== undefined && !players.has(playerId)) {
    return err(422, "unknown_player", `player ${playerId} not found`);
  }
  if (!playerId && (typeof guestName !== "string" || guestName.trim() === "")) {
    return err(422, "guest_name_required", "guestName is required when no playerId is given");
  }
  if (!Array.isArray(items) || items.length === 0) {
    return err(422, "empty_order", "items must be a non-empty array");
  }
  if (tipCents !== undefined && (!Number.isInteger(tipCents) || tipCents < 0)) {
    return err(422, "invalid_tip", "tipCents must be a non-negative integer");
  }

  let subtotalCents = 0;
  const lines = [];
  for (const [i, line] of items.entries()) {
    const item = itemsById.get(line?.itemId);
    if (!item) return err(422, "unknown_item", `items[${i}].itemId ${line?.itemId} not on menu`);
    if (!item.available) return err(422, "item_unavailable", `${item.name} is sold out`);
    const qty = line.quantity ?? 1;
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      return err(422, "invalid_quantity", `items[${i}].quantity must be 1..${MAX_QTY_PER_LINE}`);
    }

    const chosen = line.modifiers ?? [];
    if (!Array.isArray(chosen)) return err(422, "invalid_modifiers", `items[${i}].modifiers must be an array of option ids`);
    let unitCents = item.priceCents;
    const perGroup = new Map();
    for (const optId of chosen) {
      const found = optionsById.get(optId);
      if (!found || found.itemId !== item.id) {
        return err(422, "unknown_modifier", `option ${optId} is not valid for ${item.name}`);
      }
      unitCents += found.option.priceCents;
      perGroup.set(found.group.id, (perGroup.get(found.group.id) ?? 0) + 1);
    }
    for (const group of item.modifierGroups) {
      const count = perGroup.get(group.id) ?? 0;
      if (group.required && count < group.minSelections) {
        return err(422, "modifier_required", `${item.name}: choose at least ${group.minSelections} from "${group.name}"`);
      }
      if (count > group.maxSelections) {
        return err(422, "too_many_modifiers", `${item.name}: at most ${group.maxSelections} from "${group.name}"`);
      }
    }

    subtotalCents += unitCents * qty;
    lines.push({
      itemId: item.id,
      name: item.name,
      quantity: qty,
      modifiers: chosen,
      unitPriceCents: unitCents,
      lineTotalCents: unitCents * qty,
      notes: typeof line.notes === "string" ? line.notes.slice(0, 500) : undefined,
    });
  }

  const tax = taxCents(subtotalCents);
  const tip = tipCents ?? 0;
  const totalCents = subtotalCents + tax + tip;

  // Payment. `tokenized_card` trusts any token string (there's no real
  // processor behind the mock); `stored_value` actually debits the player's
  // card balance so the app can exercise the insufficient-funds path.
  const method = payment?.method;
  if (method === "tokenized_card") {
    if (typeof payment.token !== "string" || payment.token === "") {
      return err(422, "missing_payment_token", "payment.token required for tokenized_card");
    }
  } else if (method === "stored_value") {
    if (!playerId) return err(422, "player_required", "stored_value payment requires playerId");
    const player = players.get(playerId);
    if (player.balances.storedValueCents < totalCents) {
      return err(402, "insufficient_funds", `card balance ${player.balances.storedValueCents} < total ${totalCents}`);
    }
    player.balances.storedValueCents -= totalCents;
  } else {
    return err(422, "invalid_payment_method", 'payment.method must be "tokenized_card" or "stored_value"');
  }

  const order = {
    orderId: newId("ORD"),
    orderNumber: nextOrderNumber(),
    locationId: menu.locationId,
    playerId: playerId ?? null,
    guestName: playerId ? players.get(playerId).displayName : guestName.trim(),
    lines,
    totals: { subtotalCents, taxCents: tax, tipCents: tip, totalCents },
    payment: { method, status: "captured" },
    kitchen: { printed: true, station: "main-kitchen" },
    placedAt: new Date().toISOString(),
    placedAtMs: Date.now(),
  };
  orders.set(order.orderId, order);

  return {
    status: 201,
    body: {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      status: "accepted",
      kitchen: order.kitchen,
      estimatedReadyMinutes: 12,
      totals: order.totals,
      placedAt: order.placedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/orders/{id} — poll for kitchen progress.
export function getOrder(orderId) {
  const order = orders.get(orderId);
  if (!order) return err(404, "order_not_found", `order ${orderId} not found`);
  const { placedAtMs, ...rest } = order;
  return { status: 200, body: { ...rest, status: orderStatus(order) } };
}

// ---------------------------------------------------------------------------
// GET /api/v1/players/{id}
export function getPlayer(playerId) {
  const player = players.get(playerId);
  if (!player) return err(404, "player_not_found", `player ${playerId} not found`);
  return { status: 200, body: player };
}

// ---------------------------------------------------------------------------
// POST /api/v1/players/{id}/tickets/reward
// Simulates secure ticket injection. `referenceId` is the idempotency key:
// the app generates one per game result, so a retried request (flaky mobile
// network) can never double-award. Replays return the original result with
// `duplicate: true`.
export function rewardTickets(playerId, body) {
  const player = players.get(playerId);
  if (!player) return err(404, "player_not_found", `player ${playerId} not found`);
  if (!body || typeof body !== "object") {
    return err(400, "invalid_body", "JSON object body required");
  }
  const { tickets, source, referenceId, note } = body;
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > MAX_TICKETS_PER_REWARD) {
    return err(422, "invalid_tickets", `tickets must be an integer 1..${MAX_TICKETS_PER_REWARD}`);
  }
  if (typeof source !== "string" || source.trim() === "") {
    return err(422, "source_required", 'source is required (e.g. "minigame:putt-streak", "promo:birthday")');
  }
  if (typeof referenceId !== "string" || referenceId.trim() === "" || referenceId.length > 200) {
    return err(422, "reference_required", "referenceId (idempotency key) is required, max 200 chars");
  }

  const existing = rewardsByReference.get(referenceId);
  if (existing) {
    return { status: 200, body: { ...existing, duplicate: true } };
  }

  player.balances.ticketCount += tickets;
  const result = {
    rewardId: newId("RWD"),
    playerId,
    ticketsAwarded: tickets,
    newTicketCount: player.balances.ticketCount,
    source: source.trim(),
    referenceId,
    note: typeof note === "string" ? note.slice(0, 500) : undefined,
    awardedAt: new Date().toISOString(),
  };
  rewardsByReference.set(referenceId, result);
  rewardLog.push(result);
  return { status: 201, body: result };
}

// ---------------------------------------------------------------------------
// GET /api/v1/players/{id}/tickets/history — audit trail of mock rewards.
export function ticketHistory(playerId) {
  if (!players.has(playerId)) return err(404, "player_not_found", `player ${playerId} not found`);
  return {
    status: 200,
    body: rewardLog.filter((r) => r.playerId === playerId),
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/mock/reset — test hook, restores seed state.
export function mockReset() {
  reset();
  return { status: 200, body: { ok: true } };
}

function err(status, code, message) {
  return { status, body: { error: { code, message } } };
}
