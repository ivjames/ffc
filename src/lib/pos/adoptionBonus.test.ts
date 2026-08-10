import { describe, it, expect } from 'vitest';
import { resolveBonusClaim } from './adoptionBonus';

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
      request: { playerId: 'PL-9', kind: 'install' },
    });
  });
});
