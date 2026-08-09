import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LocalRound, OutboxEntry } from '../types';
import { HOLE_COUNT } from '../lib/scoring';

// §4 IndexedDB wrapper — the offline source of truth for round state.
// Active rounds persist here on every stroke edit so a refresh/crash never
// loses a game; completed rounds stay here (syncState) until the sync worker
// pushes them to the API. v2 adds the shared-game outbox: cell writes queued
// while offline/mid-flight, drained to POST /api/games/:id/scores.

// A placed sticker in a photo-booth draft. Mirrors the editor's own sticker
// shape (features/photos/PhotoBooth.tsx imports this as its Sticker type) so
// there's a single definition. Coordinates are fractions of the photo (0..1),
// so a draft re-opens identically at any display size.
//
// A sticker is one of two kinds, discriminated by which field is set:
//  - `emoji` — a built-in Unicode emoji (the default sheet)
//  - `svgId` — a venue-uploaded SVG sticker (server booth_sticker id); on
//    re-edit it's re-fetched from the venue and re-rasterized. If the venue has
//    since removed it, the draft drops that one sticker and keeps the rest.
// Older drafts predate svgId and always carry `emoji`, so this stays backward
// compatible with no IndexedDB migration.
export interface BoothSticker {
  id: number;
  x: number;
  y: number;
  scale: number;
  rot: number;
  emoji?: string;
  svgId?: string;
  // Intrinsic size of an SVG sticker, captured when placed so a reopened draft
  // exports at the right aspect even if the venue's sticker metadata isn't
  // loaded (or the device has since switched venues).
  svgW?: number;
  svgH?: number;
}

// The editable source behind a saved booth photo, kept ONLY on the device that
// made it (never uploaded — the server keeps just the flattened JPEG). Lets the
// player re-open a saved photo, move/add/remove stickers, and re-flatten.
// Keyed by the server photo id it corresponds to. `base` is the undecorated
// photo (already downscaled to the export cap); re-flattening base + stickers
// reproduces the picture. Naturally per-device and ephemeral, like the booth.
export interface BoothPhotoDraft {
  id: string; // the server booth_photo id
  base: Blob; // undecorated photo (normalized to the export long-edge cap)
  stickers: BoothSticker[];
  updatedAt: number;
}

interface FfcDB extends DBSchema {
  rounds: {
    key: string; // clientId
    value: LocalRound;
    indexes: { 'by-sync': string };
  };
  outbox: {
    key: number; // auto-increment
    value: OutboxEntry;
    indexes: { 'by-game': string };
  };
  boothDrafts: {
    key: string; // the server booth_photo id
    value: BoothPhotoDraft;
  };
}

const DB_NAME = 'ffc';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<FfcDB>> | null = null;

function getDB(): Promise<IDBPDatabase<FfcDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FfcDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('rounds', { keyPath: 'clientId' });
          store.createIndex('by-sync', 'syncState');
        }
        if (oldVersion < 2) {
          const outbox = db.createObjectStore('outbox', { autoIncrement: true });
          outbox.createIndex('by-game', 'gameId');
        }
        if (oldVersion < 3) {
          // Photo-booth editable drafts, keyed by the server photo id.
          db.createObjectStore('boothDrafts', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/** A UUID for a new round's clientId. crypto.randomUUID is available in all
 *  secure contexts (which the PWA requires anyway). */
function newClientId(): string {
  return crypto.randomUUID();
}

/** Build a fresh, empty active round for the given course + roster (and an
 *  optional team tag — punchlist #4 tier 1). */
export function createLocalRound(
  courseId: string,
  playerTags: string[],
  groupTag: string | null = null,
): LocalRound {
  const scores: Record<number, (number | null)[]> = {};
  for (let p = 0; p < playerTags.length; p++) {
    scores[p] = Array<number | null>(HOLE_COUNT).fill(null);
  }
  return {
    clientId: newClientId(),
    courseId,
    playerTags,
    groupTag,
    scores,
    createdAt: Date.now(),
    completedAt: null,
    syncState: 'active',
  };
}

export async function putRound(round: LocalRound): Promise<void> {
  const db = await getDB();
  await db.put('rounds', round);
}

export async function getRound(clientId: string): Promise<LocalRound | undefined> {
  const db = await getDB();
  return db.get('rounds', clientId);
}

export async function getAllRounds(): Promise<LocalRound[]> {
  const db = await getDB();
  return db.getAll('rounds');
}

export async function getRoundsBySync(state: LocalRound['syncState']): Promise<LocalRound[]> {
  const db = await getDB();
  return db.getAllFromIndex('rounds', 'by-sync', state);
}

/** The most recent still-active (in-progress) round, if any — for "Resume". */
export async function getActiveRound(): Promise<LocalRound | undefined> {
  const active = await getRoundsBySync('active');
  active.sort((a, b) => b.createdAt - a.createdAt);
  return active[0];
}

export async function deleteRound(clientId: string): Promise<void> {
  const db = await getDB();
  await db.delete('rounds', clientId);
}

// --- Shared-game outbox ------------------------------------------------------

export async function enqueueOutbox(entry: OutboxEntry): Promise<void> {
  const db = await getDB();
  await db.add('outbox', entry);
}

/** All queued writes for one game, oldest first, with their store keys. */
export async function getOutbox(
  gameId: string,
): Promise<{ key: number; entry: OutboxEntry }[]> {
  const db = await getDB();
  const tx = db.transaction('outbox', 'readonly');
  const out: { key: number; entry: OutboxEntry }[] = [];
  for (
    let cursor = await tx.store.index('by-game').openCursor(gameId);
    cursor;
    cursor = await cursor.continue()
  ) {
    out.push({ key: cursor.primaryKey, entry: cursor.value });
  }
  return out;
}

/** Remove delivered writes by store key. */
export async function clearOutbox(keys: number[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('outbox', 'readwrite');
  await Promise.all(keys.map((k) => tx.store.delete(k)));
  await tx.done;
}

// --- Photo-booth drafts ------------------------------------------------------

export async function putBoothDraft(draft: BoothPhotoDraft): Promise<void> {
  const db = await getDB();
  await db.put('boothDrafts', draft);
}

export async function getBoothDraft(id: string): Promise<BoothPhotoDraft | undefined> {
  const db = await getDB();
  return db.get('boothDrafts', id);
}

export async function deleteBoothDraft(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('boothDrafts', id);
}

/** Ids of every saved photo that has a local editable draft — for the gallery
 *  to mark which photos can be re-opened in the editor. */
export async function getBoothDraftIds(): Promise<string[]> {
  const db = await getDB();
  return db.getAllKeys('boothDrafts');
}

/** Drop drafts whose photo the server no longer has (deleted by the player on
 *  another device, by staff, or by the retention sweep). Pass the ids the
 *  server currently reports; call ONLY after a successful, complete fetch so a
 *  transient empty list never wipes live drafts. */
export async function pruneBoothDrafts(liveIds: Iterable<string>): Promise<void> {
  const keep = new Set(liveIds);
  const db = await getDB();
  const tx = db.transaction('boothDrafts', 'readwrite');
  for (
    let cursor = await tx.store.openCursor();
    cursor;
    cursor = await cursor.continue()
  ) {
    if (!keep.has(cursor.key)) await cursor.delete();
  }
  await tx.done;
}
