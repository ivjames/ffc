// Flocking steering for the sheep in Sheep Drive — the classic three boid
// forces plus a predator-flee term, tuned so a herd STREAMS instead of
// clumping.
//
// The tuning here encodes one hard-won behavioral contract: sheep must go
// with the flow of their neighbors, never get reeled in toward the flock's
// center of mass. A naive boids cohesion term breaks that contract twice —
// it looks at every boid on the field (so two separate groups drag each other
// across the paddock toward their mutual centroid), and it scales with
// distance to the centroid (so the farther a sheep is from "the middle", the
// harder it gets yanked there, collapsing a moving line of sheep into a ball).
// Both failure modes read on screen as sheep ignoring the herd's direction of
// travel and beelining for its middle. The rules that prevent them:
//
//   · Cohesion sees only LOCAL neighbors (cohRadius). A sheep has no idea
//     where the flock-wide center of mass is, by construction.
//   · Cohesion is COMFORT-GATED: it engages only when a sheep's nearest
//     neighbor is beyond comfortDist — i.e. only when it is actually getting
//     separated. A sheep standing inside a spread-out, grazing herd feels no
//     inward pull at all, so a calm flock holds its shape instead of creeping
//     into a knot.
//   · Cohesion is CONSTANT-MAGNITUDE (a unit direction times cohWeight),
//     never proportional to centroid distance.
//   · Alignment is velocity MATCHING against local neighbors, and its gain
//     outweighs cohesion by an order of magnitude when the herd is moving —
//     a running neighbor recruits you into its heading, not its position.
//
// Pure functions over plain data, no canvas and no RNG, so the contract is
// unit-testable (flocking.test.ts pins each rule above). The game screen owns
// integration, walls, the pen, and panic (which it applies by scaling a copy
// of these params per sheep per frame).

export type Boid = { x: number; y: number; vx: number; vy: number };

export type Steer = { ax: number; ay: number };

export type FlockParams = {
  /** Personal space — inside this, neighbors push apart. */
  sepRadius: number;
  /** How far a sheep looks when matching its neighbors' velocity. */
  alignRadius: number;
  /** How far a sheep looks when deciding it has drifted off the group. */
  cohRadius: number;
  /** Cohesion engages only when the NEAREST neighbor is beyond this. */
  comfortDist: number;
  sepWeight: number; // px/s² at full overlap, fading linearly to 0 at sepRadius
  alignWeight: number; // 1/s gain on the velocity-matching error
  cohWeight: number; // px/s², constant magnitude toward the local group
  /** Threat (the dog) is felt inside this radius… */
  fleeRadius: number;
  /** …at up to this many px/s², fading linearly with distance. */
  fleeWeight: number;
};

/** Baseline sheep, in the game's logical px (sheep body is ~7px across). */
export const SHEEP_PARAMS: FlockParams = {
  sepRadius: 16,
  alignRadius: 48,
  cohRadius: 64,
  comfortDist: 34,
  sepWeight: 150,
  alignWeight: 2.4,
  cohWeight: 26,
  fleeRadius: 96,
  fleeWeight: 300,
};

/**
 * Steering acceleration for one sheep given the rest of the flock and an
 * optional threat position. Callers pass whatever subset of the flock should
 * be visible (the game excludes penned sheep, for instance) — `others` may
 * include `self`; it is skipped by identity.
 */
export function flockSteer(
  self: Boid,
  others: readonly Boid[],
  threat: { x: number; y: number } | null,
  p: FlockParams,
): Steer {
  let ax = 0;
  let ay = 0;

  let alignN = 0;
  let sumVx = 0;
  let sumVy = 0;

  let cohN = 0;
  let sumX = 0;
  let sumY = 0;
  let nearest = Infinity;

  for (const o of others) {
    if (o === self) continue;
    const dx = self.x - o.x;
    const dy = self.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d >= p.cohRadius) continue; // beyond every rule's reach
    if (d < nearest) nearest = d;

    if (d < p.sepRadius && d > 1e-6) {
      const push = (p.sepWeight * (1 - d / p.sepRadius)) / d;
      ax += dx * push;
      ay += dy * push;
    }
    if (d < p.alignRadius) {
      alignN++;
      sumVx += o.vx;
      sumVy += o.vy;
    }
    cohN++;
    sumX += o.x;
    sumY += o.y;
  }

  if (alignN > 0) {
    ax += (sumVx / alignN - self.vx) * p.alignWeight;
    ay += (sumVy / alignN - self.vy) * p.alignWeight;
  }

  // Local, gated, constant-magnitude cohesion — see the header for why each
  // of those three properties is load-bearing.
  if (cohN > 0 && nearest > p.comfortDist) {
    const cx = sumX / cohN - self.x;
    const cy = sumY / cohN - self.y;
    const d = Math.hypot(cx, cy);
    if (d > 1e-6) {
      ax += (cx / d) * p.cohWeight;
      ay += (cy / d) * p.cohWeight;
    }
  }

  if (threat) {
    const dx = self.x - threat.x;
    const dy = self.y - threat.y;
    const d = Math.hypot(dx, dy);
    if (d < p.fleeRadius && d > 1e-6) {
      const push = (p.fleeWeight * (1 - d / p.fleeRadius)) / d;
      ax += dx * push;
      ay += dy * push;
    }
  }

  return { ax, ay };
}

/** Clamp a velocity to `max` px/s (returns the same vector shape). */
export function limitSpeed(vx: number, vy: number, max: number): { vx: number; vy: number } {
  const s = Math.hypot(vx, vy);
  if (s <= max || s === 0) return { vx, vy };
  const k = max / s;
  return { vx: vx * k, vy: vy * k };
}
