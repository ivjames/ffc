// The course-free hunt's group state, held on the device.
//
// An on-course hunt borrows its group from the golf round: the roster is the
// round's playerTags and the group key is the round's clientId. A venue hunt
// has no round to borrow from, so it keeps the same two things itself — a
// roster and an opaque group key — and hands them to exactly the same API.
//
// localStorage, not IndexedDB (src/db): this is a handful of strings, and
// nothing here is authoritative. The FINDS live server-side, keyed by the
// group key, so a cleared session loses only the local pointer to a group —
// the hunt's actual progress is re-readable by anyone who still holds the key.
// That also means the key must be unguessable: it's the same bearer-secret
// contract as a round's clientId (GET /api/hunt/photo/:findId?round=… trusts
// it as the group's proof), so it's minted with randomUUID and never derived
// from the venue or the roster.

const KEY = 'ffc.huntSession';

export type VenueHuntSession = {
  /** The group key — sent as `roundClientId`, the field both modes share. */
  clientId: string;
  /** The venue this hunt belongs to; a session doesn't travel between sites. */
  locationId: string;
  /** 1..4 arcade tags, the same identities the scorecard and TV board use. */
  playerTags: string[];
  /** ISO timestamp, for the "started X ago" line and stale-session cleanup. */
  startedAt: string;
};

/** Sessions older than this are treated as finished — a venue visit is a day out, not a tenancy. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isSession(v: unknown): v is VenueHuntSession {
  if (v == null || typeof v !== 'object') return false;
  const s = v as Partial<VenueHuntSession>;
  return (
    typeof s.clientId === 'string' &&
    s.clientId.length > 0 &&
    typeof s.locationId === 'string' &&
    typeof s.startedAt === 'string' &&
    Array.isArray(s.playerTags) &&
    s.playerTags.length > 0 &&
    s.playerTags.every((t) => typeof t === 'string')
  );
}

/**
 * The live session for `locationId`, or null.
 *
 * Returns null (rather than the stored session) when the stored one belongs to
 * another venue or has aged out, so a group that drives to a second site — or
 * comes back next week — starts a fresh hunt instead of appending finds to a
 * stale group key. Reads defensively: a hand-edited or half-written entry is
 * dropped, never thrown.
 */
export function getVenueHuntSession(locationId: string): VenueHuntSession | null {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isSession(parsed)) return null;
  if (parsed.locationId !== locationId) return null;
  const startedAt = Date.parse(parsed.startedAt);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt > MAX_AGE_MS) return null;
  return parsed;
}

/** Mint a session for a roster and persist it. Replaces any existing one. */
export function startVenueHuntSession(
  locationId: string,
  playerTags: string[],
): VenueHuntSession {
  const session: VenueHuntSession = {
    clientId: crypto.randomUUID(),
    locationId,
    playerTags,
    startedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage full or blocked (private mode). The session still works for this
    // screen's lifetime — it just won't survive a reload, which beats refusing
    // to start the hunt at all.
  }
  return session;
}

/** Forget the local session ("finish hunt"). Server-side finds are untouched. */
export function endVenueHuntSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — a session we can't clear ages out on its own.
  }
}
