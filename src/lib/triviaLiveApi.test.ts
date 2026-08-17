import { describe, expect, test } from 'vitest';
import { isFresh, mergeSnapshot, progressOf } from './triviaLiveApi';
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

describe('merging frames', () => {
  const withAnswer = (currentIndex: number, status: TriviaStatus, myAnswer: unknown) =>
    ({ session: { currentIndex, status }, myAnswer }) as unknown as TriviaSnapshot;

  test('a viewer-neutral frame does not wipe this phone\'s reveal result', () => {
    // Broadcast frames always carry myAnswer: null — that is "I know nothing
    // about you", not "you didn't answer". A late answer from anyone else in
    // the room produces one at equal progress, and assigning it wholesale left
    // the player permanently reading "didn't answer in time".
    const personalized = withAnswer(0, 'reveal', { choice: 2, correct: true, points: 130 });
    const neutral = withAnswer(0, 'reveal', null);
    expect(mergeSnapshot(personalized, neutral).myAnswer).toEqual({
      choice: 2,
      correct: true,
      points: 130,
    });
  });

  test('a new question does clear the previous answer', () => {
    const personalized = withAnswer(0, 'reveal', { choice: 2, correct: true });
    const nextQuestion = withAnswer(1, 'question', null);
    expect(mergeSnapshot(personalized, nextQuestion).myAnswer).toBeNull();
  });

  test('a stale frame is rejected outright', () => {
    const revealed = withAnswer(0, 'reveal', { choice: 1, correct: false });
    const lateQuestion = withAnswer(0, 'question', null);
    expect(mergeSnapshot(revealed, lateQuestion)).toBe(revealed);
  });
});
