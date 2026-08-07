// In-memory state for the CenterEdge mock. Everything lives in module-level
// maps seeded from data/*.json — restarting the process (or POST
// /api/v1/mock/reset) returns to the seed state. Deliberately no persistence:
// the mock exists so frontend/state work can proceed before real CenterEdge
// credentials arrive, and a throwaway store keeps test runs independent.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

const seedMenu = JSON.parse(readFileSync(join(dataDir, "menu.json"), "utf8"));
const seedPlayers = JSON.parse(readFileSync(join(dataDir, "players.json"), "utf8"));

export const menu = seedMenu;

/** playerId -> player record (mutable copy of the seed). */
export let players = new Map();

/** orderId -> order record. */
export let orders = new Map();

/** Ticket-reward audit log entries, newest last. */
export let rewardLog = [];

/** referenceId -> reward result, for idempotent replays of the same grant. */
export let rewardsByReference = new Map();

let orderCounter = 1000;

export function reset() {
  players = new Map(
    seedPlayers.map((p) => [
      p.playerId,
      { ...p, balances: { ...p.balances } },
    ])
  );
  orders = new Map();
  rewardLog = [];
  rewardsByReference = new Map();
  orderCounter = 1000;
}
reset();

/** Flat lookup of menu items by id (availability included). */
export const itemsById = new Map();
/** modifier option id -> { option, groupId, itemId } for price/validity checks. */
export const optionsById = new Map();
for (const cat of menu.categories) {
  for (const item of cat.items) {
    itemsById.set(item.id, item);
    for (const group of item.modifierGroups) {
      for (const opt of group.options) {
        optionsById.set(opt.id, { option: opt, group, itemId: item.id });
      }
    }
  }
}

export function nextOrderNumber() {
  orderCounter += 1;
  return orderCounter;
}

export function newId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

// Kitchen lifecycle: orders advance by wall-clock so the client can poll
// GET /api/v1/orders/:id and watch accepted -> in_kitchen -> ready.
// MOCK_KITCHEN_SECONDS compresses the timeline for demos/tests.
const KITCHEN_SECONDS = Number(process.env.MOCK_KITCHEN_SECONDS ?? 300);

export function orderStatus(order) {
  const elapsed = (Date.now() - order.placedAtMs) / 1000;
  if (elapsed >= KITCHEN_SECONDS) return "ready";
  if (elapsed >= KITCHEN_SECONDS / 10) return "in_kitchen";
  return "accepted";
}
