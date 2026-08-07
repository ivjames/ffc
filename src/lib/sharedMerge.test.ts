import { describe, expect, test } from 'vitest';
import {
  lwwWins,
  applyRemoteCell,
  applyLocalStroke,
  applyPlayerJoined,
  applyCompleted,
  applySnapshot,
  createSharedLocalRound,
  type GameSnapshot,
  type RemoteCell,
} from './sharedMerge';
import type { LocalRound } from '../types';

const GAME = 'g-1';

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    game: {
      id: GAME,
      joinCode: 'ABC234',
      courseId: 'course-1',
      teamId: null,
      status: 'open',
      roundId: null,
    },
    players: [
      { slot: 0, tag: 'AAA', userId: 'u1', displayName: null },
      { slot: 1, tag: 'BBB', userId: null, displayName: null },
    ],
    scores: [],
    ...overrides,
  };
}

function freshRound(): LocalRound {
  return createSharedLocalRound(snapshot(), 'me-token', 0);
}

describe('createSharedLocalRound', () => {
  test('mirrors the snapshot roster and identity', () => {
    const round = freshRound();
    expect(round.clientId).toBe(`shared:${GAME}`);
    expect(round.playerTags).toEqual(['AAA', 'BBB']);
    expect(round.shared?.participantToken).toBe('me-token');
    expect(round.syncState).toBe('active');
  });
});

describe('lwwWins', () => {
  test('newer ts wins; participant id breaks ties; equal loses', () => {
    expect(lwwWins(2, 'a', 1, 'z')).toBe(true);
    expect(lwwWins(1, 'z', 2, 'a')).toBe(false);
    expect(lwwWins(1, 'b', 1, 'a')).toBe(true);
    expect(lwwWins(1, 'a', 1, 'b')).toBe(false);
    expect(lwwWins(1, 'a', 1, 'a')).toBe(false); // exact replay is a no-op
  });
});

describe('applyRemoteCell', () => {
  test('writes an untouched cell and rejects an older one', () => {
    let round = freshRound();
    const next = applyRemoteCell(round, { slot: 1, hole: 3, strokes: 4, ts: 100, by: 'other' });
    expect(next).not.toBeNull();
    round = next!;
    expect(round.scores[1][2]).toBe(4);
    // Older write for the same cell: rejected.
    expect(applyRemoteCell(round, { slot: 1, hole: 3, strokes: 9, ts: 99, by: 'zzz' })).toBeNull();
    // Newer write: wins, including a clear (null).
    const cleared = applyRemoteCell(round, { slot: 1, hole: 3, strokes: null, ts: 101, by: 'other' });
    expect(cleared!.scores[1][2]).toBeNull();
  });

  test('local tap then remote echo of that tap is a no-op', () => {
    let round = freshRound();
    round = applyLocalStroke(round, 0, 5, 3, 500);
    const echo: RemoteCell = { slot: 0, hole: 6, strokes: 3, ts: 500, by: 'me-token' };
    expect(applyRemoteCell(round, echo)).toBeNull();
  });
});

describe('convergence', () => {
  test('the same writes in any order produce the same grid', () => {
    const writes: RemoteCell[] = [
      { slot: 0, hole: 1, strokes: 2, ts: 10, by: 'a' },
      { slot: 0, hole: 1, strokes: 5, ts: 12, by: 'b' },
      { slot: 0, hole: 1, strokes: 3, ts: 12, by: 'c' }, // ts tie -> 'c' beats 'b'
      { slot: 1, hole: 1, strokes: 4, ts: 11, by: 'a' },
      { slot: 1, hole: 18, strokes: null, ts: 9, by: 'b' },
      { slot: 1, hole: 18, strokes: 6, ts: 8, by: 'c' }, // loses to ts 9
    ];
    const apply = (order: RemoteCell[]) => {
      let round = freshRound();
      for (const w of order) round = applyRemoteCell(round, w) ?? round;
      return round.scores;
    };
    const forward = apply(writes);
    const reversed = apply([...writes].reverse());
    const shuffled = apply([writes[3], writes[5], writes[0], writes[2], writes[4], writes[1]]);
    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
    expect(forward[0][0]).toBe(3); // 'c' won the tie at ts 12
    expect(forward[1][17]).toBeNull(); // the ts-9 clear beat the ts-8 write
  });
});

describe('applyPlayerJoined', () => {
  test('grows the roster once, idempotently', () => {
    let round = freshRound();
    const next = applyPlayerJoined(round, 2, 'CCC');
    expect(next!.playerTags).toEqual(['AAA', 'BBB', 'CCC']);
    round = next!;
    expect(applyPlayerJoined(round, 2, 'CCC')).toBeNull(); // already known
    // The new slot can score immediately.
    const scored = applyRemoteCell(round, { slot: 2, hole: 1, strokes: 2, ts: 1, by: 'x' });
    expect(scored!.scores[2][0]).toBe(2);
  });
});

describe('applySnapshot / applyCompleted', () => {
  test('snapshot merges roster + cells through the LWW gate', () => {
    let round = freshRound();
    // A local tap the snapshot doesn't know about yet (newer ts) must survive.
    round = applyLocalStroke(round, 0, 0, 4, 1000);
    const snap = snapshot({
      players: [
        { slot: 0, tag: 'AAA', userId: 'u1', displayName: null },
        { slot: 1, tag: 'BBB', userId: null, displayName: null },
        { slot: 2, tag: 'DDD', userId: null, displayName: null },
      ],
      scores: [
        { slot: 0, hole: 1, strokes: 9, ts: 900, by: 'other' }, // older — loses
        { slot: 1, hole: 2, strokes: 3, ts: 901, by: 'other' }, // new cell — lands
      ],
    });
    const merged = applySnapshot(round, snap)!;
    expect(merged.playerTags).toEqual(['AAA', 'BBB', 'DDD']);
    expect(merged.scores[0][0]).toBe(4); // local newer write survived
    expect(merged.scores[1][1]).toBe(3);
    // Unchanged snapshot: no-op returns null.
    expect(applySnapshot(merged, snap)).toBeNull();
  });

  test('a completed snapshot finalizes the round; applyCompleted is idempotent', () => {
    const round = freshRound();
    const done = applySnapshot(round, snapshot({ game: { ...snapshot().game, status: 'completed' } }))!;
    expect(done.syncState).toBe('synced');
    expect(done.completedAt).not.toBeNull();
    expect(done.shared?.status).toBe('completed');
    expect(applyCompleted(done)).toBeNull();
  });
});
