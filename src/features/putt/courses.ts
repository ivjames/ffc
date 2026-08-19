// Arcade Putt's course book — every fixed nine-hole course the game offers.
// Pure data (no React, no canvas): the game component, the offline validator
// (scripts/putt-sim.ts) and the map renderer (scripts/putt-render.ts) all read
// the same list, so a course that validates is exactly the course that ships.
//
// Authoring rules live in PROCEDURAL_HOLES.md and are enforced by
// `npm run putt:sim` — run it after touching any hole here.
//
// A course's `key` is also its high-score sub-board key on the server
// (server/lib/gameScores.js) and the `?variant=` a challenge deep-links with.
// Keys are wire format: never rename one that has scores against it. The
// original course keeps its historical key 'course' for exactly that reason.

import { cap, disc, HOLES, type Hole } from './world.ts';

export type Course = {
  /** Wire key — the score board variant and the challenge `?variant=`. */
  key: string;
  /** Display name, matching the variant label in server/lib/gameScores.js. */
  label: string;
  /** One line on the picker: what this course throws at you. */
  blurb: string;
  holes: Hole[];
};

// --- Creekside — water everywhere: ponds, creeks and a puddle on the green ---
const CREEKSIDE: Hole[] = [
  // 1 — warm-up: straight and wide, one small pond nibbling the right edge.
  {
    par: 2,
    tee: { x: 180, y: 470 },
    cup: { x: 180, y: 140 },
    fairway: [cap(180, 486, 180, 176, 40)],
    green: [disc(180, 140, 54)],
    water: [disc(202, 320, 14), disc(200, 292, 12)],
  },
  // 2 — dogleg left with a pond tucked into the first lane; hug the outside.
  {
    par: 3,
    tee: { x: 268, y: 468 },
    cup: { x: 84, y: 168 },
    fairway: [cap(268, 498, 256, 268, 40), cap(256, 268, 84, 190, 40)],
    green: [disc(84, 168, 52)],
    water: [disc(240, 340, 13), disc(238, 368, 12)],
  },
  // 3 — the gate: twin ponds pinch the middle of a wide fairway, with two
  // staggered outriders so neither flank is a free run.
  {
    par: 3,
    tee: { x: 180, y: 472 },
    cup: { x: 180, y: 132 },
    fairway: [cap(180, 466, 180, 180, 70)],
    green: [disc(180, 132, 56)],
    water: [disc(130, 300, 16), disc(230, 300, 16), disc(148, 272, 12), disc(212, 328, 12)],
  },
  // 4 — the creek: a chain of water crosses the fairway leaving one dry lane on
  // the right, with rough making the safe side cost some pace.
  {
    par: 3,
    tee: { x: 180, y: 448 },
    cup: { x: 180, y: 136 },
    fairway: [cap(180, 452, 180, 196, 80)],
    green: [disc(180, 136, 58)],
    water: [disc(116, 290, 14), disc(148, 296, 14), disc(180, 302, 14), disc(208, 296, 13)],
    rough: [disc(246, 346, 14), disc(250, 316, 12)],
  },
  // 5 — around the bend: an L up the left side, a pond sitting mid-lane on the
  // run in to the green.
  {
    par: 3,
    tee: { x: 92, y: 470 },
    cup: { x: 268, y: 172 },
    fairway: [cap(92, 494, 92, 250, 38), cap(92, 250, 262, 196, 38)],
    green: [disc(268, 172, 54)],
    water: [disc(183, 242, 14), disc(214, 233, 12)],
  },
  // 6 — the puddle green: a pond ON the putting surface, lower-left of the cup.
  {
    par: 3,
    tee: { x: 180, y: 472 },
    cup: { x: 196, y: 124 },
    fairway: [cap(180, 486, 180, 196, 30)],
    green: [disc(180, 140, 62)],
    water: [disc(150, 160, 12), disc(145, 170, 11)],
  },
  // 7 — the long S: two lanes of water to skirt on the way up the far side.
  {
    par: 4,
    tee: { x: 84, y: 478 },
    cup: { x: 248, y: 132 },
    fairway: [cap(84, 500, 96, 330, 34), cap(96, 330, 264, 290, 34), cap(264, 290, 252, 150, 34)],
    green: [disc(248, 132, 54)],
    water: [disc(184, 326, 14), disc(216, 320, 12), disc(244, 220, 13)],
  },
  // 8 — twin lakes flank a big green; the middle line is the only dry one.
  {
    par: 3,
    tee: { x: 180, y: 474 },
    cup: { x: 180, y: 120 },
    fairway: [cap(180, 494, 180, 240, 28)],
    green: [disc(180, 150, 74)],
    water: [disc(126, 128, 13), disc(234, 168, 13)],
  },
  // 9 — finale: a dogleg right with water early, water late, and rough at the
  // elbow — every lazy line finds something wet.
  {
    par: 4,
    tee: { x: 84, y: 472 },
    cup: { x: 278, y: 160 },
    fairway: [cap(84, 498, 90, 320, 38), cap(90, 320, 238, 268, 38), cap(238, 268, 272, 190, 38)],
    green: [disc(278, 160, 58)],
    water: [disc(108, 420, 13), disc(238, 230, 12)],
    rough: [disc(120, 300, 16), disc(146, 310, 14)],
  },
];

