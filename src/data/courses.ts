import type { CourseSeed, LocationSeed } from '../types';

// §4 White-label content. The first client operates THREE locations, and each
// location has its own distinct courses (a course belongs to exactly one
// location). Locations, courses, pars, and hole names are all PLACEHOLDERS
// until the client's real sites/courses are supplied (§11). Map assets are
// placeholders too. Fixed UUIDs so the same seed loads 1:1 into the Postgres
// `location`/`course` tables (via schema seed or POST /api/seed).
//
// The placeholder split spreads the four themed courses across the three sites
// (2 / 1 / 1) so both multi-course and single-course locations are exercised;
// it swaps out wholesale for the client's real per-site course lists.
//
// To regenerate placeholder pars, replace the `pars` arrays below — each must
// be length 18 with every value in 2..4. Hole names in `holeNames` are themed
// flavor (length 18) and swap out wholesale for the client's real hole names.

// Stable site ids — one 'letter' per location, mirroring the numeric course
// ids. Opaque keys (kept stable even as names/coords change); they land in the
// `location` table 1:1.
const LOC_UPLAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOC_TUKWILA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOC_WILSONVILLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// The client's three venues. Coordinates are city-center approximations until
// exact venue addresses are supplied — the 25 km geofence comfortably covers
// each city, and the sites are hundreds of km apart so there is no overlap.
// Tighten geofenceKm (~1 km) once precise venue coords land (§11).
export const LOCATIONS: LocationSeed[] = [
  {
    id: LOC_UPLAND,
    name: 'Upland',
    slug: 'upland',
    accent: '#38bdf8',
    lat: 34.0975,
    lng: -117.6484,
    geofenceKm: 25,
    sortOrder: 10,
  },
  {
    id: LOC_TUKWILA,
    name: 'Tukwila',
    slug: 'tukwila',
    accent: '#f472b6',
    lat: 47.4739,
    lng: -122.2612,
    geofenceKm: 25,
    sortOrder: 20,
  },
  {
    id: LOC_WILSONVILLE,
    name: 'Wilsonville',
    slug: 'wilsonville',
    accent: '#facc15',
    lat: 45.3132,
    lng: -122.7737,
    geofenceKm: 25,
    sortOrder: 30,
  },
];

export const COURSES: CourseSeed[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    locationId: LOC_UPLAND,
    name: 'Jungle Run',
    theme: 'jungle',
    holeCount: 18,
    pars: [3, 2, 4, 3, 3, 2, 4, 3, 2, 3, 4, 3, 2, 3, 3, 4, 2, 3],
    holeNames: [
      'Vine Swing',
      "Tiger's Leap",
      'Monkey Business',
      'Snake Pit',
      'Canopy Climb',
      'Toucan Turn',
      'Croc Creek', // water hazard (see rules)
      "Jaguar's Jaws",
      'Fern Gully',
      'Parrot Pass',
      'Rope Bridge', // the rope bridge hole (see rules)
      'Quicksand Bend',
      'Panther Prowl',
      'Waterfall Way', // water hazard (see rules)
      'Gorilla Grove',
      'Temple Ruins',
      'Jungle Drums',
      'Lost Idol',
    ],
    mapAsset: '/maps/jungle-run.svg',
    accent: '#22c55e',
    rules: [
      'Water hazards on holes 7 and 14 — a ball in the water is replayed from the last dry spot, +1 stroke.',
      'The rope bridge on hole 11 counts as fairway; off the bridge is out of bounds.',
    ],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    locationId: LOC_UPLAND,
    name: "Pirate's Cove",
    theme: 'pirate',
    holeCount: 18,
    pars: [2, 3, 3, 4, 3, 2, 3, 4, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3],
    holeNames: [
      'Cannon Run',
      "Davy Jones",
      'Plank Walk',
      "Kraken's Grip",
      'Shipwreck Ramp', // the hull ramp hole (see rules)
      'Cutlass Curve',
      'Treasure Bay',
      'Skull Rock',
      "Anchors Aweigh",
      'Parrot Perch',
      'Powder Keg',
      'Mermaid Lagoon',
      'Buccaneer Bend',
      'Cannonball Cove',
      'Jolly Roger',
      'Doubloon Drop',
      "Crow's Nest",
      "Dead Man's Chest",
    ],
    mapAsset: '/maps/pirates-cove.svg',
    accent: '#f59e0b',
    rules: [
      'The shipwreck ramp on hole 5 is in play — bank shots off the hull are allowed.',
      'Sand traps play as one penalty stroke to drop back onto the green.',
    ],
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    locationId: LOC_TUKWILA,
    name: 'Space Odyssey',
    theme: 'space',
    holeCount: 18,
    pars: [3, 3, 2, 4, 3, 3, 2, 3, 4, 3, 3, 2, 4, 3, 3, 2, 3, 4],
    holeNames: [
      'Launch Pad',
      'Lunar Landing',
      'Asteroid Belt',
      'Comet Trail',
      'Nebula Nine',
      "Saturn's Rings",
      'Meteor Shower',
      'Solar Flare',
      'Wormhole', // teleport hole (see rules)
      'Galaxy Gate',
      'Zero-G Zone',
      'Red Planet',
      'Black Hole',
      'Star Cluster',
      'Cosmic Drift',
      'Satellite Sweep',
      'Alien Outpost',
      'Mission Control',
    ],
    mapAsset: '/maps/space-odyssey.svg',
    accent: '#818cf8',
    rules: [
      'The wormhole on hole 9 teleports your ball to the far tunnel exit — that is fair play, not a penalty.',
      'Low-gravity greens roll fast; a max of 6 strokes per hole applies.',
    ],
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    locationId: LOC_WILSONVILLE,
    name: 'Haunted Manor',
    theme: 'haunted',
    holeCount: 18,
    pars: [3, 4, 2, 3, 3, 4, 3, 2, 3, 4, 2, 3, 3, 4, 3, 2, 3, 3],
    holeNames: [
      'Creaky Gate',
      'Cobweb Corner',
      'Rattling Bones',
      'Phantom Foyer',
      'Candle Hall',
      'Spinning Gate', // timed gate hole (see rules)
      "Witch's Brew",
      'Bat Belfry',
      'Moonlit Maze',
      'Cursed Cellar',
      'Ghostly Gallery',
      "Raven's Roost",
      'Crypt Drop', // hole-in-one shortcut (see rules)
      'Howling Hall',
      'Shadow Stair',
      'Pumpkin Patch',
      'Cauldron Curve',
      'Final Rest',
    ],
    mapAsset: '/maps/haunted-manor.svg',
    accent: '#a855f7',
    rules: [
      'The spinning gate on hole 6 must be timed — a blocked ball rolls back, no penalty.',
      'The crypt drop on hole 13 is a hole-in-one shortcut if you thread the gap.',
    ],
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
