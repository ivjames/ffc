import { useSyncExternalStore } from 'react';
import { fetchSession, type AppUser } from './authApi';

// The player session, shared across the app. Screens used to each call
// /api/auth/me on mount, which meant several redundant round-trips per
// navigation and — now that routes are gated on the answer — several
// independent "is this person signed in?" opinions. One store, one fetch,
// every subscriber re-renders when it resolves. Same idiom as lib/location.ts
// and lib/rewardsCard.ts.
//
// `known` distinguishes "definitively signed out" (a 401) from "couldn't tell"
// (offline, 5xx), which the gate needs: an inconclusive check must show a
// retry, never a sign-in wall to someone who is already signed in.

export type SessionState = {
  user: AppUser | null;
  /** True once an authoritative answer has landed (200 or 401). */
  known: boolean;
  /** True while a check is in flight. */
  loading: boolean;
};

let state: SessionState = { user: null, known: false, loading: false };
const listeners = new Set<() => void>();
let inFlight: Promise<SessionState> | null = null;

function emit(next: SessionState): void {
  state = next;
  listeners.forEach((notify) => notify());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getSession(): SessionState {
  return state;
}

/** Fetch the session, de-duplicating concurrent callers onto one request. */
export function refreshSession(): Promise<SessionState> {
  if (inFlight) return inFlight;
  // Set the in-flight flag WITHOUT notifying: useSession kicks the first fetch
  // off from render, and notifying subscribers mid-render is the classic
  // "cannot update a component while rendering a different component" bug.
  // useSyncExternalStore re-reads after the render commits, so the flag is
  // still picked up; every later transition goes through emit() normally.
  state = { ...state, loading: true };
  inFlight = fetchSession()
    .then((res) => {
      // An inconclusive answer must not clobber a known-good user: staying on
      // the last authoritative result is what keeps an offline player signed in.
      emit(
        res.known
          ? { user: res.user, known: true, loading: false }
          : { ...state, loading: false },
      );
      return state;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Apply a session change we already know the answer to (verify / logout), so
 *  the whole app re-renders without another round-trip. */
export function setSessionUser(user: AppUser | null): void {
  emit({ user, known: true, loading: false });
}

/** Reactive read. Kicks off the first fetch lazily, so mounting any gated
 *  screen resolves the session without every screen wiring its own effect. */
export function useSession(): SessionState {
  const snapshot = useSyncExternalStore(subscribe, getSession, getSession);
  if (!snapshot.known && !snapshot.loading) void refreshSession();
  return snapshot;
}
