import { useSyncExternalStore } from 'react';

// The player's linked rewards card — which CenterEdge player account this
// device belongs to. Stored after a successful lookup on /rewards; food
// checkout attaches it to orders and mini-games use it to credit tickets.
// Same store idiom as lib/location.ts.

const KEY = 'ffc.rewardsPlayerId';
const listeners = new Set<() => void>();

let playerId: string | null = read();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function getLinkedPlayerId(): string | null {
  return playerId;
}

export function setLinkedPlayerId(id: string | null): void {
  playerId = id;
  try {
    if (id === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch {
    // Non-fatal: the link just won't persist across reloads.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Reactive read of the linked player id — re-renders on link/unlink. */
export function useLinkedPlayerId(): string | null {
  return useSyncExternalStore(subscribe, getLinkedPlayerId, getLinkedPlayerId);
}
