// Great-circle distance helpers for GPS venue detection.

export type Coords = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371;
const MILES_PER_KM = 0.621371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Convert kilometers to miles (for US-facing distance display). */
export function kmToMiles(km: number): number {
  return km * MILES_PER_KM;
}

/** Haversine distance in kilometers between two lat/lng points. */
export function distanceKm(a: Coords, b: Coords): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
