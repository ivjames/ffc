// §12 Pinball — the table itself: geometry, the physics engine, and the fixed
// 240 Hz step. Kept free of React and canvas so the same code that runs the
// game also runs headless in scripts/pinball-sim.ts, where drain rates and
// other balance numbers are measured. Rendering and input live in Pinball.tsx.
import type { Vec as FxVec } from './fx';

// —— Table geometry (logical units; the canvas scales to fit) —————————————————
export const W = 340;
export const H = 560;
export const BALL_R = 7;
export const PF_L = 8; // playfield left wall
export const PF_R = 306; // shooter-lane inner wall = playfield right edge
export const OUT_R = 332; // outer right wall
export const PF_CX = (PF_L + PF_R) / 2; // playfield centerline (157)
export const BALLS = 3;

// —— Physics ——————————————————————————————————————————————————————————————————
// 240 Hz substeps: at the 1500 u/s speed cap a step moves ≤6.25u — under the
// 7u ball radius, so the ball can never tunnel through a wall or flipper.
export const FIXED = 1000 / 240; // ms per substep
export const DT = 1 / 240; // the same substep in seconds, for the integrator
export const G = 880; // gravity down the table (u/s²)
export const DRAG = 0.1; // air drag fraction per second
export const MAXV = 1500; // ball speed cap (u/s)
export const WALL_PAD = 2; // wall half-thickness (segment endpoints act as round posts)
export const WALL_E = 0.52; // wall restitution
export const REST_VN = 40; // impacts slower than this don't bounce (lets the ball rest)

// Blade length + pivot spread size the center drain: resting tips sit
// 106 − 2·cos(0.52)·43 ≈ 31px apart, ~3px more than the ball needs to pass
// (2·(BALL_R + FLIP_R) = 28), so a ball has to come down nearly dead center to
// slip through instead of merely drifting middle-ish. Two guard rails on this
// number: 39px blades left the gap 10px wider than the ball and the middle was
// a highway (half of all drains); go past ~45px and the gap closes entirely —
// the table then cannot drain down the middle at all and balls sit parked on
// the tips waiting for the stuck-ball nudge. Keep the slack positive but thin.
export const FLIP_LEN = 43;
export const FLIP_R = 7; // flipper capsule half-thickness
export const ANG_UP = 26; // flip-up angular speed (rad/s)
export const ANG_DOWN = 15; // drop-back angular speed (rad/s)

export const CHARGE_S = 1.1; // seconds of hold for a full plunger charge
export const SAVE_S = 4; // ball-saver seconds granted per ball
export const BUMP_V = 480; // pop-bumper kick speed
export const SLING_V = 430; // slingshot kick speed

export const PLUNGE_X = (PF_R + OUT_R) / 2;
export const RACK_Y = 523; // racked ball center at zero charge
export const PLUNGE_HEAD_Y = 530; // plunger head at rest
export const PLUNGE_SQUASH = 22; // how far a full charge compresses the spring
export const DRAIN_Y = H + 24; // ball center past this = drained

// —— Top arch: one circular arc from the left wall over to the outer right
// wall, approximated as segments so the ball glides around it.
export const ARCH_Y = 150; // y where the arch meets both side walls
export const ARCH_CX = 170;
export const ARCH_CY = 260;
export const ARCH_R = Math.hypot(ARCH_CX - PF_L, ARCH_CY - ARCH_Y);
export const ARCH_PTS: FxVec[] = (() => {
  const a0 = Math.atan2(ARCH_Y - ARCH_CY, PF_L - ARCH_CX);
  const a1 = Math.atan2(ARCH_Y - ARCH_CY, OUT_R - ARCH_CX);
  const pts: FxVec[] = [];
  for (let i = 0; i <= 22; i++) {
    const a = a0 + ((a1 - a0) * i) / 22;
    pts.push({ x: ARCH_CX + Math.cos(a) * ARCH_R, y: ARCH_CY + Math.sin(a) * ARCH_R });
  }
  return pts;
})();

