import { useSyncExternalStore } from 'react';
import { detectNearestLocation, type DetectResult } from './geolocate';

// On-location presence — is this device physically at one of the operator's
// venues right now? The on-location gate (src/features/shared/GeofenceGate.tsx)
// reads this to decide whether food, games, and golf are allowed. Detection
// reuses the venue geofence logic in geolocate.ts; this module just tracks the
// latest result reactively and de-dupes concurrent checks.
//
// "On location" means within SOME venue's geofence (the one you're standing
// in), not necessarily the currently-selected one — being at any of the
// operator's sites counts as on-site.

export type Presence =
  | { status: 'idle' } // not checked yet this session
  | { status: 'checking' } // GPS lookup in flight
  | { status: 'on-site'; locationId: string } // within a venue's geofence
  | { status: 'off-site' } // located, but outside every geofence
  | { status: 'unconfirmed'; reason: 'denied' | 'unavailable' | 'timeout' }; // no fix

/** Map a raw geofence detection into a presence verdict. Pure — the gate's
 *  decision logic is unit-testable without GPS. Anything short of a confirmed
 *  in-geofence match is treated as "not confirmed on-site" (the gate blocks),
 *  because the whole point is to require verified physical presence. */
export function presenceFromDetect(r: DetectResult): Presence {
  if (r.status === 'matched') return { status: 'on-site', locationId: r.locationId };
  if (r.status === 'nomatch') return { status: 'off-site' };
  return { status: 'unconfirmed', reason: r.status };
}

let state: Presence = { status: 'idle' };
const listeners = new Set<() => void>();

function emit(next: Presence): void {
  state = next;
  listeners.forEach((cb) => cb());
}

// De-dupe: a burst of gated navigations shouldn't fire multiple GPS lookups.
let inFlight: Promise<void> | null = null;

/** Run (or join) an on-location check and publish the result. Best-effort: a
 *  denied/unavailable fix resolves to 'unconfirmed', never throws. */
export function refreshPresence(): Promise<void> {
  if (inFlight) return inFlight;
  emit({ status: 'checking' });
  inFlight = detectNearestLocation()
    .then((r) => emit(presenceFromDetect(r)))
    .catch(() => emit({ status: 'unconfirmed', reason: 'unavailable' }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): Presence {
  return state;
}

/** Reactive read of the current presence verdict. */
export function usePresence(): Presence {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
