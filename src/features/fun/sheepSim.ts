// The Sheep Drive field sim — everything about the round that isn't pixels:
// the paddock geometry, the flock, the dog, panic, walls, and the pen gate.
// Split out of SheepDrive.tsx (the pinballTable.ts pattern) so sheepSim.test.ts
// can run whole rounds headless — including a scripted drover that proves the
// round is actually winnable, and a herd that provably does NOT collapse
// toward its center of mass (the flocking regression this game exists to
// avoid; the per-force contract lives in flocking.ts).
//
// All randomness flows through the sim's own `rand` so a test can seed it;
// the game passes Math.random. No canvas, no sound — the screen listens for
// the sheep this returns as newly penned and plays the juice itself.

import { flockSteer, limitSpeed, SHEEP_PARAMS, type Boid } from './flocking';

const TWO_PI = Math.PI * 2;

// —— Geometry (logical units; the canvas scales to fit) ———————————————————————
export const W = 340;
export const H = 560;

export const FENCE = 10; // outer fence inset from every edge
export const PEN_Y = 118; // the pen's bottom fence line; the pen is everything above
export const GATE_X0 = 136;
export const GATE_X1 = 204; // 68px gap — comfortably three sheep abreast

export const FLOCK = 12;
export const SHEEP_R = 6.5;
export const ROUND_MS = 60_000;

// The dog answers the pointer at a run; sheep outsprint it only briefly.
export const DOG_SPEED = 165; // px/s
export const DOG_R = 8;

// Sheep speed scales with panic: grazing drift up to a flat-out bolt.
export const GRAZE_SPEED = 14;
export const BOLT_SPEED = 100;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export type Sheep = Boid & {
  panic: number; // 0 calm … 1 bolting; drives speed cap and alignment gain
  heading: number; // last drawn facing, kept while standing still
  wander: number; // current grazing-drift direction
  wanderIn: number; // ms until the next wander re-roll
  penned: boolean;
  dark: boolean; // the one black sheep — purely visual
};

export type Dog = { x: number; y: number; tx: number; ty: number; heading: number };

export type Sim = {
  sheep: Sheep[];
  dog: Dog;
  penned: number;
  rand: () => number;
};

function freshSheep(i: number, rand: () => number): Sheep {
  // Loose cluster in the lower third — scattered enough to graze, close
  // enough that the first dog approach moves them as one herd.
  const a = (i / FLOCK) * TWO_PI;
  const r = 30 + rand() * 55;
  return {
    x: clamp(W / 2 + Math.cos(a) * r + (rand() - 0.5) * 24, FENCE + 14, W - FENCE - 14),
    y: clamp(400 + Math.sin(a) * r * 0.7 + (rand() - 0.5) * 24, PEN_Y + 60, H - FENCE - 20),
    vx: 0,
    vy: 0,
    panic: 0,
    heading: rand() * TWO_PI,
    wander: rand() * TWO_PI,
    wanderIn: rand() * 1500,
    penned: false,
    dark: i === 0,
  };
}

export function freshSim(rand: () => number = Math.random): Sim {
  return {
    sheep: Array.from({ length: FLOCK }, (_, i) => freshSheep(i, rand)),
    dog: { x: W / 2, y: H - 44, tx: W / 2, ty: H - 44, heading: -Math.PI / 2 },
    penned: 0,
    rand,
  };
}

export function inGate(x: number): boolean {
  return x > GATE_X0 + SHEEP_R && x < GATE_X1 - SHEEP_R;
}

export function stepDog(sim: Sim, dt: number): void {
  const d = sim.dog;
  const dx = d.tx - d.x;
  const dy = d.ty - d.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return;
  // Arrive: full tilt until close, then ease in so the dog plants, not orbits.
  const speed = Math.min(DOG_SPEED, dist * 6);
  const step = Math.min(dist, (speed * dt) / 1000);
  d.x += (dx / dist) * step;
  d.y += (dy / dist) * step;
  d.heading = Math.atan2(dy, dx);
}

/** Advance every sheep by `dt` ms. Returns the sheep penned THIS step, in the
 *  order they crossed, so the screen can celebrate each one. */
