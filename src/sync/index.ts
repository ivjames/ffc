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
    const pending = await getRoundsBySync('pending');
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
): Promise<LeaderboardRow[]> {
  const res = await fetch(apiUrl(`/api/leaderboard?period=${period}`));
  if (!res.ok) throw new Error(`Leaderboard failed: HTTP ${res.status}`);
  return res.json();
}
