// Session-storage capabilities for live trivia, shared between the screens
// that mint them and the screen that plays on them.
//
// PLAYER: the participant token minted at join — TriviaLive's seat at the
// game. OWNER: the host token handed back when a player starts their own game
// from /arcade/trivia/start. The owner is a player like any other; the token
// grants pacing only ("start now", "end the game"), never information, so
// holding both at once is safe — see the phase-release rule in
// server/routes/triviaLive.js.
//
// sessionStorage, not localStorage, on purpose: these are capabilities for
// THIS game on THIS device, and a stale one from last Tuesday resolving to a
// dead session is worse than asking for the code again.

export type StoredPlayer = {
  sessionId: string;
  participantToken: string;
  entrantId: string;
  name: string;
};

export type StoredOwner = { sessionId: string; hostToken: string };

const PLAYER_KEY = 'ffc.trivia.live';
const OWNER_KEY = 'ffc.trivia.owner';

function load<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    // Private mode with storage disabled — the game still plays for as long
    // as the screen stays mounted, which is the whole session in practice.
  }
}

export const loadPlayer = () => load<StoredPlayer>(PLAYER_KEY);
export const savePlayer = (value: StoredPlayer | null) => save(PLAYER_KEY, value);

export const loadOwner = () => load<StoredOwner>(OWNER_KEY);
export const saveOwner = (value: StoredOwner | null) => save(OWNER_KEY, value);
