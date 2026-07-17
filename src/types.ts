// Shared domain types.

export type SyncState = 'active' | 'pending' | 'synced';

// §4 Local state (IndexedDB) — the active round held locally while playing.
export type LocalRound = {
  clientId: string; // UUID, becomes round.client_id on sync
  courseId: string;
  playerTags: string[]; // 1..4 tags, each [A-Z0-9]{3}
  // playerIndex -> [18] strokes, null = unentered
  scores: Record<number, (number | null)[]>;
  createdAt: number;
  completedAt: number | null;
  syncState: SyncState;
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
};
