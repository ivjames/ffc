import { describe, it, expect } from 'vitest';
import { resolveBonusClaim, wasAttempted, markAttempted } from './adoptionBonus';

// Pure gating only — the network claim + one-shot storage are exercised in the
// app (node env here, no DOM).

describe('resolveBonusClaim', () => {
  it('skips when the venue has no ticket-reward add-on', () => {
    expect(resolveBonusClaim({ capabilities: { gameRewards: false }, playerId: 'PL-1', kind: 'install' })).toEqual({
      skip: 'unavailable',
    });
  });

  it('skips with no-card when the venue offers it but no card is linked', () => {
    expect(resolveBonusClaim({ capabilities: { gameRewards: true }, playerId: null, kind: 'signin' })).toEqual({
      skip: 'no-card',
    });
  });

  it('plans a request when the add-on is on and a card is linked', () => {
    expect(resolveBonusClaim({ capabilities: { gameRewards: true }, playerId: 'PL-9', kind: 'install' })).toEqual({
      request: { kind: 'install' },
    });
  });
});

describe('the attempt guard is scoped to (kind, venue, card)', () => {
  it("doesn't leak across venue or card — so switching either re-attempts", () => {
    markAttempted('install', 'loc-a', 'PL-1');
    expect(wasAttempted('install', 'loc-a', 'PL-1')).toBe(true);
    // Different venue, different card, or different kind are all still open.
    expect(wasAttempted('install', 'loc-b', 'PL-1')).toBe(false);
    expect(wasAttempted('install', 'loc-a', 'PL-2')).toBe(false);
    expect(wasAttempted('signin', 'loc-a', 'PL-1')).toBe(false);
    // No linked card is its own bucket (re-attempts once a card links).
    expect(wasAttempted('install', 'loc-a', null)).toBe(false);
  });
});