// One-way gate at the top of the shooter lane: a launched ball passes it going
// over the arch, but from the playfield side it behaves as a wall, so the ball
// can't fall back into the lane. `gNx/gNy` is the blocked-side normal — the
// segment only collides when the ball's center is on that side.
export type Seg = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  gNx?: number;
  gNy?: number;
};

/** Mirror an x across the playfield centerline — the lower table is symmetric. */
export const mirrorX = (x: number) => PF_L + PF_R - x;

// Outlane geometry, shared with the art in Pinball.tsx so the walls the ball
// feels and the walls the player sees can't drift apart. The channel is 28px
// wide against an effective ball diameter of 18 (BALL_R + WALL_PAD each side);
// anything near 20px for its whole length is a wedge pocket the ball jams in
// instead of falling through. So the divider leans instead: pinched toward the
// side wall at the TOP, narrowing the mouth to 22px — a real outlane post,
// gating entry — while the channel below opens back out to the full 28px, so a
// ball that does get in always falls through cleanly. Widening this mouth is
// the single biggest lever on how often the outlanes eat a ball.
export const OUT_TOP_Y = 404;
export const OUT_BOT_Y = 468;
export const OUT_MOUTH_X = 30; // left divider, top — mouth is this minus PF_L
export const OUT_X = 36; // left divider, bottom

// Where the left inlane guide ends, and where the left flipper is pivoted
// under it. These two are a pair: the guide is a ramp the ball rolls down and
// the pivot end of the flipper is a 7px knuckle, so the ball rides 9px above
// the ramp (BALL_R + WALL_PAD) but 14px above the blade (BALL_R + FLIP_R). Sit
// the pivot level with the ramp's end and that extra 5px of knuckle pokes up
// THROUGH the ramp's ball path: the ball rolls down, jams in the V between
// ramp and knuckle, and dead-rests there — held by two contacts that between
// them cancel gravity, and unflippable besides, since surface velocity at the
// pivot is ~zero. Only the stuck-ball watchdog got it out. So the flipper hangs
// below the ramp it is fed by: FLIP_DROP is chosen to clear the ramp's ball
// path by ~1.8px, and the ball is handed off with a hair of a drop rather than
// a ledge. pinballTable.test.ts pins the clearance at ≥ 0.
export const INLANE_X = 104; // left inlane guide end / left flipper pivot x
export const INLANE_Y = 490; // ...and the height the ramp ends at
export const FLIP_DROP = 7; // pivot hangs this far below the ramp's end

export const SEGS: Seg[] = (() => {
  const segs: Seg[] = [];
  for (let i = 0; i < ARCH_PTS.length - 1; i++) {
    const a = ARCH_PTS[i];
    const b = ARCH_PTS[i + 1];
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
  }
  segs.push(
    { ax: PF_L, ay: ARCH_Y, bx: PF_L, by: 462 }, // left wall
    { ax: OUT_R, ay: ARCH_Y, bx: OUT_R, by: H }, // outer right wall
    { ax: PF_R, ay: 168, bx: PF_R, by: H }, // shooter-lane inner wall
    { ax: PF_R, ay: 547, bx: OUT_R, by: 547 }, // lane floor (under the plunger)
    { ax: PF_R, ay: 119, bx: PF_R, by: 168, gNx: -1, gNy: 0 }, // one-way gate
    // Outlane dividers + inlane guides.
    { ax: OUT_MOUTH_X, ay: OUT_TOP_Y, bx: OUT_X, by: OUT_BOT_Y }, // left outlane divider
    // The inlane guides run all the way over the flipper pivots — ending them
    // short leaves a notch at the junction for the ball to rest dead in. The
    // flipper itself hangs FLIP_DROP below, so the guide is a ramp the ball
    // rolls off onto the blade, never a ledge it can jam against.
    { ax: OUT_X, ay: OUT_BOT_Y, bx: INLANE_X, by: INLANE_Y }, // left inlane guide
    { ax: mirrorX(OUT_MOUTH_X), ay: OUT_TOP_Y, bx: mirrorX(OUT_X), by: OUT_BOT_Y }, // right outlane divider
    { ax: mirrorX(OUT_X), ay: OUT_BOT_Y, bx: mirrorX(INLANE_X), by: INLANE_Y }, // right inlane guide
    // Rollover lane fins — short guides bracketing the lamps, detached from
    // the arch so the dome stays open playfield instead of walled columns.
    { ax: 94, ay: 136, bx: 94, by: 192 },
    { ax: 136, ay: 136, bx: 136, by: 192 },
    { ax: 178, ay: 136, bx: 178, by: 192 },
    { ax: 220, ay: 136, bx: 220, by: 192 },
  );
  return segs;
})();

