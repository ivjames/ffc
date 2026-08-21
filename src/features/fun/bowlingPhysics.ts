// §12 Bowling — the physics. Split from Bowling.tsx so the headless balance
// harness (scripts/bowling-sim.ts, `npm run bowling:sim`) runs exactly the sim
// the game ships: the component only adds rendering, sound and scoring on top.
//
// The world is 2.5D. The sim keeps the top-down plane the game always had —
// x across the lane, y down it (toward the bowler) — and adds what a plane
// can't say: the ball carries revs that skid on the oil and hook on the dry
// backend, and every pin is a rigid body that leans, wobbles, topples, goes
// airborne off a hard hit, and bounces off the kickback panels flanking the
// deck. All units are logical (the canvas scales to fit); velocities are per
// fixed 120Hz substep.

// —— Lane geometry ————————————————————————————————————————————————————————————
export const W = 340;
export const H = 560;
export const LANE_L = 40;
export const LANE_R = W - 40;
export const BALL_R = 12;
export const PIN_R = 9;
export const HEAD_Y = 150; // head pin (nearest the bowler)
export const PIN_GAP_X = 22;
export const PIN_GAP_Y = 24;
export const START = { x: W / 2, y: H - 40 };
export const GUTTER_OUT = 10; // outer cap rail of each gutter channel (sim x, mirrored)
export const FIXED = 1000 / 120;

// —— Ball: skid → hook → roll —————————————————————————————————————————————————
// A dressed lane is oiled from the foul line most of the way down, then dry.
// On the oil the ball skids: it barely slows and its revs hardly bite. Past
// OIL_END it grips — friction climbs and the side revs turn into lateral push,
// which is why a real hook breaks late instead of curving evenly. Spin is
// consumed as it converts (rev loss), so the break flattens out rather than
// spiraling.
export const OIL_END = 265; // sim y where the pattern ends; smaller y = dry backend
const OIL_FRICTION = 0.998;
const DRY_FRICTION = 0.9905;
const OIL_GRIP = 0.1; // fraction of full hook available on the oil
const HOOK_ACCEL = 0.14; // lateral accel per step at full grip and full spin
const SPIN_DECAY_OIL = 0.9995;
const SPIN_DECAY_DRY = 0.9955;

export const MIN_V = 4;
export const MAX_V = 9;
export const MAX_DRAG = 260;
const REST = 0.5; // ball↔pin / pin↔pin restitution
const BALL_M = 6;
const PIN_M = 1;
export const REST_SPEED = 0.5; // below this a body is parked so micro-jitter can't stall settle
const BUMPER_REST = 0.95; // bumper bounce keeps nearly all lateral speed — bank shots are the point

// —— Pins: lean, topple, fly ——————————————————————————————————————————————————
// Each pin's lean is a 2D vector (lx, ly) in sim space whose magnitude is the
// lean angle in radians, with a matching angular velocity (lvx, lvy). Under
// TIP the base holds: a spring rights the pin (that's the wobble), damping
// settles it, and a fast slide drags the base out from under it. Past TIP the
// center of gravity is over the edge and gravity takes it the rest of the way
// to FLAT, where it counts as down.
export const TIP = 0.16; // balance point, rad — a real pin tips past ~9°
export const FLAT = 1.1; // fully fallen (render maps this to flat on the boards)
const SPRING = 0.01; // righting torque per rad of lean
const LEAN_DAMP = 0.045; // wobble decay
const TOPPLE_G = 0.002; // gravity torque once past TIP
const HIT_TOPPLE = 0.02; // lean kick per unit of ball impact speed
const PIN_TOPPLE = 0.016; // lean kick per unit of pin↔pin impact speed
const SLIDE_TRIP = 0.0011; // base-drag torque per unit of slide speed
const SLIDE_TRIP_MIN = 0.8; // slides slower than this don't trip the pin

// Flight: a hard enough hit lofts the pin. z is height above the boards.
const FLY_SPEED = 5; // impact speed where pins start leaving the deck
const FLY_K = 0.22; // vertical speed per unit of impact beyond that
const GRAV_Z = 0.02;
const LAND_REST = 0.35;

// The deck's walls. Kickback panels flank the pin deck — a pin (or a flown
// "messenger") bounces off them back across the lane, which is where real
// wall-shot strikes come from. Behind the deck the pit swallows whatever
// reaches it. Below the kickbacks the open gutter just collects a slid pin.
const KICK_Y = HEAD_Y + 34; // kickbacks run from the pit down to here
const KICK_REST = 0.55;
export const PIT_Y = 56; // behind this the boards end
const PIN_FRICTION = 0.91; // standing pin sliding on the boards
const DOWNED_FRICTION = 0.9; // a fallen pin scrubs more

