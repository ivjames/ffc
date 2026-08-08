import { describe, it, expect } from 'vitest';
import { orderTotals, formatCents } from './pricing';
import type { Menu } from './types';

// orderTotals must mirror the POS's pricing exactly (mock-centeredge/app.js
// priceLine + tax) — POST /orders rejects a mismatched amount, so this is the
// contract keeping checkout's "Pay $X" honest.

const menu: Menu = {
  menuId: 'm',
  name: 'Test',
  currency: 'USD',
  taxRatePct: 7.75,
  categories: [
    {
      id: 'c1',
      name: 'Pizza',
      sortOrder: 1,
      items: [
        {
          id: 'item-pizza',
          name: 'Cheese Pizza',
          description: '',
          priceCents: 1299,
          imageUrl: null,
          available: true,
          modifierGroups: [
            {
              id: 'g-size',
              name: 'Size',
              required: true,
              minSelect: 1,
              maxSelect: 1,
              options: [
                { id: 'size-12', name: '12"', priceCents: 0 },
                { id: 'size-16', name: '16"', priceCents: 400 },
              ],
            },
            {
              id: 'g-top',
              name: 'Toppings',
              required: false,
              minSelect: 0,
              maxSelect: 5,
              options: [{ id: 'top-pep', name: 'Pepperoni', priceCents: 150 }],
            },
          ],
        },
        {
          id: 'item-drink',
          name: 'Drink',
          description: '',
          priceCents: 299,
          imageUrl: null,
          available: true,
          modifierGroups: [],
        },
      ],
    },
  ],
};

describe('orderTotals', () => {
  it('prices items + modifiers × quantity and rounds tax like the server', () => {
    // (1299+400+150) + (299×2) = 2447; tax round(2447×7.75%) = 190.
    const t = orderTotals(menu, [
      { menuItemId: 'item-pizza', quantity: 1, modifierIds: ['size-16', 'top-pep'] },
      { menuItemId: 'item-drink', quantity: 2 },
    ]);
    expect(t.subtotalCents).toBe(2447);
    expect(t.taxCents).toBe(190);
    expect(t.totalCents).toBe(2637);
  });

  it('throws on an unknown item (cart drift bug, not a user error)', () => {
    expect(() => orderTotals(menu, [{ menuItemId: 'nope', quantity: 1 }])).toThrow();
  });
});

describe('formatCents', () => {
  it('renders dollars', () => {
    expect(formatCents(2637)).toBe('$26.37');
    expect(formatCents(0)).toBe('$0.00');
  });
});