export type SlingFace = { p: FxVec; q: FxVec; nx: number; ny: number };
export type Sling = { a: FxVec; b: FxVec; c: FxVec; m: FxVec; faces: SlingFace[] };

/** Triangular slingshot: edges a-b and b-c are passive walls; the kicking
 *  face bulges outward through `m`, split into two chords with their own
 *  normals. A flat face fires every kick along one fixed direction, which
 *  lets the two slings volley the ball in a stable "tick-tock" — the convex
 *  face varies the kick by contact point, so volleys diverge. */
export function makeSling(a: FxVec, b: FxVec, c: FxVec): Sling {
  let nx = c.y - a.y;
  let ny = -(c.x - a.x);
  const mx = (a.x + c.x) / 2;
  const my = (a.y + c.y) / 2;
  if (nx * (PF_CX - mx) + ny * (300 - my) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const l = Math.hypot(nx, ny) || 1;
  nx /= l;
  ny /= l;
  const m = { x: mx + nx * 7, y: my + ny * 7 };
  const faces = ([
    [a, m],
    [m, c],
  ] as Array<[FxVec, FxVec]>).map(([p, q]) => {
    let fx = q.y - p.y;
    let fy = -(q.x - p.x);
    if (fx * nx + fy * ny < 0) {
      fx = -fx;
      fy = -fy;
    }
    const fl = Math.hypot(fx, fy) || 1;
    return { p, q, nx: fx / fl, ny: fy / fl };
  });
  return { a, b, c, m, faces };
}

// The slings' outer edges (a-b) lean 5px inward at the top so they are NOT
// parallel to the outlane dividers beside them — a parallel channel lets a
// horizontal ball ping-pong between the two faces indefinitely; the lean turns
// every rebound slightly downward instead.
// The slings float ~34px above the inlane guides — a ball can always pass
// UNDER the wedge to reach the flipper, so nothing on the lower table forms a
// closed pocket it could wedge into.
export const SLINGS: Sling[] = [
  makeSling({ x: 69, y: 384 }, { x: 64, y: 442 }, { x: 96, y: 452 }),
  makeSling({ x: 245, y: 384 }, { x: 250, y: 442 }, { x: 218, y: 452 }),
];

export const BUMPERS = [
  { x: 105, y: 238, r: 16 },
  { x: 209, y: 238, r: 16 },
  { x: 157, y: 302, r: 16 },
  // Side pair below the triangle — fills the mid-table flanks.
  { x: 62, y: 322, r: 14 },
  { x: 252, y: 322, r: 14 },
];

// Two 3-target drop banks angled along the upper flanks. Each target is a
// short standup segment: a firm hit drops it (+150), and dropping all three
// pays the bank bonus and pops them back up. The bank line stands 28px off
// the side wall so the channel behind it stays ball-passable, open at both
// ends — no new pockets.
export type BankTarget = { ax: number; ay: number; bx: number; by: number };
export function bankTargets(x0: number, y0: number, x1: number, y1: number): BankTarget[] {
  const spans: Array<[number, number]> = [
    [0.06, 0.26],
    [0.4, 0.6],
    [0.74, 0.94],
  ];
  return spans.map(([a, b]) => ({
    ax: x0 + (x1 - x0) * a,
    ay: y0 + (y1 - y0) * a,
    bx: x0 + (x1 - x0) * b,
    by: y0 + (y1 - y0) * b,
  }));
}
export const BANKS: BankTarget[][] = [
  bankTargets(36, 202, 74, 282),
  bankTargets(278, 202, 240, 282),
];
export const BANK_PTS = 150;
export const BANK_BONUS = 1000;

export const LAMPS = [
  { x: 115, y: 168 },
  { x: 157, y: 168 },
  { x: 199, y: 168 },
];

// —— Game state ———————————————————————————————————————————————————————————————
export type Phase = 'ready' | 'play' | 'done';
export type Ball = { x: number; y: number; vx: number; vy: number };
export type Flipper = {
  px: number;
  py: number;
  rest: number; // blade angle at rest (rad from +x)
  raised: number; // blade angle when flipped
  angle: number;
  omega: number; // rad/s this substep (drives the impulse transfer)
  pressed: boolean;
};
export type Ev =
  | { kind: 'bumper'; x: number; y: number; i: number }
  | { kind: 'sling'; x: number; y: number; i: number }
  | { kind: 'lane'; x: number; y: number }
  | { kind: 'lanes' }
  | { kind: 'nudge'; x: number; y: number }
  | { kind: 'target'; x: number; y: number }
  | { kind: 'bank'; x: number; y: number };
export type GS = {
  phase: Phase;
  time: number; // sim clock (s) — all cooldowns/deadlines live on this
  ballNo: number; // 1-based
  score: number;
  ball: Ball;
  live: boolean; // false = racked on the plunger
  saveLeft: number; // ball-saver seconds still owed on this ball
  plunger: { pointerId: number | null; t: number }; // t = charge 0..1
  fL: Flipper;
  fR: Flipper;
  bumperCd: number[];
  slingCd: number[];
  lamps: boolean[];
  banks: boolean[][]; // per-bank per-target: true = dropped
  pointers: Map<number, 'L' | 'R'>; // flipper pointers by pointerId
  events: Ev[]; // drained by the frame loop for sounds/fx
  stillT: number; // seconds the live ball has sat near-motionless (stuck watchdog)
};

export const L_REST = 0.52;
export const R_REST = Math.PI - 0.52;
// Resting blade tips — the two posts of the center drain. Exported so the
// ball-saver lamp is drawn across the actual gap rather than a hard-coded one.
export const FLIP_PIVOT_Y = INLANE_Y + FLIP_DROP;
export const TIP_L = INLANE_X + Math.cos(L_REST) * FLIP_LEN;
export const TIP_R = mirrorX(INLANE_X) - Math.cos(L_REST) * FLIP_LEN;

export function freshGS(): GS {
  return {
    phase: 'ready',
    time: 0,
    ballNo: 1,
    score: 0,
    ball: { x: PLUNGE_X, y: RACK_Y, vx: 0, vy: 0 },
    live: false,
    saveLeft: SAVE_S,
    plunger: { pointerId: null, t: 0 },
    fL: {
      px: INLANE_X,
      py: FLIP_PIVOT_Y,
      rest: L_REST,
      raised: -0.55,
      angle: L_REST,
      omega: 0,
      pressed: false,
    },
    fR: {
      px: mirrorX(INLANE_X),
      py: FLIP_PIVOT_Y,
      rest: R_REST,
      raised: Math.PI + 0.55,
      angle: R_REST,
      omega: 0,
      pressed: false,
    },
    bumperCd: [0, 0, 0, 0, 0],
    slingCd: [0, 0],
    lamps: [false, false, false],
    banks: BANKS.map((bank) => bank.map(() => false)),
    pointers: new Map(),
    events: [],
    stillT: 0,
  };
}

/** Fire the racked ball up the shooter lane. `t` is the plunger charge (0..1);
 *  a full charge clears the arch, a light one dribbles back and re-racks. The
 *  ball saver is NOT re-armed here: its seconds are a per-ball budget that only
 *  runs down while the ball is in play, so a saved ball comes back with the
 *  rest of the window rather than a fresh one (which would loop forever for a
 *  player who keeps draining instantly). */
export function launchBall(gs: GS, t: number): void {
  const b = gs.ball;
  b.x = PLUNGE_X;
  b.y = RACK_Y + t * PLUNGE_SQUASH;
  b.vx = 0;
  b.vy = -(620 + 820 * t);
  gs.live = true;
  gs.plunger.t = 0;
}

/** Circle-vs-segment: push the ball out along the contact normal and reflect
 *  with restitution `e`. Returns the impact speed when a bounce was applied
 *  (0 otherwise) so callers can detect kicks. */
export function collideSeg(
  b: Ball,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rad: number,
  e: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby || 1e-6;
  let t = ((b.x - ax) * abx + (b.y - ay) * aby) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + abx * t;
  const qy = ay + aby * t;
  let nx = b.x - qx;
  let ny = b.y - qy;
  const d = Math.hypot(nx, ny);
  if (d >= rad) return 0;
  if (d < 1e-4) {
    const l = Math.hypot(aby, abx) || 1;
    nx = -aby / l;
    ny = abx / l;
  } else {
    nx /= d;
    ny /= d;
  }
  b.x = qx + nx * rad;
  b.y = qy + ny * rad;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    const eff = -vn < REST_VN ? 0 : e;
    b.vx -= (1 + eff) * vn * nx;
    b.vy -= (1 + eff) * vn * ny;
    if (eff > 0) {
      // Anti-stall: deflect every real bounce by a hair (±1.4°) so the ball
      // can never settle into a periodic ping-pong between two facing walls
      // (lane dividers, arch chords). Sub-REST_VN glides are exempt, so the
      // ball still rolls smoothly along the arch. Sim-side RNG is fine here —
      // only the draw path must stay deterministic.
      const j = (Math.random() - 0.5) * 0.05;
      const cj = Math.cos(j);
      const sj = Math.sin(j);
      const rvx = b.vx * cj - b.vy * sj;
      b.vy = b.vx * sj + b.vy * cj;
      b.vx = rvx;
    }
    return -vn;
  }
  return 0;
}