// A pin that commits to falling sweeps its head through the neighbors' space —
// that secondhand knock is most of real pin action. One impulse per fall, to
// pins within head reach and roughly in the topple direction.
const HEAD_REACH = PIN_R * 2.9;
const HEAD_HIT = 0.85;
const HEAD_ALIGN = 0.45; // min dot(direction to neighbor, topple direction)

export type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number; // side revs, -1..1; positive hooks toward +x
  gutter: boolean;
  rolling: boolean;
};

export type Pin = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number; // height above the boards
  vz: number;
  lx: number; // lean vector (rad) — direction it's leaning, magnitude how far
  ly: number;
  lvx: number; // lean velocity (rad/step)
  lvy: number;
  ox: number; // spotted position
  oy: number;
  down: boolean;
  pit: boolean; // swallowed by the pit / gutter — out of the sim
  swept: boolean; // head-strike impulse already delivered
};

/** Loudest impacts of a substep plus any bumper bounce — the component turns
 *  these into clacks and sparks; the headless sim ignores them. */
export type StepEvents = { ballHit: number; pinHit: number; bump: { x: number; y: number } | null };

export type Vel = { vx0: number; vy0: number; spin: number };

/** The 10-pin rack: 4 rows receding from the head pin. */
export function makePins(): Pin[] {
  const pins: Pin[] = [];
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i <= r; i++) {
      const x = W / 2 + (i - r / 2) * PIN_GAP_X;
      const y = HEAD_Y - r * PIN_GAP_Y;
      pins.push({ x, y, vx: 0, vy: 0, z: 0, vz: 0, lx: 0, ly: 0, lvx: 0, lvy: 0, ox: x, oy: y, down: false, pit: false, swept: false });
    }
  }
  return pins;
}

export function freshBall(): Ball {
  return { x: START.x, y: START.y, vx: 0, vy: 0, spin: 0, gutter: false, rolling: false };
}

/** Turn a swipe into a launch. The drag's angle both aims the shot and loads
 *  the revs — against the angle, so an angled ball breaks back toward center
 *  the way a real hook does. A straight-up swipe is a straight ball. */
export function launch(dx: number, dy: number): Vel | null {
  const len = Math.hypot(dx, dy);
  if (len < 10) return null;
  if (dy / len > -0.3) return null; // must be aimed up the lane
  const power = Math.min(len / MAX_DRAG, 1);
  const speed = MIN_V + power * (MAX_V - MIN_V);
  const spin = -Math.max(-1, Math.min(1, dx / (MAX_DRAG * 0.6)));
  return { vx0: (dx / len) * speed, vy0: (dy / len) * speed, spin };
}

const hyp = Math.hypot;

/** Resolve a circle↔circle collision with mass + restitution. Returns the
 *  closing speed and contact normal when a bounce was applied (null otherwise)
 *  so the caller can topple pins and voice the impact. */
export function collide(
  a: { x: number; y: number; vx: number; vy: number },
  b: { x: number; y: number; vx: number; vy: number },
  ma: number,
  mb: number,
  min: number,
): { rel: number; nx: number; ny: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = hyp(dx, dy) || 0.0001;
  if (dist >= min) return null;
  const nx = dx / dist;
  const ny = dy / dist;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  // Separate proportionally to inverse mass.
  const overlap = min - dist;
  const invA = 1 / ma;
  const invB = 1 / mb;
  const push = overlap / (invA + invB);
  a.x -= nx * push * invA;
  a.y -= ny * push * invA;
  b.x += nx * push * invB;
  b.y += ny * push * invB;
  if (rel < 0) {
    const j = (-(1 + REST) * rel) / (invA + invB);
    a.vx -= j * invA * nx;
    a.vy -= j * invA * ny;
    b.vx += j * invB * nx;
    b.vy += j * invB * ny;
    return { rel: -rel, nx, ny };
  }
  return null;
}

/** A pin just committed to falling: its head sweeps through neighboring pins'
 *  space. Push the ones in the way, once. */
function headStrike(faller: Pin, pins: Pin[]) {
  if (faller.swept) return;
  faller.swept = true;
  const L = hyp(faller.lx, faller.ly) || 1;
  const tx = faller.lx / L; // topple direction
  const ty = faller.ly / L;
  for (const p of pins) {
    if (p === faller || p.pit) continue;
    const dx = p.x - faller.x;
    const dy = p.y - faller.y;
    const d = hyp(dx, dy);
    if (d < 0.001 || d > HEAD_REACH) continue;
    const ux = dx / d;
    const uy = dy / d;
    const align = ux * tx + uy * ty;
    if (align < HEAD_ALIGN) continue;
    const k = HEAD_HIT * align * (1.3 - d / HEAD_REACH);
    p.vx += ux * k;
    p.vy += uy * k;
    p.lvx += ux * PIN_TOPPLE * k * 2;
    p.lvy += uy * PIN_TOPPLE * k * 2;
  }
}

