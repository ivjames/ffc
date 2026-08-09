import { describe, it, expect } from 'vitest';
import { orderStatusNotification } from './orderNotifications';
import type { OrderStatus } from './pos/types';

// Pure notification copy only — the DOM-side bits (Notification API, service
// worker, sound/haptic) are exercised in the browser, not here.

describe('orderStatusNotification', () => {
  it('announces every forward transition with the order number', () => {
    const changing: OrderStatus[] = ['sent_to_kitchen', 'preparing', 'ready', 'picked_up'];
    for (const status of changing) {
      const copy = orderStatusNotification(status, 1234);
      expect(copy).not.toBeNull();
      expect(copy!.title).toContain('1234');
      expect(copy!.body.length).toBeGreaterThan(0);
    }
  });

  it('does not announce the initial received state (it is the order landing, not a change)', () => {
    expect(orderStatusNotification('received', 1234)).toBeNull();
  });

  it('calls out the ready state distinctly in the title', () => {
    const ready = orderStatusNotification('ready', 7);
    expect(ready!.title.toLowerCase()).toContain('ready');
  });
});
