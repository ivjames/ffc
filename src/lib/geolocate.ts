import { LOCATIONS } from '../data/courses';
import { distanceKm, type Coords } from './geo';

// §5 GPS venue detection. Picks the nearest configured location and reports
// whether the device is within that site's geofence. Every failure mode is a
// distinct status so the UI can fall back to the manual picker gracefully.

export const DEFAULT_GEOFENCE_KM = 25;

export type DetectResult =
  | { status: 'matched'; locationId: string; distanceKm: number }
  | { status: 'nomatch'; nearestId: string; distanceKm: number }
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'timeout' };

export type PermissionState = 'granted' | 'prompt' | 'denied' | 'unknown';

/** Geolocation only works over HTTPS (or localhost); feature-detect both. */
export function geolocationSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'geolocation' in navigator &&
    typeof window !== 'undefined' &&
    window.isSecureContext
  );
}

/** Read the current permission without prompting, when the browser supports
 *  the Permissions API. Used to decide whether we can auto-detect silently. */
export async function geoPermissionState(): Promise<PermissionState> {
  try {
    if (!('permissions' in navigator) || !navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state as PermissionState;
  } catch {
    return 'unknown';
  }
}

function nearest(coords: Coords): { id: string; geofenceKm: number; km: number } {
  let best: { id: string; geofenceKm: number; km: number } | null = null;
  for (const loc of LOCATIONS) {
    const km = distanceKm(coords, { lat: loc.lat, lng: loc.lng });
    if (!best || km < best.km) {
      best = { id: loc.id, geofenceKm: loc.geofenceKm ?? DEFAULT_GEOFENCE_KM, km };
    }
  }
  // LOCATIONS is never empty in this app.
  return best!;
}

function getPosition(timeoutMs = 10000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: timeoutMs,
      maximumAge: 60_000, // a minute-old fix is fine for venue detection
    });
  });
}

/** Attempt to detect the nearest in-range venue. May prompt for permission if
 *  it hasn't been granted/denied yet — call from a user gesture in that case. */
export async function detectNearestLocation(): Promise<DetectResult> {
  if (!geolocationSupported()) return { status: 'unavailable' };
  try {
    const pos = await getPosition();
    const here: Coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const n = nearest(here);
    return n.km <= n.geofenceKm
      ? { status: 'matched', locationId: n.id, distanceKm: n.km }
      : { status: 'nomatch', nearestId: n.id, distanceKm: n.km };
  } catch (err) {
    const code = (err as GeolocationPositionError)?.code;
    if (code === 1) return { status: 'denied' }; // PERMISSION_DENIED
    if (code === 3) return { status: 'timeout' }; // TIMEOUT
    return { status: 'unavailable' }; // POSITION_UNAVAILABLE / other
  }
}
