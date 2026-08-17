// "Which challenge am I currently playing for?"
//
// A challenge round is played inside the ordinary game screen — there is no
// separate challenge version of skee-ball, and there shouldn't be. So the
// challenge context has to survive the navigation from the challenge screen
// into the game and back out to its end screen, where the score finally
// exists.
//
// sessionStorage, not localStorage, and deliberately: this is "the round I am
// playing right now". A marker that outlived the tab would attach next week's
// casual game to a challenge the player had forgotten about — and since a
// challenge allows exactly ONE round each, that would spend their attempt on a
// round they didn't mean to submit.

const KEY = 'ffc.challenge.active';

export type ActiveChallenge = {
  challengeId: string;
  game: string;
  /** '' for single-board games, matching game_score.variant. */
  variant: string;
  /** When the marker was armed, ms epoch. See ARM_TTL_MS. */
  armedAt?: number;
};

// How long an armed marker stays valid. A player who taps "Play your round"
// and then backs out leaves the marker behind, and their NEXT casual round of
// the same game would otherwise be silently consumed as their one challenge
// attempt — which they cannot take back, because a challenge allows one round
// each. Returning to the arcade hub clears it (FunZone), and this bounds the
// paths that don't go through there.
const ARM_TTL_MS = 30 * 60 * 1000;

export function setActiveChallenge(value: ActiveChallenge): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...value, armedAt: Date.now() }));
  } catch {
    // Storage disabled — the challenge is still playable from its own screen,
    // it just won't auto-attach to the round.
  }
}

export function getActiveChallenge(): ActiveChallenge | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActiveChallenge) : null;
  } catch {
    return null;
  }
}

export function clearActiveChallenge(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}

/**
 * The active challenge, but only if it is for THIS board. A challenge on the
 * Boomerang track must not swallow a round driven on the Speedway — same rule
 * the boards themselves apply, for the same reason: those two runs are not
 * comparable.
 */
export function activeChallengeFor(game: string, variant = ''): ActiveChallenge | null {
  const active = getActiveChallenge();
  if (!active) return null;
  if (active.game !== game || active.variant !== variant) return null;
  // An armed-but-abandoned marker must not lie in wait for a later round.
  if (active.armedAt != null && Date.now() - active.armedAt > ARM_TTL_MS) {
    clearActiveChallenge();
    return null;
  }
  return active;
}