/** Apply an impact's side effects to a pin: a topple kick along the contact
 *  normal, and — past FLY_SPEED — loft off the deck. */
function batter(p: Pin, rel: number, nx: number, ny: number, toppleK: number) {
  p.lvx += nx * toppleK * rel;
  p.lvy += ny * toppleK * rel;
  if (rel > FLY_SPEED) p.vz += (rel - FLY_SPEED) * FLY_K;
}

/** One 120Hz substep of a live roll. Pure sim — no sound, no fx, no DOM. */
export function stepRoll(ball: Ball, pins: Pin[], bumpers: boolean): StepEvents {
  const ev: StepEvents = { ballHit: 0, pinHit: 0, bump: null };

  // —— Ball: skid on the oil, grip and hook on the dry backend ————————————————
  if (ball.rolling && !ball.gutter) {
    const dry = ball.y < OIL_END;
    const speed = hyp(ball.vx, ball.vy);
    if (speed > 0.5) {
      const grip = dry ? 1 : OIL_GRIP;
      ball.vx += ball.spin * HOOK_ACCEL * grip * Math.min(speed / 6, 1);
      ball.spin *= dry ? SPIN_DECAY_DRY : SPIN_DECAY_OIL;
    }
    const f = dry ? DRY_FRICTION : OIL_FRICTION;
    ball.vx *= f;
    ball.vy *= f;
  }
  ball.x += ball.vx;
  ball.y += ball.vy;
  // Once the ball has almost stopped (e.g. nestled among the pins) park it, so
  // it doesn't keep nudging the pins and stall the settle check.
  if (hyp(ball.vx, ball.vy) < REST_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
  }

  // Gutters: once past the lane edge the ball drops in and can't hit pins.
  // With bumpers up the edge bounces instead — clamp back onto the lane and
  // reflect (only an outward vx, so a ball already hooking back in isn't
  // re-kicked), never capturing, so a bumper game can't gutter.
  if (!ball.gutter) {
    const overL = ball.x < LANE_L + BALL_R;
    const overR = ball.x > LANE_R - BALL_R;
    if (bumpers) {
      if (overL || overR) {
        ball.x = overL ? LANE_L + BALL_R : LANE_R - BALL_R;
        if (overL ? ball.vx < 0 : ball.vx > 0) {
          ball.vx = -ball.vx * BUMPER_REST;
          ev.bump = { x: overL ? LANE_L : LANE_R, y: ball.y };
        }
      }
    } else if (overL || overR) {
      // Drop into the channel's center, not the lane edge — a gutter ball has
      // to be seen riding the gutter the rest of the way down.
      ball.x = overL ? (GUTTER_OUT + LANE_L) / 2 : (W - GUTTER_OUT + LANE_R) / 2;
      ball.vx = 0;
      ball.spin = 0;
      ball.gutter = true;
    }
  }

  // —— Pins: lean/topple, flight, slide, walls ————————————————————————————————
  for (const p of pins) {
    if (p.pit) continue;

    // Lean dynamics.
    if (!p.down) {
      const L = hyp(p.lx, p.ly);
      if (L < TIP) {
        // Base holds: spring upright, damp the wobble; a fast slide drags the
        // base out from under it.
        const slide = hyp(p.vx, p.vy);
        const trip = slide > SLIDE_TRIP_MIN ? SLIDE_TRIP : 0;
        p.lvx += -SPRING * p.lx - LEAN_DAMP * p.lvx + trip * p.vx;
        p.lvy += -SPRING * p.ly - LEAN_DAMP * p.lvy + trip * p.vy;
      } else {
        // Past the balance point: gravity takes it the rest of the way.
        p.lvx += ((TOPPLE_G * p.lx) / L) * (1 + L);
        p.lvy += ((TOPPLE_G * p.ly) / L) * (1 + L);
      }
      p.lx += p.lvx;
      p.ly += p.lvy;
      if (hyp(p.lx, p.ly) >= FLAT) {
        p.down = true;
        headStrike(p, pins);
      }
    } else {
      // Fallen: hold the angle it landed at, bleed off residual lean speed.
      p.lvx *= 0.8;
      p.lvy *= 0.8;
    }

    // Flight.
    if (p.z > 0 || p.vz !== 0) {
      p.vz -= GRAV_Z;
      p.z += p.vz;
      if (p.z <= 0) {
        p.z = 0;
        p.vz = p.vz < -0.08 ? -p.vz * LAND_REST : 0;
      }
    }

    // Slide. Airborne pins keep their speed; fallen ones scrub hardest.
    const fr = p.z > 0 ? 0.999 : p.down ? DOWNED_FRICTION : PIN_FRICTION;
    p.vx *= fr;
    p.vy *= fr;
    p.x += p.vx;
    p.y += p.vy;

    // The pit swallows anything that crosses the back of the deck.
    if (p.y < PIT_Y) {
      p.pit = true;
      p.down = true;
      continue;
    }

    // Side walls: kickbacks flank the deck (bumpers cover the whole lane);
    // below them a pin that crosses the edge is in the open gutter and gone.
    const overL = p.x < LANE_L + PIN_R;
    const overR = p.x > LANE_R - PIN_R;
    if (overL || overR) {
      if (bumpers || p.y < KICK_Y) {
        p.x = overL ? LANE_L + PIN_R : LANE_R - PIN_R;
        if (overL ? p.vx < 0 : p.vx > 0) p.vx = -p.vx * KICK_REST;
      } else {
        p.pit = true;
        p.down = true;
        continue;
      }
    }

    // Park a nearly-stopped grounded pin so micro-jitter can't stall settle.
    if (p.z === 0 && hyp(p.vx, p.vy) < REST_SPEED * 0.4) {
      p.vx = 0;
      p.vy = 0;
    }
  }

  // Ball ↔ pin collisions.
  if (!ball.gutter) {
    for (const p of pins) {
      if (p.pit) continue;
      const c = collide(ball, p, BALL_M, PIN_M, BALL_R + PIN_R);
      if (c) {
        batter(p, c.rel, c.nx, c.ny, HIT_TOPPLE);
        ev.ballHit = Math.max(ev.ballHit, c.rel);
      }
    }
  }
  // Pin ↔ pin collisions.
  for (let a = 0; a < pins.length; a++) {
    if (pins[a].pit) continue;
    for (let b = a + 1; b < pins.length; b++) {
      if (pins[b].pit) continue;
      const c = collide(pins[a], pins[b], PIN_M, PIN_M, PIN_R * 2);
      if (c) {
        batter(pins[b], c.rel, c.nx, c.ny, PIN_TOPPLE);
        batter(pins[a], c.rel, -c.nx, -c.ny, PIN_TOPPLE);
        ev.pinHit = Math.max(ev.pinHit, c.rel);
      }
    }
  }
  return ev;
}