/** Ball vs rotating flipper capsule. The blade's surface velocity at the
 *  contact point (ω × r) joins the reflection, so a ball resting on a flipper
 *  is launched when it flips. */
export function collideFlipper(b: Ball, f: Flipper): void {
  const tx = f.px + Math.cos(f.angle) * FLIP_LEN;
  const ty = f.py + Math.sin(f.angle) * FLIP_LEN;
  const abx = tx - f.px;
  const aby = ty - f.py;
  const len2 = abx * abx + aby * aby || 1e-6;
  let t = ((b.x - f.px) * abx + (b.y - f.py) * aby) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = f.px + abx * t;
  const qy = f.py + aby * t;
  let nx = b.x - qx;
  let ny = b.y - qy;
  const d = Math.hypot(nx, ny);
  const min = BALL_R + FLIP_R;
  if (d >= min) return;
  if (d < 1e-4) {
    nx = 0;
    ny = -1;
  } else {
    nx /= d;
    ny /= d;
  }
  b.x = qx + nx * min;
  b.y = qy + ny * min;
  const ux = -(qy - f.py) * f.omega;
  const uy = (qx - f.px) * f.omega;
  const vn = (b.vx - ux) * nx + (b.vy - uy) * ny;
  if (vn < 0) {
    const eff = -vn < REST_VN && Math.abs(f.omega) < 1 ? 0 : 0.35;
    b.vx -= (1 + eff) * vn * nx;
    b.vy -= (1 + eff) * vn * ny;
  }
}

