import { useSyncExternalStore } from 'react';
import { LOCATIONS } from '../data/courses';

// §4 The "current location" — which of the client's sites this device is
// playing at. A physical player is at one site, so we remember the choice
// (localStorage) and scope course lists / round setup to it, with a switcher.
// Everything downstream keys off the selected location id.

const KEY = 'ffc.currentLocationId';
// Set when the player picked a site by hand. A pinned choice is not overridden
// by GPS auto-detect; "Use my location" clears it.
const KEY_PINNED = 'ffc.locationPinned';
const listeners = new Set<() => void>();

function isKnown(id: string | null): id is string {
  return !!id && LOCATIONS.some((l) => l.id === id);
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Non-fatal: the choice just won't persist across reloads.
  }
}

/** The stored location id, or the first location as a safe default. Always
 *  returns a valid id so callers never handle an "unset" state. */
export function getCurrentLocationId(): string {
  const stored = read(KEY);
  return isKnown(stored) ? stored : LOCATIONS[0].id;
}

/** True when the current site was chosen by hand (so GPS shouldn't override). */
export function isLocationPinned(): boolean {
  return read(KEY_PINNED) === '1';
}

/**
 * Set the current site. `source` records how it was chosen:
 *  - 'manual' (default): the player picked it — pin it against GPS override.
 *  - 'auto': GPS detected it — leave it unpinned so detection can keep it fresh.
 */
export function setCurrentLocationId(id: string, source: 'manual' | 'auto' = 'manual'): void {
  if (!isKnown(id)) return;
  write(KEY, id);
  write(KEY_PINNED, source === 'manual' ? '1' : null);
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
