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

// Per-course notes, keyed by theme (a course's `rules` is set from its theme
// below). Short, themed flavor that reads on the Rules screen. A theme shares
// notes across locations, so a course only carries a distinct theme when its
// decor is actually its own: Upland's Blue Course is California-themed
// (`california`) and its Green Course is classic-mini-golf-themed (`classic`),
// while every other venue's Blue/Green course stays on the generic `blue`/`green`
// placeholder until the client supplies that venue's real per-course rules (§11).
const THEME_RULES: Record<string, string[]> = {
  // Generic placeholders — Blue/Green courses that aren't yet individually themed.
  blue: [
    'Fast blue felt — the banks run quick, so ease off your backswing.',
    'Water comes into play on the back nine: fish your ball out and add one stroke.',
    'Several two-tier greens reward a firm, confident first putt.',
  ],
  green: [
    'Our gentlest layout — a good warm-up and friendly to younger players.',
    'Hedgerows line the fairways; a ball lost in the greenery is replayed where it entered.',
    'Time your putt through the windmill — the gate opens on a slow, steady turn.',
  ],
  // Upland · Blue Course — California-themed: coast, redwoods, Golden State icons.
  california: [
    'Coast holes run past a mini Golden Gate — thread the ball between the towers while the span is clear.',
    'Pacific water hazards guard the back nine: fish your ball out and add one stroke.',
    'Redwood shade and beach sand steal a fast ball’s speed — a firm, confident putt holds its line.',
  ],
  // Upland · Green Course — classic mini-golf: the timeless windmill/loop/clown.
  classic: [
    'Time your putt through the spinning windmill — the gate opens on a slow, steady turn.',
    'The loop-the-loop needs pace: hit it firm or the ball rolls right back to your feet.',
    'Bank it past the clown’s mouth and the wishing well — the classic banks reward a scouting look.',
  ],
  dragon: [
    'The dragon guards the mid-course — putt through while its jaws are open.',
    'The cavern holes play in low light; give downhill putts extra room.',
    'Commit fully to the loop — a timid putt rolls right back to your feet.',
  ],
  western: [
    'The mine-cart tunnel splits three ways — the left track feeds nearest the cup.',
    'Saloon doors swing shut fast; a ball they block is replayed with no penalty.',
    'Sand plays as ground here — no penalty, but it will steal your speed.',
  ],
  red: [
    'Our championship layout — tight banks and blind breaks reward a scouting lap.',
    'The volcano kicks balls out at random; play the rebound where it lies.',
    'Ridged carpet near the finish makes long putts wander — short and straight wins.',
  ],
};

export const COURSES: CourseSeed[] = [
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    locationId: LOC_UPLAND,
    name: 'Blue Course',
    // California-themed (Upland is the Golden State venue); keeps its blue accent.
    theme: 'california',
    holeCount: 18,
    pars: [3, 2, 3, 2, 3, 4, 2, 3, 2, 3, 3, 2, 4, 3, 2, 3, 2, 3],
    accent: '#3b82f6',
    rules: THEME_RULES.california,
  },
  {
    id: 'a2222222-2222-4222-8222-222222222222',
    locationId: LOC_UPLAND,
    name: 'Green Course',
    // Classic-mini-golf-themed; keeps its green accent.
    theme: 'classic',
    holeCount: 18,
    pars: [2, 3, 2, 3, 3, 2, 4, 3, 2, 3, 2, 3, 3, 4, 2, 3, 3, 2],
    accent: '#22c55e',
    rules: THEME_RULES.classic,
  },
  {
    id: 'a3333333-3333-4333-8333-333333333333',
    locationId: LOC_UPLAND,
    name: "Dragon's Hollow",
    theme: 'dragon',
    holeCount: 18,
    pars: [3, 3, 4, 2, 3, 3, 2, 4, 3, 2, 3, 4, 3, 2, 3, 3, 4, 2],
    accent: '#ea580c',
    rules: THEME_RULES.dragon,
  },
  {
    id: 'a4444444-4444-4444-8444-444444444444',
    locationId: LOC_UPLAND,
    name: 'Western',
    theme: 'western',
    holeCount: 18,
    pars: [2, 3, 3, 2, 4, 3, 2, 3, 3, 2, 4, 3, 2, 3, 3, 2, 3, 4],
    accent: '#b45309',
    rules: THEME_RULES.western,
  },
  {
    id: 'b1111111-1111-4111-8111-111111111111',
    locationId: LOC_TUKWILA,
    name: 'Blue Course',
    theme: 'blue',
    holeCount: 18,
    pars: [3, 2, 2, 3, 3, 2, 3, 4, 2, 3, 3, 2, 3, 2, 4, 3, 2, 3],
    accent: '#3b82f6',
    rules: THEME_RULES.blue,
  },
  {
    id: 'b2222222-2222-4222-8222-222222222222',
    locationId: LOC_TUKWILA,
    name: 'Green Course',
    theme: 'green',
    holeCount: 18,
    pars: [2, 3, 3, 2, 3, 3, 2, 3, 4, 2, 3, 2, 3, 3, 2, 4, 3, 2],
    accent: '#22c55e',
    rules: THEME_RULES.green,
  },
  {
    id: 'b3333333-3333-4333-8333-333333333333',
    locationId: LOC_TUKWILA,
    name: 'Red Course',
    theme: 'red',
    holeCount: 18,
    pars: [3, 3, 2, 4, 2, 3, 3, 2, 3, 4, 2, 3, 2, 3, 3, 2, 4, 3],
    accent: '#ef4444',
    rules: THEME_RULES.red,
  },
  {
    id: 'c1111111-1111-4111-8111-111111111111',
    locationId: LOC_WILSONVILLE,
    name: 'Blue Course',
    theme: 'blue',
    holeCount: 18,
    pars: [2, 3, 2, 3, 4, 2, 3, 2, 3, 3, 2, 4, 3, 2, 3, 2, 3, 3],
    accent: '#3b82f6',
    rules: THEME_RULES.blue,
  },
  {
    id: 'c2222222-2222-4222-8222-222222222222',
    locationId: LOC_WILSONVILLE,
    name: 'Green Course',
    theme: 'green',
    holeCount: 18,
    pars: [3, 2, 3, 3, 2, 4, 2, 3, 3, 2, 3, 2, 4, 3, 2, 3, 2, 3],
    accent: '#22c55e',
    rules: THEME_RULES.green,
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
