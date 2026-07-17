import type { CourseSeed } from '../types';

// §4 Four themed 18-hole courses. Pars are PLACEHOLDERS (values 2..4) until
// real course pars are supplied (§11). Map assets are placeholders too.
// Fixed UUIDs so the same seed loads 1:1 into the Postgres `course` table
// (via POST /api/seed or a one-off script) when the backend goes live.
//
// To regenerate placeholder pars, replace the arrays below — each must be
// length 18 with every value in 2..4.

export const COURSES: CourseSeed[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Jungle Run',
    theme: 'jungle',
    holeCount: 18,
    pars: [3, 2, 4, 3, 3, 2, 4, 3, 2, 3, 4, 3, 2, 3, 3, 4, 2, 3],
    mapAsset: '/maps/jungle-run.svg',
    accent: '#22c55e',
    rules: [
      'Water hazards on holes 7 and 14 — a ball in the water is replayed from the last dry spot, +1 stroke.',
      'The rope bridge on hole 11 counts as fairway; off the bridge is out of bounds.',
    ],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: "Pirate's Cove",
    theme: 'pirate',
    holeCount: 18,
    pars: [2, 3, 3, 4, 3, 2, 3, 4, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3],
    mapAsset: '/maps/pirates-cove.svg',
    accent: '#f59e0b',
    rules: [
      'The shipwreck ramp on hole 5 is in play — bank shots off the hull are allowed.',
      'Sand traps play as one penalty stroke to drop back onto the green.',
    ],
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Space Odyssey',
    theme: 'space',
    holeCount: 18,
    pars: [3, 3, 2, 4, 3, 3, 2, 3, 4, 3, 3, 2, 4, 3, 3, 2, 3, 4],
    mapAsset: '/maps/space-odyssey.svg',
    accent: '#818cf8',
    rules: [
      'The wormhole on hole 9 teleports your ball to the far tunnel exit — that is fair play, not a penalty.',
      'Low-gravity greens roll fast; a max of 6 strokes per hole applies.',
    ],
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Haunted Manor',
    theme: 'haunted',
    holeCount: 18,
    pars: [3, 4, 2, 3, 3, 4, 3, 2, 3, 4, 2, 3, 3, 4, 3, 2, 3, 3],
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
