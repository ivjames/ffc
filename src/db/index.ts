import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LocalRound } from '../types';
import { HOLE_COUNT } from '../lib/scoring';

// §4 IndexedDB wrapper — the offline source of truth for round state.
// Active rounds persist here on every stroke edit so a refresh/crash never
// loses a game; completed rounds stay here (syncState) until the sync worker
// pushes them to the API.

interface FfcDB extends DBSchema {
  rounds: {
    key: string; // clientId
    value: LocalRound;
    indexes: { 'by-sync': string };
  };
}

const DB_NAME = 'ffc';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FfcDB>> | null = null;

function getDB(): Promise<IDBPDatabase<FfcDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FfcDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('rounds', { keyPath: 'clientId' });
        store.createIndex('by-sync', 'syncState');
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
