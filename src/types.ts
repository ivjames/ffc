// Shared domain types.

import type { PosConfig } from './lib/pos/types';
import type { VenueHours } from './lib/venueHours';

export type SyncState = 'active' | 'pending' | 'synced';

// Per-cell last-write-wins metadata for a shared round: who wrote the cell
// last and at what device timestamp. Mirrors the server's shared_score
// (ts_client, updated_by) — see src/lib/sharedMerge.ts for the comparison.
export type CellMeta = { ts: number; by: string } | null;

// Extra state carried by a round that is a shared multi-device game. The
// round's clientId is 'shared:' + gameId, so rejoining on the same device is
// naturally idempotent and the server's finalized round matches what this
// device references.
export type SharedInfo = {
  gameId: string;
  joinCode: string;
  participantToken: string; // this device's bearer credential
  slot: number; // this device's own roster slot
  status: 'open' | 'completed';
  // playerIndex -> [18] CellMeta, aligned with LocalRound.scores
  cellMeta: Record<number, CellMeta[]>;
};

// §4 Local state (IndexedDB) — the active round held locally while playing.
export type LocalRound = {
  clientId: string; // UUID, becomes round.client_id on sync
  courseId: string;
  playerTags: string[]; // 1..4 tags, each [A-Z0-9]{3}
  groupTag?: string | null; // optional team tag, same [A-Z0-9]{3} rule (punchlist #4)
  // playerIndex -> [18] strokes, null = unentered
  scores: Record<number, (number | null)[]>;
  createdAt: number;
  completedAt: number | null;
  syncState: SyncState;
  // The course's pars, copied at creation. The venue catalog is LIVE — a course
  // archived in Master Control disappears from /api/content — and without this
  // a round played on it becomes unjudgeable, taking even par-independent
  // badges (a hole-in-one is a hole-in-one) down with it. Optional because
  // rounds created before this existed don't have it; those fall back to the
  // catalog, and are simply lost if their course is gone.
  pars?: number[];
  // Present only on shared multi-device rounds. Shared rounds never enter the
  // 'pending' push queue — the server finalizes them at completion instead.
  shared?: SharedInfo;
  // Pass-and-play: which seat is the phone holder's — the only seat the
  // achievements wall credits (another player's win typed on this phone is
  // their win, not the holder's). null = the holder was only keeping score, so
  // no seat is theirs; absent = a round from before this existed, which keeps
  // its old every-seat reading. Shared rounds ignore it (this device's seat is
  // shared.slot). Never synced — whose phone this is is a device-side fact.
  ownerSlot?: number | null;
  // When this round's server-granted achievements were pulled into the local
  // earned set (see features/me/Achievements). Absent = not yet imported, which
  // is what makes the import self-healing: a round the worker synced in the
  // background, or one whose fetch failed, is simply retried on the next visit
  // to the wall.
  grantsImportedAt?: number;
};

// One queued cell write from this device, awaiting delivery to the shared
// game's API (IndexedDB 'outbox' store; key is an auto-increment number).
export type OutboxEntry = {
  gameId: string;
  slot: number;
  hole: number; // 1-based, matching the API
  strokes: number | null;
  ts: number; // the tap's ms-epoch, already stamped into cellMeta
};

// §4 Location seed. White-label: one client owns multiple physical locations,
// each with its own distinct set of courses (a course belongs to exactly one
// location). Placeholders until the client's real sites are supplied (§11).
export type LocationSeed = {
  id: string;
  name: string;
  slug: string; // stable short key (unique per client), e.g. 'riverside'
  accent: string; // per-site brand accent color (hex) for UI
  // §5 Venue coordinates (WGS84) for GPS auto-detect. A device within
  // `geofenceKm` of this point is treated as "at this site". Placeholder
  // coords until the client supplies real venue locations (§11).
  lat: number;
  lng: number;
  geofenceKm?: number; // detection radius; falls back to DEFAULT_GEOFENCE_KM
  sortOrder?: number;
  // IANA zone hours.* is evaluated in (e.g. "America/Los_Angeles"). Needed
  // alongside `hours` to compute "open now" client-side; unset when the venue
  // hasn't been given a zone yet.
  tz?: string | null;
  // Weekly business hours, set per venue in Master Control. Unset/null = not
  // configured — surfaces should hide the open/closed status rather than
  // guess. See src/lib/venueHours.ts for the shape + open/closed logic.
  hours?: VenueHours | null;
  // Food & drink deep links (punchlist #7 tier 1) — set per venue in Master
  // Control; the Food & Drink card hides itself when neither is set.
  menuUrl?: string;
  orderingUrl?: string;
  // POS integration add-on — set per venue in Master Control. Gates the
  // native food-ordering / rewards surfaces (src/lib/pos). Unset = no
  // integration; the deep links above remain the fallback.
  pos?: PosConfig;
  // The course-free scavenger hunt is offered here: this venue switched
  // venueMode on AND has at least one active item on its venue-wide list.
  // Derived server-side (GET /api/content) so the app never has to decide
  // what "available" means; gates the Home tile and the /hunt route. Unset
  // or false = the venue has no course-free hunt (every venue, until one
  // opts in).
  venueHunt?: boolean;
  // Resolved à la carte module entitlements (server/lib/modules.js): the final
  // on/off per module, vendor wiring and dependencies already folded in. Unset
  // on payloads and caches written before the modules column existed — read it
  // through src/lib/modules.ts, which falls back to the pre-modules behavior
  // rather than treating "absent" as "everything off".
  modules?: Record<string, boolean>;
};

// §4 Course seed (bundled JSON for v1).
export type CourseSeed = {
  id: string;
  locationId: string; // the site this course belongs to (→ LocationSeed.id)
  name: string;
  theme: string;
  holeCount: 18;
  pars: number[]; // length 18, values 2..4
  holeNames?: string[]; // length 18 when known; per-hole names (client-supplied)
  mapAsset?: string; // path to bundled image/SVG when a map exists
  rules?: string[]; // course-specific notes
  accent: string; // themed accent color (hex) for UI
  // Whether this course has a hunt that can be COMPLETED — active items that
  // aren't the "count as many as you like" kind. Optional: a content cache
  // written before the flag existed lacks it, and absent must read as "assume
  // it has one" so a stale cache never hides earnable badges.
  hasHunt?: boolean;
};

// §Achievements — a badge this device has earned. Once written it is never
// removed: detection re-derives from stored rounds, so without this record a
// cleared cache (or an aged-out round) would quietly take badges away.
export type EarnedBadge = {
  key: string;
  earnedAt: number;
};

// A device-local tally of something the round record cannot see — a mini-game
// played, a booth photo saved, a food order placed. `best` is a high-water mark
// for rules phrased as "reach N" (a game's ticket ceiling, stickers on one
// photo). Never leaves the device.
export type ActivityMark = {
  id: string; // `${kind}:${name}`
  kind: 'game' | 'feat' | 'booth' | 'food' | 'social';
  name: string;
  count: number;
  best: number;
  firstAt: number;
  lastAt: number;
};
