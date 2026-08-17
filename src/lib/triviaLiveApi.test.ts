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

describe('the room within one phase', () => {
  // The lobby is a single phase that a whole room joins during, so index and
  // status can't order these frames at all — and every screen opens with a
  // fetch racing the stream that is already delivering joiners.
  const room = (entrantCount: number, answeredCount = 0, status: TriviaStatus = 'lobby') =>
    ({
      session: { currentIndex: 0, status },
      entrantCount,
      answeredCount,
      myAnswer: null,
    }) as unknown as TriviaSnapshot;

  test('a slower fetch cannot take a joiner back off the board', () => {
    const withJoiner = room(4);
    expect(mergeSnapshot(withJoiner, room(3))).toBe(withJoiner);
  });

  test('a new joiner still lands', () => {
    expect(mergeSnapshot(room(3), room(4)).entrantCount).toBe(4);
  });

  test('a slower fetch cannot unwind the answered counter', () => {
    const counted = room(4, 3, 'question');
    expect(mergeSnapshot(counted, room(4, 1, 'question'))).toBe(counted);
    expect(mergeSnapshot(counted, room(4, 4, 'question')).answeredCount).toBe(4);
  });

  test('a personalized refetch still delivers the result it went for', () => {
    // The refetch is participant-scoped and may be built a moment before a
    // late joiner lands, so it can be behind on the ROOM while holding the
    // only copy of this phone's correctness. Folding the two halves separately
    // is what keeps both.
    const roomAhead = {
      ...room(5, 4, 'reveal'),
      myAnswer: { choice: 2 },
    } as unknown as TriviaSnapshot;
    const personalized = {
      ...room(4, 4, 'reveal'),
      myAnswer: { choice: 2, correct: true, points: 130 },
    } as unknown as TriviaSnapshot;
    const merged = mergeSnapshot(roomAhead, personalized);
    expect(merged.entrantCount).toBe(5);
    expect(merged.myAnswer).toEqual({ choice: 2, correct: true, points: 130 });
  });
});