// --- The Dunes — sand country: bunkers, waste patches and a ringed green -----
const DUNES: Hole[] = [
  // 1 — warm-up: straight at it, one bunker squatting on the direct line.
  {
    par: 2,
    tee: { x: 180, y: 470 },
    cup: { x: 180, y: 138 },
    fairway: [cap(180, 486, 180, 176, 40)],
    green: [disc(180, 138, 56)],
    pits: [disc(180, 320, 16), disc(182, 292, 13)],
  },
  // 2 — dogleg left with sand piled into the elbow; rough rides the outside.
  {
    par: 3,
    tee: { x: 268, y: 468 },
    cup: { x: 74, y: 168 },
    fairway: [cap(268, 498, 256, 268, 40), cap(256, 268, 74, 190, 40)],
    green: [disc(74, 168, 52)],
    pits: [disc(250, 250, 16), disc(230, 276, 14)],
    rough: [disc(300, 320, 18), disc(296, 350, 16)],
  },
  // 3 — the weave: a diagonal chain of three bunkers across a wide fairway.
  {
    par: 3,
    tee: { x: 180, y: 472 },
    cup: { x: 180, y: 134 },
    fairway: [cap(180, 464, 180, 190, 72)],
    green: [disc(180, 134, 56)],
    pits: [disc(140, 340, 16), disc(180, 300, 16), disc(220, 260, 16)],
  },
  // 4 — the horseshoe: up the left, across the top, sand seeded along the
  // crossing so a flat-out second shot gets caught.
  {
    par: 4,
    tee: { x: 84, y: 478 },
    cup: { x: 276, y: 196 },
    fairway: [cap(84, 496, 84, 160, 36), cap(84, 160, 268, 140, 36)],
    green: [disc(276, 196, 54)],
    pits: [disc(160, 152, 15), disc(120, 176, 13)],
    rough: [disc(60, 420, 16), disc(58, 384, 14)],
  },
  // 5 — the waste land: rough down both edges and a pot bunker dead centre;
  // only the clean middle line keeps its pace.
  {
    par: 3,
    tee: { x: 180, y: 470 },
    cup: { x: 180, y: 142 },
    fairway: [cap(180, 476, 180, 200, 60)],
    green: [disc(180, 142, 54)],
    pits: [disc(180, 250, 14)],
    rough: [
      disc(134, 420, 18),
      disc(132, 380, 16),
      disc(228, 400, 18),
      disc(226, 360, 16),
      disc(136, 300, 16),
      disc(224, 280, 16),
    ],
  },
  // 6 — the donut: sand rings the lower half of the green, one clean front door.
  {
    par: 3,
    tee: { x: 180, y: 472 },
    cup: { x: 180, y: 140 },
    fairway: [cap(180, 486, 180, 210, 26)],
    green: [disc(180, 140, 64)],
    pits: [disc(223, 156, 12), disc(203, 180, 12), disc(157, 180, 12), disc(137, 156, 12)],
  },
  // 7 — dogleg right, bunkers on the inside corner: cut it and pay, or go wide.
  {
    par: 3,
    tee: { x: 92, y: 468 },
    cup: { x: 286, y: 168 },
    fairway: [cap(92, 498, 104, 268, 40), cap(104, 268, 286, 190, 40)],
    green: [disc(286, 168, 52)],
    pits: [disc(150, 240, 14), disc(128, 260, 13)],
  },
  // 8 — the gauntlet of gates: staggered pot bunkers down a long, narrow lane.
  {
    par: 3,
    tee: { x: 180, y: 478 },
    cup: { x: 180, y: 124 },
    fairway: [cap(180, 496, 180, 150, 34)],
    green: [disc(180, 124, 50)],
    pits: [disc(196, 400, 14), disc(162, 330, 14), disc(198, 260, 14), disc(164, 196, 13)],
  },
  // 9 — finale: a sweeping S through the dunes, sand waiting at both turns.
  {
    par: 5,
    tee: { x: 84, y: 478 },
    cup: { x: 104, y: 180 },
    fairway: [cap(84, 500, 96, 340, 36), cap(96, 340, 260, 300, 36), cap(260, 300, 120, 210, 36)],
    green: [disc(104, 180, 56)],
    pits: [disc(180, 330, 15), disc(214, 328, 13), disc(180, 262, 14)],
    rough: [disc(62, 430, 16), disc(60, 396, 14)],
  },
];

