import { describe, expect, test } from 'vitest';
import { challengeProgress, mergeChallenge } from './challengesApi';
import type { ChallengeView } from './challengesApi';

// The initial GET and the SSE stream race whenever this screen opens. Both
// components of progress only ever move forward, so the newer state is simply
// the one further along.

const view = (over: {
  opponent?: boolean;
  myScore?: number | null;
  theirScore?: number | null;
  status?: 'open' | 'complete' | 'expired';
}): ChallengeView =>
  ({
    challenge: { status: over.status ?? 'open' },
    challenger: { score: over.myScore ?? null },
    opponent: over.opponent ? { score: over.theirScore ?? null } : null,
  }) as unknown as ChallengeView;

describe('challenge view ordering', () => {
  test('progress only increases as the challenge unfolds', () => {
    const stages = [
      view({}),
      view({ myScore: 100 }),
      view({ opponent: true, myScore: 100 }),
      view({ opponent: true, myScore: 100, theirScore: 200, status: 'complete' }),
    ].map(challengeProgress);
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
  });

  test('a slow initial fetch cannot undo an opponent the stream already delivered', () => {
    const streamed = view({ opponent: true, myScore: 100 });
    const staleFetch = view({ myScore: 100 });
    expect(mergeChallenge(streamed, staleFetch)).toBe(streamed);
  });

  test('a completed result is never replaced by an open one', () => {
    const done = view({ opponent: true, myScore: 100, theirScore: 200, status: 'complete' });
    expect(mergeChallenge(done, view({ opponent: true, myScore: 100 }))).toBe(done);
  });

  test('genuinely newer state is accepted', () => {
    const open = view({ myScore: 100 });
    const joined = view({ opponent: true, myScore: 100 });
    expect(mergeChallenge(open, joined)).toBe(joined);
  });
});
