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
    /** When this phase advances itself — the countdown every screen shows. */
    autoAt: string | null;
    config: {
      questionSeconds: number;
      speedBonus: boolean;
      teams: boolean;
      revealSeconds: number;
      lobbySeconds: number;
    };
  };
  question: TriviaQuestionView | null;
  board: TriviaEntrant[];
  answeredCount: number;
  entrantCount: number;
  myAnswer: { choice: number; correct?: boolean; points?: number } | null;
  entrant?: { id: string; name: string };
};

// How far through the game a snapshot is, as one comparable number.
//
// Frames can arrive out of order: an answer's broadcast and the host's advance
// are ordered against each other in the database, but their SSE publishes are
// not, so a slow "question" frame can land after the "reveal" that superseded
// it and yank the whole room backwards. Ordering is lexicographic on
// (questionIndex, phase) and monotonic across a game — index only ever grows,
// and within one index the phase only ever moves forward.
const PHASE_RANK: Record<TriviaStatus, number> = {
  lobby: 0,
  question: 1,
  reveal: 2,
  final: 3,
  abandoned: 4,
};

export function progressOf(snapshot: TriviaSnapshot): number {
  return snapshot.session.currentIndex * 10 + (PHASE_RANK[snapshot.session.status] ?? 0);
}

/** True when `next` is not older than `prev` — i.e. safe to render.
 *
 * `progressOf` alone can't separate two frames from the SAME question and
 * phase, and the lobby is entirely one such phase: a roster frame and a slower
 * initial fetch both score zero, so a plain `>=` lets the fetch put the room
 * back to before the last player joined. Within one (index, phase) the roster
 * and the answer count only ever grow, so they break the tie.
 *
 * They're compared in order rather than together because they're read a
 * moment apart on the server; a frame that disagrees with itself (fewer
 * entrants, more answers) is a race between two publishes of the same instant,
 * where either choice is equally right. */
export function isFresh(prev: TriviaSnapshot | null, next: TriviaSnapshot): boolean {
  if (!prev) return true;
  if (progressOf(next) !== progressOf(prev)) return progressOf(next) > progressOf(prev);
  const entrants = (s: TriviaSnapshot) => s.entrantCount ?? 0;
  const answered = (s: TriviaSnapshot) => s.answeredCount ?? 0;
  if (entrants(next) !== entrants(prev)) return entrants(next) > entrants(prev);
  return answered(next) >= answered(prev);
}

/**
 * Fold an incoming frame into what the screen already has, keeping anything
 * the frame cannot know.
 *
 * Broadcast frames are viewer-neutral, so `myAnswer` is ALWAYS null on them —
 * they aren't saying "you didn't answer", they're saying nothing about you at
 * all. Assigning one wholesale over a personalized snapshot wipes the reveal
 * result, and since the frame carries equal progress nothing re-fetches it: the
 * player is left permanently reading "didn't answer in time". A late answer
 * from someone else in the room is enough to trigger it.
 *
 * The two halves are folded SEPARATELY, because a frame can be behind on one
 * and ahead on the other. The room's state comes from whichever frame saw
 * more of the room; this phone's own answer from whichever knows more about
 * it. Picking one frame whole gets the reveal wrong in both directions: a
 * neutral broadcast wipes the player's result, and a personalized refetch that
 * happens to lag the roster by one late joiner would be dropped along with the
 * only copy of their correctness.
 *
 * Callers pass this straight to setState — for a wholly stale frame it returns
 * `prev` unchanged, so it is also the freshness gate.
 */
export function mergeSnapshot(
  prev: TriviaSnapshot | null,
  next: TriviaSnapshot,
): TriviaSnapshot {
  if (!prev) return next;
  const base = isFresh(prev, next) ? next : prev;
  // An answer only describes the question it was fetched for; across a change
  // of question the new frame's is the only truth, null included.
  const sameQuestion = prev.session.currentIndex === next.session.currentIndex;
  const myAnswer = sameQuestion ? richerAnswer(prev.myAnswer, next.myAnswer) : base.myAnswer;
  return myAnswer === base.myAnswer ? base : { ...base, myAnswer };
}

/** The more informative of two records of the same answer: a known result
 *  beats a bare choice, and any record beats none. */
function richerAnswer(a: TriviaSnapshot['myAnswer'], b: TriviaSnapshot['myAnswer']) {
  if (a == null) return b;
  if (b == null) return a;
  if (b.correct === undefined && a.correct !== undefined) return a;
  return b;
}

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
  config?: {
    questionSeconds?: number;
    speedBonus?: boolean;
    teams?: boolean;
    revealSeconds?: number;
    lobbySeconds?: number;
  };
}) {
  // `dealt` can be under `requested` when the chosen category holds fewer
  // questions than the host asked for — the game still starts, but the host is
  // told rather than finding out at the last question.
  return call<{
    session: TriviaSnapshot['session'];
    hostToken: string;
    requested: number;
    dealt: number;
  }>('/sessions', {
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
  source.addEventListener('state', (e) => {
    try {
      // One frame serves the whole room. It used to be two — a host payload
      // carrying the answer and a player payload without — and the split is
      // gone because nothing carries the answer early any more.
      const snapshot = JSON.parse((e as MessageEvent).data) as TriviaSnapshot;
      if (snapshot?.session) onState(snapshot);
    } catch {
      // A malformed frame is not worth tearing the stream down for — the next
      // one will carry the same state.
    }
  });
  return () => source.close();
}
