// Arcade high-score API client (/api/game-scores).
//
// Deliberately holds NO copy of the game registry: the server's response
// carries each game's `meta` (direction, unit, label), so the code that
// formats a board is fed by the same source that ranked it. A mirrored table
// here would be one more thing to keep in sync with server/lib/gameScores.js,
// and the failure mode — a lap time rendered as points, or a board captioned
// with the wrong direction — is silent.
import { apiUrl } from '../sync';

export type ScoreDirection = 'high' | 'low';
export type ScoreUnit = 'points' | 'ms' | 'strokes' | 'count';

export type GameScoreMeta = {
  key: string;
  label: string;
  direction: ScoreDirection;
  unit: ScoreUnit;
  noun: string;
  /** Sub-boards, for games that aren't comparable to themselves (a go-kart
   *  track, Arcade Putt's mode). Absent for the single-board majority. */
  variants?: { key: string; label: string }[];
};

export type BoardRow = {
  rank: number;
  userId: string;
  name: string | null;
  tag: string | null;
  score: number;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type Standing = { rank: number; score: number; outOf: number };

export type RecordResult = {
  meta: GameScoreMeta;
  score: number;
  previousBest: number | null;
  isPersonalBest: boolean;
  standing: Standing | null;
  board: BoardRow[];
};

export type BoardEntry = {
  game: string;
  label: string;
  /** '' for single-board games. */
  variant: string;
  /** The sub-board's name ("Boomerang"), or null when there is only one. */
  variantLabel: string | null;
  direction: ScoreDirection;
  unit: ScoreUnit;
  noun: string;
  board: BoardRow[];
};

export type BoardsResult = {
  period: string;
  boards: BoardEntry[];
};

/** Record one round's score. Resolves null on any failure — a board that
 *  can't be reached must never break the end screen the player is looking at. */
export async function recordScore(input: {
  locationId: string;
  game: string;
  /** Required for variant games (go-karts, Arcade Putt); omit for the rest. */
  variant?: string;
  score: number;
  detail?: Record<string, unknown>;
  sessionId: string;
}): Promise<RecordResult | null> {
  try {
    const res = await fetch(apiUrl('/api/game-scores'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ok ? (data as RecordResult) : null;
  } catch {
    return null;
  }
}

/** One game's board, without recording anything (the read-only board screen). */
export async function fetchBoard(params: {
  game: string;
  variant?: string;
  locationId: string;
  period?: string;
  limit?: number;
}): Promise<{ meta: GameScoreMeta; board: BoardRow[]; standing: Standing | null } | null> {
  const q = new URLSearchParams({
    game: params.game,
    locationId: params.locationId,
    period: params.period ?? 'all',
  });
  if (params.variant) q.set('variant', params.variant);
  if (params.limit) q.set('limit', String(params.limit));
  try {
    const res = await fetch(apiUrl(`/api/game-scores/board?${q}`), { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}

/** Every scored game's board in one call — the arcade-wide board screen. */
export async function fetchBoards(params: {
  locationId: string;
  period?: string;
  limit?: number;
}): Promise<BoardsResult | null> {
  const q = new URLSearchParams({
    locationId: params.locationId,
    period: params.period ?? 'all',
  });
  if (params.limit) q.set('limit', String(params.limit));
  try {
    const res = await fetch(apiUrl(`/api/game-scores/boards?${q}`), { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}

/**
 * Render a stored integer in its game's unit. Time is stored in whole
 * milliseconds and shown to hundredths, which is how a lap board reads;
 * everything else is a plain count.
 */
export function formatScore(score: number, unit: ScoreUnit): string {
  if (unit === 'ms') {
    if (score >= 60_000) {
      const mins = Math.floor(score / 60_000);
      const secs = (score % 60_000) / 1000;
      return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
    }
    return `${(score / 1000).toFixed(2)}s`;
  }
  return score.toLocaleString();
}

/** The board's display name for a row: the player's 3-char tag if they set one
 *  (the arcade convention, and what the golf boards show), else their display
 *  name, else an anonymous placeholder. */
export function rowLabel(row: BoardRow): string {
  if (row.tag) return row.tag;
  if (row.name) return row.name;
  return 'PLAYER';
}
