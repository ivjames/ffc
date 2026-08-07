import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LocalRound, OutboxEntry } from '../types';
import { HOLE_COUNT } from '../lib/scoring';

// §4 IndexedDB wrapper — the offline source of truth for round state.
// Active rounds persist here on every stroke edit so a refresh/crash never
// loses a game; completed rounds stay here (syncState) until the sync worker
// pushes them to the API. v2 adds the shared-game outbox: cell writes queued
// while offline/mid-flight, drained to POST /api/games/:id/scores.

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
}

const DB_NAME = 'ffc';
const DB_VERSION = 2;

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

/** Build a fresh, empty active round for the given course + roster. */
export function createLocalRound(courseId: string, playerTags: string[]): LocalRound {
  const scores: Record<number, (number | null)[]> = {};
  for (let p = 0; p < playerTags.length; p++) {
    scores[p] = Array<number | null>(HOLE_COUNT).fill(null);
  }
  return {
    clientId: newClientId(),
    courseId,
    playerTags,
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
