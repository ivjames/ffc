// Live trivia API client (/api/trivia) — the bar-trivia mode.
//
// Two capabilities, kept apart on purpose. The HOST token is minted once at
// create and never leaves the host's device; the PARTICIPANT token is one per
// phone, handed out at join. A screen holds one or the other, never both.
import { apiUrl } from '../sync';

export type TriviaStatus = 'lobby' | 'question' | 'reveal' | 'final' | 'abandoned';

export type TriviaQuestionView = {
  index: number;
  total: number;
  category: string;
  prompt: string;
  choices: string[];
  /** Present only on host payloads and after the question closes — the server
   *  strips it from every player payload while answering is still open. */
  answer?: number;
};

export type TriviaEntrant = {
  id: string;
  name: string;
  isTeam: boolean;
  score: number;
  devices: number;
  rank: number;
};

export type TriviaSnapshot = {
  session: {
    id: string;
    joinCode: string;
    status: TriviaStatus;
    currentIndex: number;
    total: number;
    askedAt: string | null;
    config: { questionSeconds: number; speedBonus: boolean; teams: boolean };
  };
  question: TriviaQuestionView | null;
  board: TriviaEntrant[];
  answeredCount: number;
  entrantCount: number;
  myAnswer: { choice: number; correct?: boolean; points?: number } | null;
  entrant?: { id: string; name: string };
};

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; status: number };

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/trivia${path}`), {
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

export function createSession(input: {
  locationId: string;
  questionCount?: number;
  category?: string | null;
  config?: { questionSeconds?: number; speedBonus?: boolean; teams?: boolean };
}) {
  return call<{ session: TriviaSnapshot['session']; hostToken: string }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function joinSession(input: {
  joinCode: string;
  name?: string | null;
  entrantId?: string;
  isTeam?: boolean;
}) {
  return call<{
    participantToken: string;
    entrant: { id: string; name: string; isTeam: boolean };
    snapshot: TriviaSnapshot;
  }>('/sessions/join', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchSnapshot(id: string, auth: { participant?: string; host?: string }) {
  const q = new URLSearchParams(auth as Record<string, string>);
  return call<TriviaSnapshot>(`/sessions/${id}?${q}`);
}

export function submitAnswer(id: string, participant: string, choice: number) {
  return call<{ locked: number }>(`/sessions/${id}/answer`, {
    method: 'POST',
    body: JSON.stringify({ participant, choice }),
  });
}

export function advance(id: string, host: string) {
  return call<TriviaSnapshot>(`/sessions/${id}/advance`, {
    method: 'POST',
    body: JSON.stringify({ host }),
  });
}

export function endSession(id: string, host: string) {
  return call<TriviaSnapshot>(`/sessions/${id}/end`, {
    method: 'POST',
    body: JSON.stringify({ host }),
  });
}

export function fetchCategories(locationId: string) {
  return call<{ categories: { category: string; n: number }[] }>(
    `/categories?locationId=${encodeURIComponent(locationId)}`,
  );
}

/**
 * Subscribe to a session's live state. The token rides the query string
 * because EventSource cannot set headers — the same shape shared golf games
 * use. Returns an unsubscribe function.
 *
 * The server sends one `state` event carrying both audiences' payloads; which
 * one this connection is entitled to is decided server-side from the token, so
 * a player stream simply has no `host` key to read.
 */
export function subscribeSession(
  id: string,
  auth: { participant?: string; host?: string },
  onState: (snapshot: TriviaSnapshot) => void,
): () => void {
  const q = new URLSearchParams(auth as Record<string, string>);
  const source = new EventSource(apiUrl(`/api/trivia/sessions/${id}/events?${q}`));
  const wantHost = Boolean(auth.host);
  source.addEventListener('state', (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data);
      const snapshot = wantHost ? payload.host : payload.player;
      if (snapshot) onState(snapshot);
    } catch {
      // A malformed frame is not worth tearing the stream down for — the next
      // one will carry the same state.
    }
  });
  return () => source.close();
}
