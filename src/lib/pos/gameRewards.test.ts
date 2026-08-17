import { describe, it, expect } from 'vitest';
import { resolveGameAward } from './gameRewards';

// The gating decision for game ticket awards — pure, so no network/DOM.

const base = {
  capabilities: { gameRewards: true },
  playerId: 'PL-1001',
  game: 'trivia',
  tickets: 25,
  sessionId: 'abc-123',
};

describe('resolveGameAward', () => {
  it('plans an award request when everything is in place', () => {
    const plan = resolveGameAward(base);
    expect(plan).toEqual({
      request: {
        tickets: 25,
        game: 'trivia',
        sessionId: 'abc-123',
      },
    });
  });

  it('skips when the venue has not bought gameRewards', () => {
    expect(resolveGameAward({ ...base, capabilities: { gameRewards: false } })).toEqual({
      skip: 'unavailable',
    });
  });

  it('skips when no card is linked', () => {
    expect(resolveGameAward({ ...base, playerId: null })).toEqual({ skip: 'no-card' });
  });

  it('skips zero or fractional tickets', () => {
    expect(resolveGameAward({ ...base, tickets: 0 })).toEqual({ skip: 'nothing' });
    expect(resolveGameAward({ ...base, tickets: 2.5 })).toEqual({ skip: 'nothing' });
  });
});
