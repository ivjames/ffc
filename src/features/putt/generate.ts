// Procedural hole generation (PROCEDURAL_HOLES.md §6). The strategy is
// rejection sampling: build a candidate from simple parts, then accept it only
// if it passes the shared authoring contract (validate.ts) — the exact same
// check the CLI runs on the authored course. Anything the sampler gets wrong is
// thrown away rather than repaired, which keeps the generator simple and its
// output provably playable.

import { H, BALL_R, cap, disc, type Hole, type Seg } from './world.ts';
import { validateHole } from './validate.ts';

// --- seeded RNG (mulberry32) so a seed reproduces a hole exactly ------------
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const rnd = (r: Rng, lo: number, hi: number) => lo + r() * (hi - lo);
const chance = (r: Rng, p: number) => r() < p;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Pt = { x: number; y: number };

// A safe, boring hole that is always valid — the fallback if sampling can't find
// something fancier in the attempt budget.
function simpleHole(): Hole {
  return {
    par: 2,
    tee: { x: 180, y: 470 },
    cup: { x: 180, y: 150 },
    fairway: [cap(180, 488, 180, 180, 32)],
    green: [disc(180, 150, 60)],
  };
}

// Build one candidate hole from the RNG. May or may not be valid — the caller
// validates and resamples.
function sample(r: Rng): Hole {
  const rf = rnd(r, 30, 52); // fairway half-width
  const rg = rnd(r, 50, 70); // green radius

  // Tee low, cup high, both kept well inside the field for the given radii.
  const tee: Pt = { x: rnd(r, 110, 250), y: rnd(r, 452, Math.min(486, H - 4 - rf)) };
  const cup: Pt = { x: rnd(r, 100, 260), y: rnd(r, 120, 195) };

  // A short runway behind the tee gives the ball room and keeps the tee safely
  // on the surface rather than teetering on the rounded cap.
  const runway: Pt = { x: tee.x, y: Math.min(tee.y + 18, H - 4 - rf) };

  // Spine: runway → (optional dogleg bend) → cup. Capsules between the points
  // make the fairway; ending at the cup guarantees it overlaps the green.
  const dogleg = chance(r, 0.5);
  const spine: Pt[] = [runway];
  if (dogleg) {
    const bendY = lerp(runway.y, cup.y, rnd(r, 0.4, 0.62));
    const side = chance(r, 0.5) ? 1 : -1;
    const bendX = Math.max(90, Math.min(270, (runway.x + cup.x) / 2 + side * rnd(r, 46, 92)));
    spine.push({ x: bendX, y: bendY });
  }
  spine.push(cup);

  const fairway: Seg[] = [];
  for (let i = 0; i < spine.length - 1; i++) {
    fairway.push(cap(spine[i].x, spine[i].y, spine[i + 1].x, spine[i + 1].y, rf));
  }
  const green: Seg[] = [disc(cup.x, cup.y, rg)];

  const hole: Hole = { par: 2, tee, cup, fairway, green };

  // A point partway up one fairway segment, and that segment's perpendicular —
  // used to hang hazards beside/on the lane.
  const seg = fairway[Math.min(fairway.length - 1, 0)];
  const a: Pt = { x: seg.ax, y: seg.ay };
  const b: Pt = { x: seg.bx, y: seg.by };
  const t = rnd(r, 0.38, 0.62);
  const mid: Pt = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const perp = { x: -dy / len, y: dx / len };

  // Optional sand bunker: a small cluster sitting on the lane (passable, so it
  // never blocks the route) — always fully inside, hence safe.
  if (chance(r, 0.5)) {
    const rb = rnd(r, 15, Math.min(24, rf - 7));
    if (rb > 12) {
      const pits: Seg[] = [];
      const n = 2 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * rb * 0.8;
        pits.push(disc(mid.x + (dx / len) * off, mid.y + (dy / len) * off, rb * rnd(r, 0.8, 1)));
      }
      hole.pits = pits;
    }
  }

  // Optional water: only on a wide lane, hugging one side so a clear gap for the
  // ball remains on the other (the validator confirms the path survives).
  if (rf >= 44 && chance(r, 0.35)) {
    const rw = rnd(r, 16, 22);
    const off = (rf - rw - 3) * (chance(r, 0.5) ? 1 : -1);
    hole.water = [
      disc(mid.x + perp.x * off, mid.y + perp.y * off, rw),
      disc(mid.x + perp.x * off + (dx / len) * rw, mid.y + perp.y * off + (dy / len) * rw, rw * 0.85),
    ];
  }

  // Optional bumper wall: a disc set into the lane to curl around, offset so a
  // ball-width channel stays open on the wide side.
  if (rf >= 40 && !hole.water && chance(r, 0.3)) {
    const rw = rnd(r, 14, 18);
    const maxOff = rf - rw - BALL_R - 3;
    if (maxOff > 8) {
      const off = rnd(r, 8, maxOff) * (chance(r, 0.5) ? 1 : -1);
      hole.walls = [disc(mid.x + perp.x * off, mid.y + perp.y * off, rw)];
    }
  }

  // Optional rough patch hugging one edge of the lane (passable, so it never
  // blocks the route). It rides the rail — spilling a touch past it — and the
  // renderer clips it to the surface, so it reads as a strip of rough down the
  // side. sdBlob fillets the discs into one patch.
  if (chance(r, 0.4)) {
    const rr = rnd(r, 14, 20);
    const side = chance(r, 0.5) ? 1 : -1;
    const off = (rf - rr * 0.4) * side;
    const rough: Seg[] = [];
    const m = 2 + Math.floor(r() * 2);
    for (let i = 0; i < m; i++) {
      const s = (i - (m - 1) / 2) * rr * 1.2;
      rough.push(disc(mid.x + perp.x * off + (dx / len) * s, mid.y + perp.y * off + (dy / len) * s, rr));
    }
    hole.rough = rough;
  }

  hole.par = derivePar(hole, spine);
  return hole;
}

// Par from the shape: longer routes, doglegs and water each cost a stroke.
function derivePar(h: Hole, spine: Pt[]): number {
  let len = 0;
  for (let i = 0; i < spine.length - 1; i++) {
    len += Math.hypot(spine[i + 1].x - spine[i].x, spine[i + 1].y - spine[i].y);
  }
  let par = 2;
  if (spine.length > 2) par += 1; // dogleg
  if (h.water) par += 1;
  if (len > 380) par += 1;
  return Math.max(2, Math.min(5, par));
}

/**
 * Generate a single valid hole for the given seed. Deterministic: the same seed
 * always yields the same hole. Falls back to a simple hole if the attempt
 * budget is exhausted (vanishingly rare).
 */
export function generateHole(seed: number, attempts = 150): Hole {
  const r = makeRng(seed);
  for (let i = 0; i < attempts; i++) {
    const h = sample(r);
    if (validateHole(h).ok) return h;
  }
  return simpleHole();
}

/**
 * A reproducible course of `count` holes from one base seed. Each hole uses a
 * derived seed so the set is stable and independently reproducible.
 */
export function generateCourse(seed: number, count: number): Hole[] {
  const holes: Hole[] = [];
  for (let i = 0; i < count; i++) holes.push(generateHole(seed + i * 0x9e3779b1));
  return holes;
}
