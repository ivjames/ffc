import { describe, it, expect } from 'vitest';
import {
  W,
  H,
  FENCE,
  PEN_Y,
  GATE_X0,
  GATE_X1,
  FLOCK,
  SHEEP_R,
  ROUND_MS,
  DOG_R,
  clamp,
  freshSim,
  stepDog,
  stepSheep,
  type Sim,
} from './sheepSim';

// Headless rounds of the Sheep Drive sim. Two properties matter enough to pin:
//
//   1. The round is WINNABLE — a scripted drover using the intended technique
//      (get behind a sheep relative to the gate, push, repeat) pens the flock
//      well inside the clock. If a tuning change breaks this, the game ships
//      unbeatable and no unit on flocking.ts would notice.
//   2. A calm herd HOLDS ITS SPREAD — no slow-motion collapse toward the
//      center of mass while nothing is driving it. flocking.test.ts pins the
//      per-force contract; this is the same promise at full-sim scale, where
//      wander, damping and walls could reintroduce the creep.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GATE = { x: (GATE_X0 + GATE_X1) / 2, y: PEN_Y };
const DT = 1000 / 60;

/** One drover step, playing the way the hint text tells a person to: pick the
 *  sheep nearest the gate, and stand behind its whole local group (relative to
 *  the gate) so the flee response pushes the group toward the opening. */
function droverTarget(sim: Sim): { x: number; y: number } {
  const flock = sim.sheep.filter((s) => !s.penned);
  let focus = flock[0];
  let best = Infinity;
  for (const s of flock) {
    const d = Math.hypot(s.x - GATE.x, s.y - GATE.y);
    if (d < best) {
      best = d;
      focus = s;
    }
  }
  const group = flock.filter((s) => Math.hypot(s.x - focus.x, s.y - focus.y) < 70);
  const cx = group.reduce((a, s) => a + s.x, 0) / group.length;
  const cy = group.reduce((a, s) => a + s.y, 0) / group.length;
  const dx = cx - GATE.x;
  const dy = cy - GATE.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  // Stand a fixed pressure distance behind the group's REARMOST sheep along
  // the drive axis — lateral spread must not push the dog out of flee range.
  let rear = 0;
  for (const s of group) rear = Math.max(rear, (s.x - cx) * ux + (s.y - cy) * uy);
  const back = rear + 42;
  return {
    x: clamp(cx + ux * back, FENCE + DOG_R, W - FENCE - DOG_R),
    y: clamp(cy + uy * back, PEN_Y + DOG_R, H - FENCE - DOG_R),
  };
}

function assertInBounds(sim: Sim) {
  for (const s of sim.sheep) {
    expect(s.x).toBeGreaterThanOrEqual(FENCE);
    expect(s.x).toBeLessThanOrEqual(W - FENCE);
    expect(s.y).toBeGreaterThanOrEqual(FENCE);
    expect(s.y).toBeLessThanOrEqual(H - FENCE);
    // Nobody teleports through the pen rail: above the fence line means the
    // sim flagged the crossing as a penning.
    if (s.y < PEN_Y - SHEEP_R) expect(s.penned).toBe(true);
  }
}

describe('sheep drive round', () => {
  it('a scripted drover pens the whole flock inside the clock', () => {
    const sim = freshSim(mulberry32(7));
    let elapsed = 0;
    while (elapsed < ROUND_MS && sim.penned < FLOCK) {
      const t = droverTarget(sim);
      sim.dog.tx = t.x;
      sim.dog.ty = t.y;
      stepDog(sim, DT);
      stepSheep(sim, DT);
      elapsed += DT;
    }
    assertInBounds(sim);
    expect(sim.penned).toBe(FLOCK);
    // "Winnable" means winnable by a person, not only frame-perfect play —
    // demand real slack against the 60s clock.
    expect(elapsed).toBeLessThan(ROUND_MS * 0.75);
  });

  it('holds across seeds — no lucky-spawn dependence', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = freshSim(mulberry32(seed));
      let elapsed = 0;
      while (elapsed < ROUND_MS && sim.penned < FLOCK) {
        const t = droverTarget(sim);
        sim.dog.tx = t.x;
        sim.dog.ty = t.y;
        stepDog(sim, DT);
        stepSheep(sim, DT);
        elapsed += DT;
      }
      expect(sim.penned, `seed ${seed}`).toBeGreaterThanOrEqual(FLOCK - 1);
    }
  });

  it('an undisturbed herd keeps its spread — no creep toward the center of mass', () => {
    const sim = freshSim(mulberry32(11));
    // Park the dog in the far corner, out of every sheep's flee radius.
    sim.dog.x = sim.dog.tx = FENCE + DOG_R;
    sim.dog.y = sim.dog.ty = H - FENCE - DOG_R;

    const spread = () => {
      const flock = sim.sheep;
      const cx = flock.reduce((a, s) => a + s.x, 0) / flock.length;
      const cy = flock.reduce((a, s) => a + s.y, 0) / flock.length;
      return flock.reduce((a, s) => a + Math.hypot(s.x - cx, s.y - cy), 0) / flock.length;
    };
    const nearestMean = () => {
      let sum = 0;
      for (const s of sim.sheep) {
        let best = Infinity;
        for (const o of sim.sheep) {
          if (o === s) continue;
          best = Math.min(best, Math.hypot(s.x - o.x, s.y - o.y));
        }
        sum += best;
      }
      return sum / sim.sheep.length;
    };

    const spread0 = spread();
    for (let t = 0; t < 20_000; t += DT) stepSheep(sim, DT);

    // The old bug read exactly like this number falling: every sheep easing
    // toward the middle until the herd was a knot. Grazing wander may reshape
    // the herd, but its mean radius must not contract.
    expect(spread()).toBeGreaterThan(spread0 * 0.75);
    // And nobody ends up glued to a neighbor.
    expect(nearestMean()).toBeGreaterThan(SHEEP_R * 2);
    assertInBounds(sim);
  });
});
