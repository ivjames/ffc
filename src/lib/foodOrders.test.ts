import { describe, it, expect } from 'vitest';
import {
  withOrder,
  withoutOrder,
  activeOrders,
  ACTIVE_WINDOW_MS,
  type PlacedOrder,
} from './foodOrders';

// Pure order-list logic only — the localStorage-backed store itself is
// exercised through the UI (node env here, no DOM).

const NOW = Date.parse('2026-08-09T12:00:00Z');

function order(overrides: Partial<PlacedOrder>): PlacedOrder {
  return {
    id: 'ord-1',
    orderNumber: 1001,
    totalCents: 2422,
    locationId: 'loc-a',
    createdAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe('withOrder', () => {
  it('prepends newest first', () => {
    const list = withOrder([order({ id: 'ord-1' })], order({ id: 'ord-2' }));
    expect(list.map((o) => o.id)).toEqual(['ord-2', 'ord-1']);
  });

  it('replaces a prior copy of the same order instead of duplicating', () => {
    const list = withOrder([order({ id: 'ord-1', orderNumber: 1001 })], order({ id: 'ord-1', orderNumber: 1002 }));
    expect(list).toHaveLength(1);
    expect(list[0].orderNumber).toBe(1002);
  });

  it('caps the remembered list at 5', () => {
    let list: PlacedOrder[] = [];
    for (let i = 0; i < 7; i++) list = withOrder(list, order({ id: `ord-${i}` }));
    expect(list).toHaveLength(5);
    expect(list[0].id).toBe('ord-6');
    expect(list.at(-1)?.id).toBe('ord-2');
  });
});

describe('withoutOrder', () => {
  it('drops the matching order and leaves the rest (self-heal after a 404)', () => {
    const list = [order({ id: 'a' }), order({ id: 'b' })];
    expect(withoutOrder(list, 'a').map((o) => o.id)).toEqual(['b']);
  });

  it('is a no-op when the id is absent', () => {
    const list = [order({ id: 'a' })];
    expect(withoutOrder(list, 'nope')).toHaveLength(1);
  });
});

describe('activeOrders', () => {
  it('keeps orders inside the active window and drops older ones', () => {
    const fresh = order({ id: 'fresh', createdAt: new Date(NOW - 60_000).toISOString() });
    const stale = order({
      id: 'stale',
      createdAt: new Date(NOW - ACTIVE_WINDOW_MS - 1).toISOString(),
    });
    expect(activeOrders([fresh, stale], 'loc-a', NOW)).toEqual([fresh]);
  });

  it('only surfaces orders from the given venue', () => {
    const here = order({ id: 'here', locationId: 'loc-a' });
    const elsewhere = order({ id: 'elsewhere', locationId: 'loc-b' });
    expect(activeOrders([here, elsewhere], 'loc-a', NOW)).toEqual([here]);
    expect(activeOrders([here, elsewhere], 'loc-b', NOW)).toEqual([elsewhere]);
  });

  it('treats an unparseable createdAt as expired', () => {
    expect(activeOrders([order({ createdAt: 'not-a-date' })], 'loc-a', NOW)).toEqual([]);
  });
});
