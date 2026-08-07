import { describe, it, expect } from 'vitest';
import { lineKey, mergeLine, withQuantity, cartCount, type StoredCartLine } from './foodCart';

// Pure cart logic only — the localStorage-backed store itself is exercised
// through the UI (node env here, no DOM).

const pizza = { menuItemId: 'item-pizza-cheese', quantity: 1, modifierIds: ['mod-size-16'] };

describe('lineKey', () => {
  it('is stable across modifier order', () => {
    expect(lineKey({ ...pizza, modifierIds: ['a', 'b'] })).toBe(
      lineKey({ ...pizza, modifierIds: ['b', 'a'] }),
    );
  });

  it('differs when choices differ', () => {
    expect(lineKey(pizza)).not.toBe(lineKey({ ...pizza, modifierIds: ['mod-size-12'] }));
    expect(lineKey(pizza)).not.toBe(lineKey({ ...pizza, notes: 'well done' }));
  });
});

describe('mergeLine', () => {
  it('adds a new line', () => {
    const cart = mergeLine([], pizza);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(1);
  });

  it('bumps quantity for an identical line instead of duplicating', () => {
    const cart = mergeLine(mergeLine([], pizza), { ...pizza, quantity: 2 });
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
  });

  it('keeps different choices as separate lines', () => {
    const cart = mergeLine(mergeLine([], pizza), { ...pizza, modifierIds: ['mod-size-12'] });
    expect(cart).toHaveLength(2);
  });
});

describe('withQuantity', () => {
  const cart: StoredCartLine[] = mergeLine([], pizza);
  const key = cart[0].key;

  it('updates in place', () => {
    expect(withQuantity(cart, key, 5)[0].quantity).toBe(5);
  });

  it('removes at zero', () => {
    expect(withQuantity(cart, key, 0)).toHaveLength(0);
  });

  it('ignores unknown keys', () => {
    expect(withQuantity(cart, 'nope', 5)).toEqual(cart);
  });
});

describe('cartCount', () => {
  it('sums quantities across lines', () => {
    const cart = mergeLine(mergeLine([], { ...pizza, quantity: 2 }), {
      menuItemId: 'item-fountain',
      quantity: 3,
    });
    expect(cartCount(cart)).toBe(5);
  });
});
