// Pure merge layer for shared multi-device rounds: per-cell last-write-wins
// on (ts, participantId). MUST apply the same comparison as the server's
// guarded upsert (server/lib/lww.js) — keep in sync — so every device and the
// server converge on the same grid no matter what order writes arrive in.
import type { CellMeta, LocalRound, SharedInfo } from '../types';
import { HOLE_COUNT } from './scoring';

export type RemoteCell = {
  slot: number;
  hole: number; // 1-based, as the API speaks
  strokes: number | null;
  ts: number;
  by: string;
};

export type GameSnapshot = {
  game: {
    id: string;
    joinCode: string;
    courseId: string;
    teamId: string | null;
    status: string;
    roundId: string | null;
  };
  players: { slot: number; tag: string; userId: string | null; displayName: string | null }[];
  scores: RemoteCell[];
};

/** True when write (aTs, aBy) beats stored (bTs, bBy) — the server's
 *  `(excluded.ts, excluded.by) > (stored.ts, stored.by)` tuple comparison. */
export function lwwWins(aTs: number, aBy: string, bTs: number, bBy: string): boolean {
  if (aTs !== bTs) return aTs > bTs;
  return aBy > bBy;
}

function emptyRow<T>(fill: T): T[] {
  return Array<T>(HOLE_COUNT).fill(fill);
}

function metaRow(round: LocalRound, slot: number): CellMeta[] {
  return [...(round.shared?.cellMeta[slot] ?? emptyRow<CellMeta>(null))];
}

function scoreRow(round: LocalRound, slot: number): (number | null)[] {
  return [...(round.scores[slot] ?? emptyRow<number | null>(null))];
}

/** Apply one remote cell write. Returns the updated round, or null when the
 *  stored cell wins (no change). */
export function applyRemoteCell(round: LocalRound, cell: RemoteCell): LocalRound | null {
  if (!round.shared) return null;
  const holeIdx = cell.hole - 1;
  if (holeIdx < 0 || holeIdx >= HOLE_COUNT) return null;
  const meta = metaRow(round, cell.slot);
  const existing = meta[holeIdx];
  if (existing && !lwwWins(cell.ts, cell.by, existing.ts, existing.by)) return null;
  meta[holeIdx] = { ts: cell.ts, by: cell.by };
  const row = scoreRow(round, cell.slot);
  row[holeIdx] = cell.strokes;
  return {
    ...round,
    scores: { ...round.scores, [cell.slot]: row },
    shared: { ...round.shared, cellMeta: { ...round.shared.cellMeta, [cell.slot]: meta } },
  };
}

/** A 'score' event that echoes THIS DEVICE's own write back from the server.
 *  Adopt the server's stored value verbatim instead of LWW-gating it: the
 *  server may have clamped a far-future timestamp (broken-clock guard), and
 *  keeping our bigger unclamped ts would make this replica reject every later
 *  legitimate update to the cell while all other replicas accept them — the
 *  one replica that never converges. Echoes arrive in server apply order, so
 *  adopting each one lands us on the server's final state; any still-queued
 *  outbox writes re-post and re-echo after. */
export function applyOwnEcho(round: LocalRound, cell: RemoteCell): LocalRound | null {
  if (!round.shared || cell.by !== round.shared.participantToken) return null;
  const holeIdx = cell.hole - 1;
  if (holeIdx < 0 || holeIdx >= HOLE_COUNT) return null;
  const meta = metaRow(round, cell.slot);
  const existing = meta[holeIdx];
  if (existing && existing.ts === cell.ts && existing.by === cell.by) return null; // already in sync
  meta[holeIdx] = { ts: cell.ts, by: cell.by };
  const row = scoreRow(round, cell.slot);
  row[holeIdx] = cell.strokes;
  return {
    ...round,
    scores: { ...round.scores, [cell.slot]: row },
    shared: { ...round.shared, cellMeta: { ...round.shared.cellMeta, [cell.slot]: meta } },
  };
}

/** Stamp a local tap into the round (scores + cellMeta) with this device's
 *  participant id. The caller queues the matching outbox entry. */
export function applyLocalStroke(
  round: LocalRound,
  slot: number,
  holeIdx: number, // 0-based, as the scorecard thinks
  strokes: number | null,
  ts: number,
): LocalRound {
  if (!round.shared) return round;
  const meta = metaRow(round, slot);
  meta[holeIdx] = { ts, by: round.shared.participantToken };
  const row = scoreRow(round, slot);
  row[holeIdx] = strokes;
  return {
    ...round,
    scores: { ...round.scores, [slot]: row },
    shared: { ...round.shared, cellMeta: { ...round.shared.cellMeta, [slot]: meta } },
  };
}

/** Grow the roster when another device's player joins. Idempotent on slot. */
export function applyPlayerJoined(round: LocalRound, slot: number, tag: string): LocalRound | null {
  if (!round.shared) return null;
  if (round.playerTags[slot] !== undefined) return null; // already known
  const playerTags = [...round.playerTags];
  playerTags[slot] = tag;
  return {
    ...round,
    playerTags,
    scores: { ...round.scores, [slot]: round.scores[slot] ?? emptyRow<number | null>(null) },
    shared: {
      ...round.shared,
      cellMeta: {
        ...round.shared.cellMeta,
        [slot]: round.shared.cellMeta[slot] ?? emptyRow<CellMeta>(null),
      },
    },
  };
}

/** Mark the game finished (server finalized the canonical round). */
export function applyCompleted(round: LocalRound): LocalRound | null {
  if (!round.shared) return null;
  if (round.shared.status === 'completed' && round.syncState === 'synced') return null;
  return {
    ...round,
    completedAt: round.completedAt ?? Date.now(),
    syncState: 'synced', // the server owns the canonical round — nothing to push
    shared: { ...round.shared, status: 'completed' },
  };
}

/** Merge a full server snapshot (sent on every SSE connect). Roster first,
 *  then every cell through the same LWW gate, then game status. */
export function applySnapshot(round: LocalRound, snapshot: GameSnapshot): LocalRound | null {
  if (!round.shared) return null;
  let next: LocalRound = round;
  let changed = false;
  for (const p of snapshot.players) {
    const grown = applyPlayerJoined(next, p.slot, p.tag);
    if (grown) {
      next = grown;
      changed = true;
    }
  }
  for (const cell of snapshot.scores) {
    const merged = applyRemoteCell(next, cell);
    if (merged) {
      next = merged;
      changed = true;
    }
  }
  if (snapshot.game.status === 'completed') {
    const done = applyCompleted(next);
    if (done) {
      next = done;
      changed = true;
    }
  }
  return changed ? next : null;
}

/** Build the local mirror of a shared game this device just created/joined. */
export function createSharedLocalRound(
  snapshot: GameSnapshot,
  participantToken: string,
  slot: number,
): LocalRound {
  const shared: SharedInfo = {
    gameId: snapshot.game.id,
    joinCode: snapshot.game.joinCode,
    participantToken,
    slot,
    status: 'open',
    cellMeta: {},
  };
  const base: LocalRound = {
    clientId: `shared:${snapshot.game.id}`,
    courseId: snapshot.game.courseId,
    playerTags: [],
    scores: {},
    createdAt: Date.now(),
    completedAt: null,
    syncState: 'active',
    shared,
  };
  return applySnapshot(base, snapshot) ?? base;
}
