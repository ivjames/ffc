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

// §4 Course seed (bundled JSON for v1).
export type CourseSeed = {
  id: string;
  name: string;
  theme: string;
  holeCount: 18;
  pars: number[]; // length 18, values 2..4
  holeNames: string[]; // length 18, themed placeholder names (per hole)
  mapAsset: string; // path to bundled image/SVG
  rules?: string[]; // course-specific notes
  accent: string; // themed accent color (hex) for UI
};
