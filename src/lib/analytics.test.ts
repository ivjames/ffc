import { describe, it, expect } from 'vitest';
import { withEvent, nextBatch, QUEUE_CAP, type QueuedEvent } from './analytics';

// Pure queue logic only — the localStorage-backed store and the network flush
// are exercised through the app (node env here, no DOM), same as foodOrders.

let n = 0;
const ev = (name: QueuedEvent['name']): QueuedEvent => ({ id: `id-${n++}`, name });

describe('withEvent', () => {
  it('appends in order (oldest first, so a funnel reads chronologically)', () => {
    const q = withEvent(withEvent([], ev('signin_started')), ev('signin_completed'));
    expect(q.map((e) => e.name)).toEqual(['signin_started', 'signin_completed']);
  });

  it('drops the oldest overflow past the cap', () => {
    let q: QueuedEvent[] = [];
    for (let i = 0; i < QUEUE_CAP + 5; i++)
      q = withEvent(q, { id: `id-${i}`, name: 'app_launch_standalone', meta: { i } });
    expect(q.length).toBe(QUEUE_CAP);
    // The first 5 were dropped; the queue now starts at i=5.
    expect((q[0].meta as { i: number }).i).toBe(5);
    expect((q[q.length - 1].meta as { i: number }).i).toBe(QUEUE_CAP + 4);
  });
});

describe('nextBatch', () => {
  it('takes at most the server-sized batch and never mutates the queue', () => {
    const q = Array.from({ length: 60 }, () => ev('install_prompt_shown'));
    const batch = nextBatch(q);
    expect(batch.length).toBe(50);
    expect(q.length).toBe(60); // untouched
  });

  it('returns everything when under the batch size', () => {
    const q = [ev('install_accepted'), ev('app_installed')];
    expect(nextBatch(q)).toHaveLength(2);
  });
});
