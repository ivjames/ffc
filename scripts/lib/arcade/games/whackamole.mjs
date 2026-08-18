// Whack-a-Mole policy — the REACTIVE class, and the first game here whose
// targets are live state rather than fixed geometry.
//
// The swipe and timing games can be solved ahead of time: the board never
// moves, so the bot computes a gesture and commits. Here there is nothing to
// solve — gophers appear in nine holes on their own schedule, and the only way
// to play is to keep looking and react. So the bot does exactly that, in a
// tight loop: sample all nine holes in one round trip, classify what is in
// them, tap the ones worth tapping, repeat.
//
// WHY THIS ONE IS TRACTABLE AND THE OTHER REACTIVE GAMES ARE HARDER
//   The holes are a fixed 3×3 grid (COLS_X × ROWS in WhackAMole.tsx), so
//   "where might a target be" is a known list of nine points. Nothing has to be
//   tracked frame to frame — each cycle is an independent read. Games with
//   genuinely moving entities (a puck, a duck on a rail, a pinball) need the
//   position itself recovered from pixels and then predicted forward, which is
//   a different and larger problem.
//
// WHERE TO LOOK
//   A gopher's head centre is at `hole.y + (10 - rise*RISE_H) * hole.s`, fully
//   up at rise=1. The head's own centre is covered by the cream muzzle, and the
//   eyes sit just above it, so the sample point is the FOREHEAD — up off the
//   muzzle and clear of the eyes — where the fur colour is unobstructed.
//
//   One tap point per hole is enough: HIT_R is generous (42) next to a rise of
//   ~58, so aiming at the fully-up head still lands on a half-risen one.
import { clamp } from '../skill.mjs';

const W = 340;
const H = 560;
const COLS_X = [64, 170, 276];
const ROWS = [
  { y: 190, s: 0.86 },
  { y: 320, s: 0.96 },
  { y: 452, s: 1.06 },
];
const HOLES = ROWS.flatMap((r) => COLS_X.map((x) => ({ x, y: r.y, s: r.s })));
const RISE_H = 58;
const GAME_MS = 30_000;

/** Head centre for a given rise (0 buried, 1 fully up). */
const headY = (hole, rise) => hole.y + (10 - rise * RISE_H) * hole.s;

/** Sample points per hole: forehead at a few rise heights, to catch mid-rise. */
function samplesFor(hole) {
  return [1, 0.72].map((rise) => ({ x: hole.x, y: headY(hole, rise) - 14 * hole.s }));
}

/**
 * Classify a forehead pixel.
 *
 * Fur palettes from drawGopher: an ordinary gopher is brown
 * (#c8a06a/#8b5e34), a gold one is cream-to-amber (#fef3c7/#f59e0b), and a bomb
 * is a desaturated blue-grey sphere (#64748b/#1f2937). So warmth (r−b)
 * separates gopher from bomb, and brightness separates gold from brown.
 */
function classify([r, g, b, a]) {
  if (a < 40) return null;
  const warmth = r - b;
  if (warmth < 45) return null; // grey/dark/green — bomb, hole, or backdrop
  if (r > 205 && g > 135) return 'gold';
  if (r > 95 && g > 60 && g < 190) return 'mole';
  return null;
}

export default {
  key: 'whackamole',
  route: '/arcade/mole',
  label: 'Whack-a-Mole',
  field: { W, H },
  ticketsFor: (score) => Math.min(100, Math.max(0, Math.round(score * 1.5))),
  estRoundMs: GAME_MS + 9000,
  needsStart: true,

  async play(d, { rng, skill }) {
    const points = HOLES.flatMap(samplesFor);
    // Reaction time: an expert taps almost the moment a head clears the hole, a
    // beginner dithers. Implemented as a per-cycle pause, so a weak player also
    // sees fewer gophers — which is how being slow actually costs you here.
    const reactMs = Math.round(120 - 95 * clamp(skill, 0, 1));
    // Even a good player misses some; skip a fraction of the ones we do see.
    const missRate = 0.32 * (1 - clamp(skill, 0, 1)) ** 1.5;

    const deadline = Date.now() + GAME_MS - 700;
    while (Date.now() < deadline) {
      const probe = await d.probePoints(points);
      // Collapse each hole's samples: gold outranks a plain gopher.
      const hits = [];
      for (let i = 0; i < HOLES.length; i++) {
        let kind = null;
        for (let j = 0; j < 2; j++) {
          const k = classify(probe.px[i * 2 + j]);
          if (k === 'gold') kind = 'gold';
          else if (k === 'mole' && kind !== 'gold') kind = 'mole';
        }
        if (kind) hits.push({ hole: HOLES[i], kind });
      }
      // Golds first — they are worth more and are rarer, so when two are up the
      // order genuinely matters.
      hits.sort((p, q) => (p.kind === 'gold' ? -1 : 0) - (q.kind === 'gold' ? -1 : 0));
      for (const hit of hits) {
        if (rng() < missRate) continue;
        await d.tap(hit.hole.x, headY(hit.hole, 1));
        if (Date.now() >= deadline) break;
      }
      await d.page.waitForTimeout(reactMs);
    }
  },
};
