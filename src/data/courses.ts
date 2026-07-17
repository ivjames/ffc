import type { CourseSeed, LocationSeed } from '../types';

// §4 White-label content. The first client operates THREE locations, each with
// its own distinct courses (a course belongs to exactly one location). The nine
// courses and their names are the client's real lineup; `pars` are still
// PLACEHOLDERS (length 18, values 2..4) until real pars are supplied, and
// per-course `holeNames`, `mapAsset`, and `rules` are omitted until known — the
// UI falls back to the hole number / a "map coming soon" state meanwhile (§11).
// Fixed UUIDs so the same seed loads 1:1 into the Postgres `location`/`course`
// tables (via schema seed or POST /api/seed).

// Stable site ids — one 'letter' per location, mirroring the numeric course
// ids. Opaque keys (kept stable even as names/coords change); they land in the
// `location` table 1:1.
const LOC_UPLAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOC_TUKWILA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOC_WILSONVILLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Bullwinkle's three venues, with exact coordinates geocoded from the street
// addresses. The 2 km geofence covers each property + parking + GPS drift while
// meaning "you're actually here"; the sites are hundreds of km apart, so there
// is no overlap. Addresses:
//   Upland      — 1560 W 7th St, Upland, CA 91786
//   Tukwila     — 7300 Fun Center Way, Tukwila, WA 98188
//   Wilsonville — 29111 SW Town Center Loop W, Wilsonville, OR 97070
export const LOCATIONS: LocationSeed[] = [
  {
    id: LOC_UPLAND,
    name: 'Upland',
    slug: 'upland',
    accent: '#38bdf8',
    lat: 34.08867,
    lng: -117.67946,
    geofenceKm: 2,
    sortOrder: 10,
  },
  {
    id: LOC_TUKWILA,
    name: 'Tukwila',
    slug: 'tukwila',
    accent: '#f472b6',
    lat: 47.46562,
    lng: -122.24302,
    geofenceKm: 2,
    sortOrder: 20,
  },
  {
    id: LOC_WILSONVILLE,
    name: 'Wilsonville',
    slug: 'wilsonville',
    accent: '#facc15',
    lat: 45.30969,
    lng: -122.7668,
    geofenceKm: 2,
    sortOrder: 30,
  },
];

export const COURSES: CourseSeed[] = [
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    locationId: LOC_UPLAND,
    name: 'Blue Course',
    theme: 'blue',
    holeCount: 18,
    pars: [3, 2, 3, 2, 3, 4, 2, 3, 2, 3, 3, 2, 4, 3, 2, 3, 2, 3],
    accent: '#3b82f6',
  },
  {
    id: 'a2222222-2222-4222-8222-222222222222',
    locationId: LOC_UPLAND,
    name: 'Green Course',
    theme: 'green',
    holeCount: 18,
    pars: [2, 3, 2, 3, 3, 2, 4, 3, 2, 3, 2, 3, 3, 4, 2, 3, 3, 2],
    accent: '#22c55e',
  },
  {
    id: 'a3333333-3333-4333-8333-333333333333',
    locationId: LOC_UPLAND,
    name: "Dragon's Hollow",
    theme: 'dragon',
    holeCount: 18,
    pars: [3, 3, 4, 2, 3, 3, 2, 4, 3, 2, 3, 4, 3, 2, 3, 3, 4, 2],
    accent: '#ea580c',
  },
  {
    id: 'a4444444-4444-4444-8444-444444444444',
    locationId: LOC_UPLAND,
    name: 'Western',
    theme: 'western',
    holeCount: 18,
    pars: [2, 3, 3, 2, 4, 3, 2, 3, 3, 2, 4, 3, 2, 3, 3, 2, 3, 4],
    accent: '#b45309',
  },
  {
    id: 'b1111111-1111-4111-8111-111111111111',
    locationId: LOC_TUKWILA,
    name: 'Blue Course',
    theme: 'blue',
    holeCount: 18,
    pars: [3, 2, 2, 3, 3, 2, 3, 4, 2, 3, 3, 2, 3, 2, 4, 3, 2, 3],
    accent: '#3b82f6',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222222',
    locationId: LOC_TUKWILA,
    name: 'Green Course',
    theme: 'green',
    holeCount: 18,
    pars: [2, 3, 3, 2, 3, 3, 2, 3, 4, 2, 3, 2, 3, 3, 2, 4, 3, 2],
    accent: '#22c55e',
  },
  {
    id: 'b3333333-3333-4333-8333-333333333333',
    locationId: LOC_TUKWILA,
    name: 'Red Course',
    theme: 'red',
    holeCount: 18,
    pars: [3, 3, 2, 4, 2, 3, 3, 2, 3, 4, 2, 3, 2, 3, 3, 2, 4, 3],
    accent: '#ef4444',
  },
  {
    id: 'c1111111-1111-4111-8111-111111111111',
    locationId: LOC_WILSONVILLE,
    name: 'Blue Course',
    theme: 'blue',
    holeCount: 18,
    pars: [2, 3, 2, 3, 4, 2, 3, 2, 3, 3, 2, 4, 3, 2, 3, 2, 3, 3],
    accent: '#3b82f6',
  },
  {
    id: 'c2222222-2222-4222-8222-222222222222',
    locationId: LOC_WILSONVILLE,
    name: 'Green Course',
    theme: 'green',
    holeCount: 18,
    pars: [3, 2, 3, 3, 2, 4, 2, 3, 3, 2, 3, 2, 4, 3, 2, 3, 2, 3],
    accent: '#22c55e',
  },
];

export function courseById(id: string): CourseSeed | undefined {
  return COURSES.find((c) => c.id === id);
}

export function locationById(id: string): LocationSeed | undefined {
  return LOCATIONS.find((l) => l.id === id);
}

/** Courses that belong to a given location (distinct per location). */
export function coursesByLocation(locationId: string): CourseSeed[] {
  return COURSES.filter((c) => c.locationId === locationId);
}
