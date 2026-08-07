import { useSyncExternalStore } from 'react';
import type { CartLine } from './centeredgeApi';

// F&B cart — the client-side state behind /food. Same store idiom as
// lib/location.ts: module-level value, localStorage persistence (best-effort),
// useSyncExternalStore hook. The pure merge/update helpers are exported
// separately so they're unit-testable without a DOM.
//
// A "line" is (menuItemId + modifier set + notes): adding the same item with
// the same choices bumps quantity; different toppings make a separate line.

export type StoredCartLine = CartLine & { key: string };

const KEY = 'ffc.foodCart';
const listeners = new Set<() => void>();

/** Stable identity for a cart line — same item + same choices = same line. */
export function lineKey(line: CartLine): string {
  const mods = [...(line.modifierIds ?? [])].sort().join(',');
  return `${line.menuItemId}|${mods}|${line.notes ?? ''}`;
}

/** Add a line to the cart, merging quantities into an existing identical line. */
export function mergeLine(lines: StoredCartLine[], line: CartLine): StoredCartLine[] {
  const key = lineKey(line);
  const existing = lines.find((l) => l.key === key);
  if (!existing) return [...lines, { ...line, key }];
  return lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + line.quantity } : l));
}

/** Set a line's quantity; 0 (or less) removes it. */
export function withQuantity(lines: StoredCartLine[], key: string, quantity: number): StoredCartLine[] {
  if (quantity < 1) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, quantity } : l));
}

export function cartCount(lines: StoredCartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

// ---- store ----------------------------------------------------------------

let cart: StoredCartLine[] = readStored();

function readStored(): StoredCartLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is StoredCartLine =>
        !!l && typeof l === 'object' && typeof (l as StoredCartLine).key === 'string',
    );
  } catch {
    return [];
  }
}

function commit(next: StoredCartLine[]): void {
  cart = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    // Non-fatal: the cart just won't survive a reload.
  }
  listeners.forEach((notify) => notify());
}

export function getCart(): StoredCartLine[] {
  return cart;
}

export function addToCart(line: CartLine): void {
  commit(mergeLine(cart, line));
}

export function setLineQuantity(key: string, quantity: number): void {
  commit(withQuantity(cart, key, quantity));
}

export function clearCart(): void {
  commit([]);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Reactive cart contents — re-renders on any cart change. */
export function useCart(): StoredCartLine[] {
  return useSyncExternalStore(subscribe, getCart, getCart);
}
