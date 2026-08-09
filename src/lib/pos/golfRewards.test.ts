import { describe, it, expect } from 'vitest';
import {
  golfTicketsFor,
  golfRewardKey,
  deviceOwnsSlot,
  GOLF_ACHIEVEMENT_TICKETS,
} from './golfRewards';

describe('golfTicketsFor', () => {
  it('prices the known achievements', () => {
    expect(golfTicketsFor('hole_in_one')).toBe(100);
    expect(golfTicketsFor('under_par')).toBe(50);
    expect(golfTicketsFor('hunt_master')).toBe(75);
  });

  it('is 0 for an unknown achievement', () => {
    expect(golfTicketsFor('nope')).toBe(0);
  });

  it('covers every server achievement key', () => {
    // Guards against a server achievement that silently earns nothing.
    for (const key of ['hole_in_one', 'under_par', 'hunt_master']) {
      expect(GOLF_ACHIEVEMENT_TICKETS[key]).toBeGreaterThan(0);
    }
  });
});

describe('deviceOwnsSlot', () => {
  it('credits every player in a single-device (non-shared) round', () => {
    for (const playerIndex of [0, 1, 2, 3]) {
      expect(deviceOwnsSlot({ deviceSlot: 0, isShared: false, playerIndex })).toBe(true);
    }
  });

  it('credits only this device’s own slot in a shared round', () => {
    expect(deviceOwnsSlot({ deviceSlot: 2, isShared: true, playerIndex: 2 })).toBe(true);
    expect(deviceOwnsSlot({ deviceSlot: 2, isShared: true, playerIndex: 0 })).toBe(false);
    expect(deviceOwnsSlot({ deviceSlot: 2, isShared: true, playerIndex: 3 })).toBe(false);
  });
});

describe('golfRewardKey', () => {
  it('is stable and unique per round/player/achievement', () => {
    expect(golfRewardKey('round-1', 0, 'hole_in_one')).toBe('golf:round-1:0:hole_in_one');
    // Same inputs → same key (idempotent replay); different inputs → different.
    expect(golfRewardKey('round-1', 0, 'hole_in_one')).toBe(
      golfRewardKey('round-1', 0, 'hole_in_one'),
    );
    expect(golfRewardKey('round-1', 0, 'hole_in_one')).not.toBe(
      golfRewardKey('round-1', 1, 'hole_in_one'),
    );
    expect(golfRewardKey('round-1', 0, 'hole_in_one')).not.toBe(
      golfRewardKey('round-2', 0, 'hole_in_one'),
    );
  });
});
