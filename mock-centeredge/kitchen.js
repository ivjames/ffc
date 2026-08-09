// The fake kitchen — a stateful simulation that services mobile F&B orders so
// fulfillment and tracking behave like a real kitchen instead of a stopwatch.
//
// Model: every order becomes a ticket that prints after a short delay, then
// waits for one of a fixed number of stations (cooks). Prep time depends on
// what's on the ticket, so a burst of pizza orders backs the queue up and
// later guests see honest, longer ETAs. Staff can "bump" a ticket from the
// KDS page (see kds.js): first bump = food's up (ready), second = handed to
// the guest (picked_up).
//
// The whole schedule (print / start / ready) is computed once at placement
// and status is DERIVED from the clock against it — same no-timers-to-leak
// property as the old elapsed-time formula, but load-aware. The only mutation
// after placement is a KDS bump. Unbumped tickets auto-complete a while after
// ready so the board (and the player's polling loop) always terminates.
import { MENU } from './seed.js';

// Demo time scale: tens of seconds, not real kitchen minutes, so a live
// walkthrough sees the whole lifecycle without waiting out a pizza.
export const PRINT_DELAY_MS = 4_000; // placed → ticket prints in the kitchen
export const AUTO_PICKUP_MS = 10 * 60_000; // ready → assumed collected if never bumped
export const EXTRA_UNIT_MS = 5_000; // each item unit past the first adds this
export const MAX_EXTRA_MS = 60_000; // …capped so a party order can't stall the demo

const CATEGORY_PREP_MS = {
  'cat-pizza': 45_000,
  'cat-burgers': 30_000,
  'cat-salads': 20_000,
  'cat-snacks': 12_000,
  'cat-drinks': 8_000,
  'cat-desserts': 10_000,
};
const DEFAULT_PREP_MS = 20_000;

const PREP_MS_BY_ITEM = new Map();
for (const cat of MENU.categories) {
  for (const item of cat.items) {
    PREP_MS_BY_ITEM.set(item.id, CATEGORY_PREP_MS[cat.id] ?? DEFAULT_PREP_MS);
  }
}

/** Per-app-instance kitchen state: when each station next comes free. */
export function freshKitchen(stationCount) {
  return { stationFreeAtMs: Array.from({ length: stationCount }, () => 0) };
}

/** How long one ticket occupies a station. The slowest line sets the base
 *  (sides cook alongside the pizza, not after it); every extra unit adds a
 *  little handling time, capped. */
export function prepDurationMs(lines) {
  let maxPrepMs = 0;
  let units = 0;
  for (const line of lines) {
    maxPrepMs = Math.max(maxPrepMs, PREP_MS_BY_ITEM.get(line.menuItemId) ?? DEFAULT_PREP_MS);
    units += line.quantity;
  }
  return maxPrepMs + Math.min((units - 1) * EXTRA_UNIT_MS, MAX_EXTRA_MS);
}

/** Assign the ticket to the station that frees up first and reserve it.
 *  Returns the ticket schedule stored on the order. */
export function scheduleTicket(kitchen, lines, nowMs) {
  const printedAtMs = nowMs + PRINT_DELAY_MS;
  let station = 0;
  for (let i = 1; i < kitchen.stationFreeAtMs.length; i++) {
    if (kitchen.stationFreeAtMs[i] < kitchen.stationFreeAtMs[station]) station = i;
  }
  const startAtMs = Math.max(printedAtMs, kitchen.stationFreeAtMs[station]);
  const readyAtMs = startAtMs + prepDurationMs(lines);
  kitchen.stationFreeAtMs[station] = readyAtMs;
  return {
    station: `station-${station + 1}`,
    printedAtMs,
    startAtMs,
    readyAtMs,
    pickedUpAtMs: null,
  };
}

/** Derive a ticket's status from the clock. `sent_to_kitchen` covers the
 *  printed-but-waiting-for-a-station window, so queue pressure is visible. */
export function ticketStatus(ticket, nowMs) {
  if (ticket.pickedUpAtMs != null) return 'picked_up';
  if (nowMs < ticket.printedAtMs) return 'received';
  if (nowMs < ticket.startAtMs) return 'sent_to_kitchen';
  if (nowMs < ticket.readyAtMs) return 'preparing';
  if (nowMs >= ticket.readyAtMs + AUTO_PICKUP_MS) return 'picked_up';
  return 'ready';
}

/** KDS bump: not yet ready → food's up now (ready); ready → handed to the
 *  guest (picked_up). Idempotent on a picked-up ticket, so a double-tap on
 *  the board is harmless. Bumping early does NOT reflow other tickets'
 *  station reservations — the sim never rewrites history, which errs toward
 *  longer (safer) player ETAs. Returns the status after the bump. */
export function bumpTicket(ticket, nowMs) {
  const status = ticketStatus(ticket, nowMs);
  if (status === 'picked_up') return 'picked_up';
  if (status === 'ready') {
    ticket.pickedUpAtMs = nowMs;
    return 'picked_up';
  }
  ticket.printedAtMs = Math.min(ticket.printedAtMs, nowMs);
  ticket.startAtMs = Math.min(ticket.startAtMs, nowMs);
  ticket.readyAtMs = nowMs;
  return 'ready';
}