// --- The Gauntlet — rails, bumpers and bank shots; the technical course ------
const GAUNTLET: Hole[] = [
  // 1 — warm-up: one bumper dead on the line; pick a side.
  {
    par: 2,
    tee: { x: 180, y: 470 },
    cup: { x: 180, y: 138 },
    fairway: [cap(180, 486, 180, 176, 44)],
    green: [disc(180, 138, 56)],
    walls: [disc(180, 300, 13)],
  },
  // 2 — the chicane: two offset bars, thread left then right; rough punishes
  // bailing out wide on the first gate.
  {
    par: 3,
    tee: { x: 180, y: 448 },
    cup: { x: 180, y: 136 },
    fairway: [cap(180, 452, 180, 196, 78)],
    green: [disc(180, 136, 58)],
    walls: [cap(102, 368, 190, 352, 11), cap(170, 272, 258, 258, 11)],
    rough: [disc(250, 420, 20), disc(248, 390, 18)],
  },
  // 3 — the bank shot: a bar walls off the direct line; squeeze a flank gap or
  // bounce off the rail around it.
  {
    par: 3,
    tee: { x: 180, y: 472 },
    cup: { x: 180, y: 140 },
    fairway: [cap(180, 478, 180, 190, 58)],
    green: [disc(180, 140, 56)],
    walls: [cap(154, 300, 206, 300, 12)],
  },
  // 4 — pinball: a triangle of bumpers guards the approach.
  {
    par: 3,
    tee: { x: 180, y: 474 },
    cup: { x: 180, y: 138 },
    fairway: [cap(180, 484, 180, 196, 52)],
    green: [disc(180, 138, 58)],
    walls: [disc(180, 262, 12), disc(146, 318, 11), disc(214, 318, 11)],
  },
  // 5 — the funnel: converging rails squeeze everything through one slot, and a
  // bumper waits just behind it.
  {
    par: 4,
    tee: { x: 180, y: 462 },
    cup: { x: 180, y: 140 },
    fairway: [cap(180, 462, 180, 210, 74)],
    green: [disc(180, 140, 54)],
    walls: [cap(110, 352, 162, 306, 11), cap(250, 352, 202, 306, 11), disc(182, 240, 10)],
  },
  // 6 — the fortress: a horseshoe of bumpers rings the cup, door at the
  // bottom-right — curl in, or rattle around the walls.
  {
    par: 3,
    tee: { x: 180, y: 466 },
    cup: { x: 180, y: 150 },
    fairway: [cap(180, 480, 180, 232, 30)],
    green: [disc(180, 150, 66)],
    walls: [
      disc(146, 150, 9),
      disc(156, 126, 9),
      disc(180, 116, 9),
      disc(204, 126, 9),
      disc(214, 150, 9),
      disc(156, 174, 9),
      disc(180, 184, 9),
    ],
  },
  // 7 — the Z: two elbows with a bumper posted at each, so every leg needs shape.
  {
    par: 4,
    tee: { x: 84, y: 478 },
    cup: { x: 248, y: 142 },
    fairway: [cap(84, 496, 96, 340, 38), cap(96, 340, 264, 320, 38), cap(264, 320, 252, 170, 38)],
    green: [disc(248, 142, 54)],
    walls: [disc(160, 344, 11), disc(236, 250, 11)],
  },
  // 8 — plinko: three staggered rows of pegs down a wide field.
  {
    par: 3,
    tee: { x: 180, y: 456 },
    cup: { x: 180, y: 132 },
    fairway: [cap(180, 456, 180, 190, 80)],
    green: [disc(180, 132, 56)],
    walls: [
      disc(140, 380, 10),
      disc(220, 380, 10),
      disc(100, 310, 10),
      disc(180, 310, 10),
      disc(260, 310, 10),
      disc(140, 240, 10),
      disc(220, 240, 10),
    ],
  },
  // 9 — finale: the full gauntlet — a bar across the opening lane, sand at the
  // elbow, the classic bumper at the green's door.
  {
    par: 5,
    tee: { x: 92, y: 476 },
    cup: { x: 280, y: 172 },
    fairway: [cap(92, 500, 104, 360, 36), cap(104, 360, 250, 300, 36), cap(250, 300, 278, 226, 36)],
    green: [disc(280, 172, 68)],
    walls: [cap(66, 424, 96, 418, 10), disc(252, 236, 15)],
    pits: [disc(196, 330, 14)],
  },
];

export const COURSES: Course[] = [
  {
    // The original hand-authored nine (world.ts) — keeps its historical wire
    // key so scores and challenges recorded before there were other courses
    // stay on the right board.
    key: 'course',
    label: 'The Classic',
    blurb: 'The original nine — a bit of everything.',
    holes: HOLES,
  },
  {
    key: 'creekside',
    label: 'Creekside',
    blurb: 'Water on every hole. Stay dry.',
    holes: CREEKSIDE,
  },
  {
    key: 'dunes',
    label: 'The Dunes',
    blurb: 'Sand country — bunkers bog you down.',
    holes: DUNES,
  },
  {
    key: 'gauntlet',
    label: 'The Gauntlet',
    blurb: 'Rails, bumpers and bank shots.',
    holes: GAUNTLET,
  },
];

export function courseByKey(key: string | null | undefined): Course | null {
  if (!key) return null;
  return COURSES.find((c) => c.key === key) ?? null;
}
