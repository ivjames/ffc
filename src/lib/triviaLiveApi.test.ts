import { describe, expect, test } from 'vitest';
import { isFresh, progressOf } from './triviaLiveApi';
import type { TriviaSnapshot, TriviaStatus } from './triviaLiveApi';

// Frame ordering. An answer's broadcast and the host's advance are ordered
// against each other in the database, but their SSE publishes are not — so a
// slow "question" frame can land after the "reveal" that superseded it. The
// client is the only place that can actually drop it.

const snap = (currentIndex: number, status: TriviaStatus): TriviaSnapshot =>
  ({ session: { currentIndex, status } }) as TriviaSnapshot;

describe('frame ordering', () => {
  test('progress increases through a question and across questions', () => {
    const order = [
      snap(0, 'lobby'),
      snap(0, 'question'),
      snap(0, 'reveal'),
      snap(1, 'question'),
      snap(1, 'reveal'),
      snap(2, 'final'),
    ].map(progressOf);
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
  });

  test('a late question frame does not supersede the reveal it lost to', () => {
    expect(isFresh(snap(0, 'reveal'), snap(0, 'question'))).toBe(false);
  });

  test('genuine forward movement is always accepted', () => {
    expect(isFresh(snap(0, 'question'), snap(0, 'reveal'))).toBe(true);
    expect(isFresh(snap(0, 'reveal'), snap(1, 'question'))).toBe(true);
    expect(isFresh(null, snap(0, 'lobby'))).toBe(true);
  });

  test('a repeat of the current phase still renders (the answered counter moves)', () => {
    // Equal progress must pass: most frames in a question are the same phase
    // with a new "N of M answered" count.
    expect(isFresh(snap(0, 'question'), snap(0, 'question'))).toBe(true);
  });
});
