// Shared-games API client (/api/games). Create needs the session cookie;
// everything after rides the per-device participant token.
import { apiUrl } from '../sync';
import type { GameSnapshot, RemoteCell } from './sharedMerge';

export type JoinResult = {
  snapshot: GameSnapshot;
  participantToken: string;
  slot: number;
};

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; status: number };

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/games${path}`), {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    return { ok: false, error: 'offline', status: 0 };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}`, status: res.status };
  return { ok: true, ...data };
}

export async function createGame(
  courseId: string,
  tag: string,
  teamId?: string,
): Promise<Result<{ game: GameSnapshot['game']; participantToken: string; slot: number }>> {
  return call('/', { method: 'POST', body: JSON.stringify({ courseId, tag, teamId }) });
}

export async function joinGame(joinCode: string, tag: string): Promise<Result<JoinResult>> {
  return call('/join', { method: 'POST', body: JSON.stringify({ joinCode, tag }) });
}

export async function fetchSnapshot(
  gameId: string,
  participant: string,
): Promise<Result<{ snapshot: GameSnapshot }>> {
  return call(`/${gameId}?participant=${encodeURIComponent(participant)}`);
}

/** Batch cell writes; `hole` is 1-based. */
export async function postScores(
  gameId: string,
  participant: string,
  writes: Omit<RemoteCell, 'by'>[],
): Promise<Result<{ applied: number }>> {
  return call(`/${gameId}/scores`, {
    method: 'POST',
    body: JSON.stringify({ participant, writes }),
  });
}

export async function completeGame(
  gameId: string,
  participant: string,
): Promise<Result<{ roundId: string }>> {
  return call(`/${gameId}/complete`, { method: 'POST', body: JSON.stringify({ participant }) });
}

export function sseUrl(gameId: string, participant: string): string {
  return apiUrl(`/api/games/${gameId}/events?participant=${encodeURIComponent(participant)}`);
}