export function stepFlipper(f: Flipper): void {
  const target = f.pressed ? f.raised : f.rest;
  const prev = f.angle;
  const maxStep = (f.pressed ? ANG_UP : ANG_DOWN) * DT;
  const d = target - f.angle;
  f.angle = Math.abs(d) <= maxStep ? target : f.angle + Math.sign(d) * maxStep;
  f.omega = (f.angle - prev) / DT;
}

/** One 240 Hz physics substep. Gameplay events land in gs.events. */
export function step(gs: GS): void {
  gs.time += DT;
  stepFlipper(gs.fL);
  stepFlipper(gs.fR);
  if (gs.plunger.pointerId !== null && !gs.live) {
    gs.plunger.t = Math.min(1, gs.plunger.t + DT / CHARGE_S);
  }
  if (!gs.live) return;
  if (gs.saveLeft > 0) gs.saveLeft = Math.max(0, gs.saveLeft - DT);

  const b = gs.ball;
  b.vy += G * DT;
  const k = 1 - DRAG * DT;
  b.vx *= k;
  b.vy *= k;
  b.x += b.vx * DT;
  b.y += b.vy * DT;

  // Two constraint passes keep the ball stable when wedged (flipper vs wall).
  for (let iter = 0; iter < 2; iter++) {
    for (const s of SEGS) {
      if (s.gNx !== undefined) {
        // One-way gate: only solid from its blocked side.
        if ((b.x - s.ax) * s.gNx + (b.y - s.ay) * (s.gNy ?? 0) <= 0) continue;
      }
      collideSeg(b, s.ax, s.ay, s.bx, s.by, BALL_R + WALL_PAD, WALL_E);
    }

    for (let i = 0; i < SLINGS.length; i++) {
      const sl = SLINGS[i];
      collideSeg(b, sl.a.x, sl.a.y, sl.b.x, sl.b.y, BALL_R + WALL_PAD, WALL_E);
      collideSeg(b, sl.b.x, sl.b.y, sl.c.x, sl.c.y, BALL_R + WALL_PAD, WALL_E);
      let hit = 0;
      let fnx = 0;
      let fny = 0;
      for (const f of sl.faces) {
        const h = collideSeg(b, f.p.x, f.p.y, f.q.x, f.q.y, BALL_R + WALL_PAD, 0.5);
        if (h > hit) {
          hit = h;
          fnx = f.nx;
          fny = f.ny;
        }
      }
      if (hit > 70 && gs.time >= gs.slingCd[i]) {
        gs.slingCd[i] = gs.time + 0.15;
        // Kick along the struck chord's normal, wobbled a few degrees so
        // repeat kicks never retrace the same line (keeps a bit of the
        // tangential motion too).
        const j = (Math.random() - 0.5) * 0.12;
        const kx = fnx * Math.cos(j) - fny * Math.sin(j);
        const ky = fnx * Math.sin(j) + fny * Math.cos(j);
        const vt = b.vx * -ky + b.vy * kx;
        b.vx = kx * SLING_V + -ky * vt * 0.35;
        b.vy = ky * SLING_V + kx * vt * 0.35;
        gs.score += 50;
        gs.events.push({ kind: 'sling', x: b.x, y: b.y, i });
      }
    }

    for (let i = 0; i < BUMPERS.length; i++) {
      const bp = BUMPERS[i];
      const dx = b.x - bp.x;
      const dy = b.y - bp.y;
      const d = Math.hypot(dx, dy) || 1e-4;
      const min = bp.r + BALL_R;
      if (d >= min) continue;
      const nx = dx / d;
      const ny = dy / d;
      b.x = bp.x + nx * min;
      b.y = bp.y + ny * min;
      if (gs.time >= gs.bumperCd[i]) {
        // Pop-bumper: fires the ball outward at full kick speed.
        gs.bumperCd[i] = gs.time + 0.1;
        b.vx = nx * BUMP_V + b.vx * 0.2;
        b.vy = ny * BUMP_V + b.vy * 0.2;
        gs.score += 100;
        gs.events.push({ kind: 'bumper', x: bp.x + nx * bp.r, y: bp.y + ny * bp.r, i });
      } else {
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= 1.6 * vn * nx;
          b.vy -= 1.6 * vn * ny;
        }
      }
    }

    // Drop-target banks: only standing targets collide; a firm hit drops the
    // target, and clearing the bank pays the bonus and pops all three back up.
    for (let bi = 0; bi < BANKS.length; bi++) {
      for (let ti = 0; ti < BANKS[bi].length; ti++) {
        if (gs.banks[bi][ti]) continue;
        const t = BANKS[bi][ti];
        const hit = collideSeg(b, t.ax, t.ay, t.bx, t.by, BALL_R + 2.5, 0.55);
        if (hit > 60) {
          gs.banks[bi][ti] = true;
          gs.score += BANK_PTS;
          const mx = (t.ax + t.bx) / 2;
          const my = (t.ay + t.by) / 2;
          gs.events.push({ kind: 'target', x: mx, y: my });
          if (gs.banks[bi].every(Boolean)) {
            gs.score += BANK_BONUS;
            gs.banks[bi] = BANKS[bi].map(() => false);
            gs.events.push({ kind: 'bank', x: mx, y: my });
          }
        }
      }
    }

    collideFlipper(b, gs.fL);
    collideFlipper(b, gs.fR);
  }

  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAXV) {
    b.vx = (b.vx / sp) * MAXV;
    b.vy = (b.vy / sp) * MAXV;
  }

  // Stuck-ball watchdog. The table has no slope toward the drain, so the ball
  // can come to a true dead rest cradled between contacts — REST_VN kills
  // every bounce there and the anti-stall bounce jitter never fires on a
  // resting contact. After ~1.2s of standstill, give it the bump a tilted
  // playfield would. The flipper zone is exempt only WHILE a flipper is held
  // up (that's a deliberate trap); a ball dead-rested on lowered flippers —
  // e.g. balanced at a flipper pivot, where flipping imparts ~zero surface
  // velocity — is a stuck ball like any other. The shooter lane stays exempt
  // so weak launches can fall back and re-rack in peace.
  const flipperHeld = gs.fL.pressed || gs.fR.pressed;
  if (sp < 26 && b.x < PF_R - BALL_R && (b.y < 462 || !flipperHeld)) {
    gs.stillT += DT;
    if (gs.stillT >= 1.2) {
      gs.stillT = 0;
      if (b.y >= 440) {
        // At the flippers: pop mostly upward so the player gets a real save
        // attempt — a sideways shove here would feed the drain.
        b.vx += (b.x > PF_CX ? -1 : 1) * (30 + Math.random() * 30);
        b.vy -= 150 + Math.random() * 50;
      } else {
        const dir = b.x > PF_CX ? -1 : 1;
        b.vx += dir * (90 + Math.random() * 60);
        b.vy -= 30 + Math.random() * 40;
      }
      gs.events.push({ kind: 'nudge', x: b.x, y: b.y });
    }
  } else {
    gs.stillT = 0;
  }

  // Rollover lanes: light the lamp, and all three lit pays the LANES bonus.
  for (let i = 0; i < LAMPS.length; i++) {
    if (gs.lamps[i]) continue;
    const L = LAMPS[i];
    if (Math.hypot(b.x - L.x, b.y - L.y) < 13) {
      gs.lamps[i] = true;
      gs.score += 500;
      gs.events.push({ kind: 'lane', x: L.x, y: L.y });
      if (gs.lamps.every(Boolean)) {
        gs.score += 2000;
        gs.lamps = [false, false, false];
        gs.events.push({ kind: 'lanes' });
      }
    }
  }
}