/** True once every pin has stopped sliding, flying, wobbling and toppling —
 *  the roll can be scored. */
export function pinsSettled(pins: Pin[]): boolean {
  for (const p of pins) {
    if (p.pit) continue;
    if (Math.abs(p.vx) + Math.abs(p.vy) > 0.05) return false;
    if (p.z > 0 || p.vz !== 0) return false;
    if (!p.down) {
      const L = hyp(p.lx, p.ly);
      if (L >= TIP) return false; // mid-topple
      if (L > 0.01 && hyp(p.lvx, p.lvy) > 0.004) return false; // still wobbling
    }
  }
  return true;
}

/** Stand the survivors of a 'clear' sweep fully upright again (a real pinsetter
 *  re-spots them level): any sub-TIP lean or drift left over is zeroed. */
export function steadyPins(pins: Pin[]) {
  for (const p of pins) {
    p.vx = p.vy = p.vz = 0;
    p.z = 0;
    p.lx = p.ly = p.lvx = p.lvy = 0;
  }
}

/** The aim guide's ghost roll: the ball physics with no pins, sampled every few
 *  steps. Stops at the guide's reach — beyond it the break is yours to read. */
export function ghostPath(v: Vel, bumpers: boolean, reach = 215): { x: number; y: number }[] {
  const b: Ball = { x: START.x, y: START.y, vx: v.vx0, vy: v.vy0, spin: v.spin, gutter: false, rolling: true };
  const pts: { x: number; y: number }[] = [{ x: b.x, y: b.y }];
  let traveled = 0;
  for (let i = 0; i < 200 && traveled < reach; i++) {
    stepRoll(b, [], bumpers);
    traveled += hyp(b.vx, b.vy);
    if (b.gutter || b.y < HEAD_Y + 40) {
      pts.push({ x: b.x, y: b.y });
      break;
    }
    if (i % 4 === 3) pts.push({ x: b.x, y: b.y });
  }
  return pts;
}
