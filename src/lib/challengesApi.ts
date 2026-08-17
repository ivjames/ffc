// Head-to-head challenge API client (/api/challenges).
//
// Async and sync are one record: the difference is only whether both players
// are looking at it at the same time. `subscribeChallenge` is what makes the
// synchronous mode synchronous — the other side's round lands on your screen
// the moment they finish, instead of arriving as a text message.
import { apiUrl } from '../sync';
import type { GameScoreMeta } from './gameScores';

export type ChallengeSide = {
  userId: string;
  /** Null until that side has played. */
  score: number | null;
  name?: string | null;
  tag?: string | null;
  detail?: Record<string, unknown>;
  playedAt?: string;
  isYou: boolean;
};

export type ChallengeView = {
  challenge: {
    id: string;
    locationId: string;
    game: string;
    variant: string;
    meta: GameScoreMeta;
    /** Only while the challenge is still open — a spent code is not a thing
     *  anyone should be handing around. */
    inviteCode: string | null;
    status: 'open' | 'complete' | 'expired';
    expiresAt: string;
    completedAt: string | null;
  };
  challenger: ChallengeSide;
  opponent: ChallengeSide | null;
  winnerId: string | null;
  tied: boolean;
  youWon: boolean;
};

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; status: number };

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/challenges${path}`), {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...init,
    });
  } catch {
    return { ok: false, error: 'offline', status: 0 };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}`, status: res.status };
  return { ok: true, ...data };
}

export function createChallenge(input: { locationId: string; game: string; variant?: string }) {
  return call<ChallengeView>('/', { method: 'POST', body: JSON.stringify(input) });
}

export function joinChallenge(inviteCode: string) {
  return call<ChallengeView>('/join', { method: 'POST', body: JSON.stringify({ inviteCode }) });
}

export function playChallenge(
  id: string,
  input: { score: number; detail?: Record<string, unknown>; sessionId: string },
) {
  return call<ChallengeView>(`/${id}/play`, { method: 'POST', body: JSON.stringify(input) });
}

export function fetchChallenge(id: string) {
  return call<ChallengeView>(`/${id}`);
}

export function fetchMyChallenges() {
  return call<{ challenges: ChallengeView[] }>('/mine');
}

/**
 * Watch one challenge live. The server sends a viewer-NEUTRAL payload (one
 * frame serves both sides), so `isYou`/`youWon` are recomputed here from the
 * signed-in user's id rather than trusted from the frame.
 */
export function subscribeChallenge(
  id: string,
  myUserId: string | null,
  onState: (view: ChallengeView) => void,
): () => void {
  const source = new EventSource(apiUrl(`/api/challenges/${id}/events`), {
    withCredentials: true,
  });
  source.addEventListener('state', (e) => {
    try {
      const view = JSON.parse((e as MessageEvent).data) as ChallengeView;
      onState(personalize(view, myUserId));
    } catch {
      // A malformed frame isn't worth tearing the stream down for.
    }
  });
  return () => source.close();
}

/** Resolve the viewer-relative flags on a neutral payload. */
export function personalize(view: ChallengeView, myUserId: string | null): ChallengeView {
  return {
    ...view,
    challenger: { ...view.challenger, isYou: view.challenger.userId === myUserId },
    opponent: view.opponent
      ? { ...view.opponent, isYou: view.opponent.userId === myUserId }
      : null,
    youWon: view.winnerId != null && view.winnerId === myUserId,
  };
}

/** A side's display label, matching the boards' tag-first convention. */
export function sideLabel(side: ChallengeSide | null): string {
  if (!side) return 'Waiting…';
  if (side.isYou) return 'You';
  return side.tag || side.name || 'Opponent';
}
