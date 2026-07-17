import { useSyncExternalStore } from 'react';
import { LOCATIONS } from '../data/courses';

// §4 The "current location" — which of the client's sites this device is
// playing at. A physical player is at one site, so we remember the choice
// (localStorage) and scope course lists / round setup to it, with a switcher.
// Everything downstream keys off the selected location id.

const KEY = 'ffc.currentLocationId';
const listeners = new Set<() => void>();

function isKnown(id: string | null): id is string {
  return !!id && LOCATIONS.some((l) => l.id === id);
}

/** The stored location id, or the first location as a safe default. Always
 *  returns a valid id so callers never handle an "unset" state. */
export function getCurrentLocationId(): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // Private mode / storage disabled — fall back to the default below.
  }
  return isKnown(stored) ? stored : LOCATIONS[0].id;
}

export function setCurrentLocationId(id: string): void {
  if (!isKnown(id)) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Non-fatal: the choice just won't persist across reloads.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Reactive read of the current location id — re-renders on switch. */
export function useCurrentLocationId(): string {
  return useSyncExternalStore(subscribe, getCurrentLocationId, getCurrentLocationId);
}
