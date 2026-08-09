import type { LocalRound } from '../types';
import { getRoundsBySync, putRound } from '../db';

// §3 / §9 Sync layer. Completed rounds are queued locally (syncState 'pending')
// and pushed to the Node/Express API when a connection is available. Costs
// nothing now and removes the P2 leaderboard cold-start problem.
//
// All writes go through the API (POST /api/rounds), which is idempotent on
// clientId — so a retried sync never creates duplicate rounds.

// Same-origin '/api' in production (nginx proxies to the Node app); override
// with VITE_API_BASE for split deployments.
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

type SyncResult = { synced: number; failed: number };

let syncing = false;

/** POST a single completed round to the API. Throws on network/HTTP error. */
async function pushRound(round: LocalRound): Promise<void> {
  const res = await fetch(apiUrl('/api/rounds'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: round.clientId,
      courseId: round.courseId,
      playerTags: round.playerTags,
      groupTag: round.groupTag ?? null,
      createdAt: round.createdAt,
      completedAt: round.completedAt,
      scores: round.scores,
    }),
  });

  if (res.status === 400) {
    // Server rejected the payload as invalid. Retrying won't help — surface it
    // but don't wedge the queue. Mark synced-with-error by leaving pending so a
    // human notices; for v1 we simply log and stop retrying this one.
    const body = await res.json().catch(() => ({}));
    throw new Error(`Round rejected (400): ${body.error ?? 'invalid'}`);
  }
  if (!res.ok) {
    throw new Error(`Sync failed: HTTP ${res.status}`);
  }
}

/** Push all pending rounds. Safe to call repeatedly (idempotent server-side). */
export async function syncPending(): Promise<SyncResult> {
  if (syncing || !navigator.onLine) return { synced: 0, failed: 0 };
  syncing = true;
  const result: SyncResult = { synced: 0, failed: 0 };
  try {
    // Shared rounds never belong in this queue — the server finalizes them
    // via POST /api/games/:id/complete (src/sync/shared.ts) — but filter
    // defensively so a stray one can't wedge retries forever.
    const pending = (await getRoundsBySync('pending')).filter((r) => !r.shared);
    for (const round of pending) {
      try {
        await pushRound(round);
        await putRound({ ...round, syncState: 'synced' });
        result.synced++;
      } catch (err) {
        // Network down or server error: leave it 'pending' to retry next time.
        console.warn('[sync] deferring round', round.clientId, err);
        result.failed++;
      }
    }
  } finally {
    syncing = false;
  }
  return result;
}

/** Wire up automatic sync: on app start and whenever connectivity returns. */
export function startSyncWorker(): void {
  // Fire-and-forget initial drain.
  void syncPending();
  window.addEventListener('online', () => void syncPending());
  // Also drain when the tab becomes visible again (returning to the app).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncPending();
  });
}

/** Fetch the leaderboard (P2 preview — the API already serves it). */
export type LeaderboardRow = {
  tag: string;
  courseId: string;
  courseName: string;
  total: number;
  completedAt: string;
};

export async function fetchLeaderboard(
  period: 'day' | 'week' | 'month' | 'all',
  by: 'player' | 'team' = 'player',
  locationId?: string,
): Promise<LeaderboardRow[]> {
  const q = new URLSearchParams({ period, by });
  if (locationId) q.set('locationId', locationId);
  const res = await fetch(apiUrl(`/api/leaderboard?${q}`));
  if (!res.ok) throw new Error(`Leaderboard failed: HTTP ${res.status}`);
  return res.json();
}

/** One course's board on the venue display wall (/tv/wall). */
export type CourseBoard = {
  courseId: string;
  courseName: string;
  theme: string;
  locationId: string | null;
  locationName: string | null;
  rows: { rank: number; tag: string; total: number; completedAt: string }[];
};

export type CourseBoardOpts = {
  locationId?: string;
  period?: 'day' | 'week' | 'month' | 'all';
  by?: 'player' | 'team';
  limit?: number;
};

function courseBoardsQuery(opts: CourseBoardOpts): string {
  const q = new URLSearchParams();
  if (opts.locationId) q.set('locationId', opts.locationId);
  if (opts.period) q.set('period', opts.period);
  if (opts.by) q.set('by', opts.by);
  if (opts.limit) q.set('limit', String(opts.limit));
  return q.toString();
}

/** Per-course top-N boards for the venue display wall — every live course of
 *  the venue is returned, empty boards included, so the column grid is stable. */
export async function fetchCourseBoards(
  opts: CourseBoardOpts,
): Promise<{ period: string; by: string; courses: CourseBoard[] }> {
  const res = await fetch(apiUrl(`/api/leaderboard/courses?${courseBoardsQuery(opts)}`));
  if (!res.ok) throw new Error(`Leaderboard failed: HTTP ${res.status}`);
  return res.json();
}

/** SSE stream URL for the same boards — emits a `boards` event on connect and
 *  whenever the standings change (see server routes/leaderboard.js). */
export function courseBoardsStreamUrl(opts: CourseBoardOpts): string {
  return apiUrl(`/api/leaderboard/courses/stream?${courseBoardsQuery(opts)}`);
}

/** Rewards earned by a round (punchlist #8 tier 1), fetched by the round's
 *  unguessable clientId once it has synced. */
export type RewardRow = {
  code: string;
  playerIndex: number;
  playerTag: string;
  achievement: string;
  redeemedAt: string | null;
};

export async function fetchRewards(clientId: string): Promise<RewardRow[]> {
  const res = await fetch(apiUrl(`/api/rewards?clientId=${encodeURIComponent(clientId)}`));
  if (!res.ok) throw new Error(`Rewards failed: HTTP ${res.status}`);
  return res.json();
}
