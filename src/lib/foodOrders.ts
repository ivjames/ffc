import { useSyncExternalStore } from 'react';

// Recently placed F&B orders — remembered on-device so an in-flight order
// stays reachable after leaving the status screen (the order id otherwise
// lives only in the /food/order/:id URL). Checkout records each successful
// order; the Food screen and Home surface the ones still likely in the
// kitchen. Same store idiom as lib/foodCart.ts, with the pure helpers
// exported for unit tests.

export type PlacedOrder = {
  id: string;
  orderNumber: number;
  totalCents: number;
  /** ISO timestamp from the order (server clock). */
  createdAt: string;
};

/** How long after placement an order still counts as "active" — generous vs.
 *  real kitchen times so a slow rush doesn't hide a live order. */
export const ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

const MAX_REMEMBERED = 5;

/** Prepend an order, dropping any prior copy and the oldest overflow. */
export function withOrder(orders: PlacedOrder[], order: PlacedOrder): PlacedOrder[] {
  return [order, ...orders.filter((o) => o.id !== order.id)].slice(0, MAX_REMEMBERED);
}

/** Orders recent enough to plausibly still be in the kitchen, newest first.
 *  An unparseable createdAt counts as expired rather than sticking forever. */
export function activeOrders(orders: PlacedOrder[], now = Date.now()): PlacedOrder[] {
  return orders.filter((o) => {
    const placedAt = Date.parse(o.createdAt);
    return Number.isFinite(placedAt) && now - placedAt < ACTIVE_WINDOW_MS;
  });
}

// ---- store ----------------------------------------------------------------

const KEY = 'ffc.foodOrders';
const listeners = new Set<() => void>();

let orders: PlacedOrder[] = readStored();

function readStored(): PlacedOrder[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (o): o is PlacedOrder =>
        !!o &&
        typeof o === 'object' &&
        typeof (o as PlacedOrder).id === 'string' &&
        typeof (o as PlacedOrder).createdAt === 'string',
    );
  } catch {
    return [];
  }
}

function commit(next: PlacedOrder[]): void {
  orders = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(orders));
  } catch {
    // Non-fatal: the order list just won't survive a reload.
  }
  listeners.forEach((notify) => notify());
}

export function getPlacedOrders(): PlacedOrder[] {
  return orders;
}

export function recordOrder(order: PlacedOrder): void {
  commit(withOrder(orders, order));
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Reactive list of remembered orders — re-renders when one is recorded. */
export function usePlacedOrders(): PlacedOrder[] {
  return useSyncExternalStore(subscribe, getPlacedOrders, getPlacedOrders);
}
