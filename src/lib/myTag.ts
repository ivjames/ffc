import { isValidTag } from './sanitize';

// The phone holder's own arcade tag, remembered on this device. Learned at the
// moments the holder states it about themselves — picking "which player is
// you" at round setup, hosting a shared game (player 1 is "your own tag"), or
// joining one from this phone — and used to prefill those same questions the
// next time they come up. Deliberately device-local: a 3-char tag is a display
// label, not an identity (tags repeat across strangers), so this never leaves
// the phone and never attaches to an account. Best-effort like the app's other
// localStorage memories — private mode simply forgets.

const KEY = 'ffc.myTag';

export function getMyTag(): string | null {
  try {
    const tag = localStorage.getItem(KEY);
    // Validate on the way OUT, not just in: the blocklist can grow between
    // visits, and a stale stored value must not resurrect a now-blocked tag.
    return tag && isValidTag(tag) ? tag : null;
  } catch {
    return null;
  }
}

export function rememberMyTag(tag: string): void {
  if (!isValidTag(tag)) return;
  try {
    localStorage.setItem(KEY, tag);
  } catch {
    // Storage unavailable — this is a convenience memory, not app state.
  }
}

/**
 * Which seat the "which player is you?" picker should preselect. The seat
 * whose tag is the holder's own; 'none' (just keeping score) when the holder
 * has a known tag that is not on this roster — a parent entering only the
 * kids; and seat 0, the convention the shared-game host flow states out loud,
 * when the phone has no idea who holds it.
 */
export function ownerSeatFor(roster: string[], holderTag: string | null): number | 'none' {
  if (!holderTag) return 0;
  const seat = roster.indexOf(holderTag);
  return seat === -1 ? 'none' : seat;
}
