import type { CartLine, Menu } from './types';

// Vendor-neutral pricing helpers shared by the food screens.

/** 2422 → "$24.22". All POS money is integer cents (USD). */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Client-side mirror of the POS's pricing (line unit+modifier prices, then
 *  tax) — the amount placeOrder expects in amountCents. The POS is the price
 *  authority and rejects a mismatch, so keep this in sync with the backend
 *  (mock-centeredge/app.js priceLine in dev; pinned by pricing.test.ts). */
export function orderTotals(
  menu: Menu,
  lines: CartLine[],
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const items = new Map(menu.categories.flatMap((c) => c.items).map((i) => [i.id, i]));
  let subtotalCents = 0;
  for (const line of lines) {
    const item = items.get(line.menuItemId);
    if (!item) throw new Error(`unknown menuItemId: ${line.menuItemId}`);
    const mods = new Map(
      item.modifierGroups.flatMap((g) => g.options).map((o) => [o.id, o.priceCents]),
    );
    const modTotal = (line.modifierIds ?? []).reduce((sum, id) => sum + (mods.get(id) ?? 0), 0);
    subtotalCents += (item.priceCents + modTotal) * line.quantity;
  }
  const taxCents = Math.round((subtotalCents * menu.taxRatePct) / 100);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}
