import { describe, it, expect } from 'vitest';
import { deviceOwnsSlot } from './golfRewards';

// Ticket values now live server-side (server/lib/rewards.js achievementTickets),
// the trust boundary for golf payouts; the client only decides which players'
// achievements this device redeems.

describe('deviceOwnsSlot', () => {
  it('claims every player in a single-device (non-shared) round', () => {
    for (const playerIndex of [0, 1, 2, 3]) {
      expect(deviceOwnsSlot({ deviceSlot: 0, isShared: false, playerIndex })).toBe(true);
    }
  });

  it('claims only this device’s own slot in a shared round', () => {
    expect(deviceOwnsSlot({ deviceSlot: 2, isShared: true, playerIndex: 2 })).toBe(true);
    expect(deviceOwnsSlot({ deviceSlot: 2, isShared: true, playerIndex: 0 })).toBe(false);
    expect(deviceOwnsSlot({ deviceSlot: 2, isShared: true, playerIndex: 3 })).toBe(false);
  });
});
