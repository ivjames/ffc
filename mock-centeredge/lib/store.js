// In-memory state for the mock CenterEdge API.
//
// A store is a plain object created per app instance (createStore()), so
// parallel test files get isolated state and a dev server can reset to seed
// data without a restart (POST /api/v1/_reset). Nothing persists — that's the
// point: this stands in for CenterEdge's cloud until real credentials arrive.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const seedMenu = JSON.parse(readFileSync(join(__dirname, "../data/menu.json"), "utf8"));
const seedPlayers = JSON.parse(readFileSync(join(__dirname, "../data/players.json"), "utf8"));

// Kitchen status pacing: how long a mock order sits in each state, so a
// polling frontend sees the full received → in_kitchen → ready progression
// without waiting real kitchen times.
export const ORDER_RECEIVED_MS = 15_000;
export const ORDER_IN_KITCHEN_MS = 45_000;

export function createStore() {
  const store = {
    menu: null,
    players: new Map(),
    orders: new Map(),
    // `${playerId}:${idempotencyKey}` -> the response body already returned,
    // so a retried reward call replays instead of double-crediting.
    rewardsByKey: new Map(),
    reset,
  };

  function reset() {
    store.menu = structuredClone(seedMenu);
    store.players.clear();
    for (const p of structuredClone(seedPlayers)) store.players.set(p.id, p);
    store.orders.clear();
    store.rewardsByKey.clear();
  }

  reset();
  return store;
}

export function newId(prefix) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

/** Flatten the menu into itemId -> item for order validation/pricing. */
export function itemIndex(menu) {
  const index = new Map();
  for (const cat of menu.categories) {
    for (const item of cat.items) index.set(item.id, item);
  }
  return index;
}

/** Kitchen status derived from the order's age — no timers to leak. */
export function orderStatus(order, now = Date.now()) {
  const age = now - order.createdAtMs;
  if (age < ORDER_RECEIVED_MS) {
    return { status: "received", printing: { kitchen: "queued" } };
  }
  if (age < ORDER_RECEIVED_MS + ORDER_IN_KITCHEN_MS) {
    return { status: "in_kitchen", printing: { kitchen: "printed" } };
  }
  return { status: "ready", printing: { kitchen: "printed" } };
}