export function stepSheep(sim: Sim, dt: number): Sheep[] {
  const dts = dt / 1000;
  const rand = sim.rand;
  const active = sim.sheep.filter((s) => !s.penned);
  const inPen = sim.sheep.filter((s) => s.penned);
  const justPenned: Sheep[] = [];

  for (const s of sim.sheep) {
    if (s.penned) {
      // Milling in the pen: personal space plus a gentle amble, fenced in.
      const { ax, ay } = flockSteer(s, inPen, null, SHEEP_PARAMS);
      s.wanderIn -= dt;
      if (s.wanderIn <= 0) {
        s.wander = rand() * TWO_PI;
        s.wanderIn = 900 + rand() * 2200;
      }
      s.vx += (ax + Math.cos(s.wander) * 6) * dts;
      s.vy += (ay + Math.sin(s.wander) * 6) * dts;
      ({ vx: s.vx, vy: s.vy } = limitSpeed(s.vx, s.vy, GRAZE_SPEED));
      const k = Math.pow(0.2, dts);
      s.vx *= k;
      s.vy *= k;
      s.x = clamp(s.x + s.vx * dts, FENCE + SHEEP_R + 2, W - FENCE - SHEEP_R - 2);
      s.y = clamp(s.y + s.vy * dts, FENCE + SHEEP_R + 6, PEN_Y - SHEEP_R - 2);
      if (Math.hypot(s.vx, s.vy) > 3) s.heading = Math.atan2(s.vy, s.vx);
      continue;
    }

    // Panic: fast attack near the dog, slow release once it backs off. The
    // release is what lets a driven herd settle into a walk instead of
    // ricocheting — and panic is also the knob that turns alignment up, so a
    // spooked sheep joins the stream its neighbors are already running in.
    const dDog = Math.hypot(s.x - sim.dog.x, s.y - sim.dog.y);
    const target = clamp(1.25 - dDog / SHEEP_PARAMS.fleeRadius, 0, 1);
    if (target > s.panic) s.panic = Math.min(target, s.panic + dt * 0.006);
    else s.panic = Math.max(target, s.panic - dt * 0.0008);

    const params = {
      ...SHEEP_PARAMS,
      alignWeight: SHEEP_PARAMS.alignWeight * (1 + 2 * s.panic),
    };
    let { ax, ay } = flockSteer(s, active, sim.dog, params);

    // Grazing drift while calm — re-rolled occasionally, faded out by panic.
    s.wanderIn -= dt;
    if (s.wanderIn <= 0) {
      s.wander += (rand() - 0.5) * 2.4;
      s.wanderIn = 700 + rand() * 2000;
    }
    const calm = 1 - s.panic;
    ax += Math.cos(s.wander) * 8 * calm;
    ay += Math.sin(s.wander) * 8 * calm;

    // Soft walls: the outer fence, and the pen fence for anyone not lined up
    // with the gate. Pushes grow linearly inside the margin, so sheep bank
    // along a fence instead of pinballing off it.
    const M = 26;
    if (s.x < FENCE + M) ax += ((FENCE + M - s.x) / M) * 120;
    if (s.x > W - FENCE - M) ax -= ((s.x - (W - FENCE - M)) / M) * 120;
    if (s.y > H - FENCE - M) ay -= ((s.y - (H - FENCE - M)) / M) * 120;
    const overFence = s.y < PEN_Y + M && !inGate(s.x);
    if (overFence) ay += ((PEN_Y + M - s.y) / M) * 120;

    // A pressed sheep breaks for the one opening it can see. Without this the
    // endgame is a stalemate: a sheep pinned level with the gate feels only
    // the dog's radial push (all sideways) against the fence's push-back, and
    // rattles along the rail forever. Near the gate mouth, panic converts
    // into a run through it — which is also what a cornered animal does.
    if (s.panic > 0.35 && s.x > GATE_X0 - 16 && s.x < GATE_X1 + 16 && s.y < PEN_Y + 70) {
      const gx = (GATE_X0 + GATE_X1) / 2 - s.x;
      const gy = PEN_Y - 12 - s.y;
      const gd = Math.hypot(gx, gy) || 1;
      const w = 140 * s.panic;
      ax += (gx / gd) * w;
      ay += (gy / gd) * w;
    }

    s.vx += ax * dts;
    s.vy += ay * dts;
    const maxSpeed = GRAZE_SPEED + (BOLT_SPEED - GRAZE_SPEED) * s.panic;
    ({ vx: s.vx, vy: s.vy } = limitSpeed(s.vx, s.vy, maxSpeed));
    // Calm sheep coast to a stop; bolting ones keep their momentum.
    const damp = Math.pow(0.05 + 0.9 * s.panic, dts);
    s.vx *= damp;
    s.vy *= damp;

    const prevY = s.y;
    s.x = clamp(s.x + s.vx * dts, FENCE + SHEEP_R + 2, W - FENCE - SHEEP_R - 2);
    s.y = clamp(s.y + s.vy * dts, FENCE + SHEEP_R + 6, H - FENCE - SHEEP_R - 2);

    // The pen fence is solid except at the gate. Contact SLIDES rather than
    // bounces — a blocked sheep keeps its lateral speed and works along the
    // rail, which is how it finds the gate.
    if (s.y < PEN_Y && !inGate(s.x)) {
      s.y = Math.max(s.y, PEN_Y + SHEEP_R * 0.5);
      if (prevY >= PEN_Y && s.vy < 0) s.vy = 0;
    }
    if (s.y < PEN_Y - SHEEP_R) {
      s.penned = true;
      s.panic = 0;
      sim.penned++;
      justPenned.push(s);
    }

    if (Math.hypot(s.vx, s.vy) > 3) s.heading = Math.atan2(s.vy, s.vx);
  }

  return justPenned;
}
