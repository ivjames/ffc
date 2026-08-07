import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useFitCanvas } from './useFitCanvas';
import {
  playStroke,
  playCup,
  playUndo,
  playDing,
  playBuzz,
  playTick,
  playBump,
  playPinClack,
  playFanfare,
} from '../../lib/sound';
import type { Particle, Vec as FxVec, Floater } from './fx';
import {
  TWO_PI,
  withAlpha,
  roundRectPath,
  drawShadow,
  drawSphere,
  neonLine,
  spawnBurst,
  stepParticles,
  drawParticles,
  spawnFloater,
  stepFloaters,
  drawFloaters,
  pushTrail,
  decay,
  shakeOffset,
} from './fx';

// §12 Pinball — the flagship Fun Zone mini-game. A real pop-bumper table:
// press-and-hold to charge the spring plunger and launch up the shooter lane,
// then flip with the left/right halves of the screen (multi-touch, both
// flippers at once). Pop bumpers, slingshots and rollover lanes score across
// 3 balls, with a 2-second ball saver after each launch. The sim is a
// gravity + circle-vs-segment physics engine at 240 Hz fixed substeps; the
// flippers are rotating capsule segments that transfer their surface velocity
// to the ball at the contact point. All client-side, canvas, offline.

// —— Table geometry (logical units; the canvas scales to fit) —————————————————
const W = 340;
const H = 560;
const BALL_R = 7;
const PF_L = 8; // playfield left wall
const PF_R = 306; // shooter-lane inner wall = playfield right edge
const OUT_R = 332; // outer right wall
const PF_CX = (PF_L + PF_R) / 2; // playfield centerline (157)
const BALLS = 3;

// —— Physics ——————————————————————————————————————————————————————————————————
// 240 Hz substeps: at the 1500 u/s speed cap a step moves ≤6.25u — under the
// 7u ball radius, so the ball can never tunnel through a wall or flipper.
const FIXED = 1000 / 240; // ms per substep
const DT = 1 / 240; // the same substep in seconds, for the integrator
const G = 880; // gravity down the table (u/s²)
const DRAG = 0.1; // air drag fraction per second
const MAXV = 1500; // ball speed cap (u/s)
const WALL_PAD = 2; // wall half-thickness (segment endpoints act as round posts)
const WALL_E = 0.52; // wall restitution
const REST_VN = 40; // impacts slower than this don't bounce (lets the ball rest)

const FLIP_LEN = 42;
const FLIP_R = 7; // flipper capsule half-thickness
const ANG_UP = 26; // flip-up angular speed (rad/s)
const ANG_DOWN = 15; // drop-back angular speed (rad/s)

const CHARGE_S = 1.1; // seconds of hold for a full plunger charge
const SAVE_S = 2; // ball-saver window after each launch
const BUMP_V = 480; // pop-bumper kick speed
const SLING_V = 430; // slingshot kick speed

const PLUNGE_X = (PF_R + OUT_R) / 2;
const RACK_Y = 523; // racked ball center at zero charge
const PLUNGE_HEAD_Y = 530; // plunger head at rest
const PLUNGE_SQUASH = 22; // how far a full charge compresses the spring

// —— Top arch: one circular arc from the left wall over to the outer right
// wall, approximated as segments so the ball glides around it.
const ARCH_Y = 150; // y where the arch meets both side walls
const ARCH_CX = 170;
const ARCH_CY = 260;
const ARCH_R = Math.hypot(ARCH_CX - PF_L, ARCH_CY - ARCH_Y);
const ARCH_PTS: FxVec[] = (() => {
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
type Seg = { ax: number; ay: number; bx: number; by: number; gNx?: number; gNy?: number };

const SEGS: Seg[] = (() => {
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
    // Outlane dividers + inlane guides. Channel widths are 28px against an
    // effective ball diameter of 18 (BALL_R + WALL_PAD each side) — anything
    // near 20px is a wedge pocket the ball jams in instead of falling through.
    { ax: 36, ay: 404, bx: 36, by: 468 }, // left outlane divider
    { ax: 36, ay: 468, bx: 107, by: 489 }, // left inlane guide → flipper
    { ax: 278, ay: 404, bx: 278, by: 468 }, // right outlane divider
    { ax: 278, ay: 468, bx: 207, by: 489 }, // right inlane guide → flipper
    // Rollover lane fins — short guides bracketing the lamps, detached from
    // the arch so the dome stays open playfield instead of walled columns.
    { ax: 94, ay: 136, bx: 94, by: 192 },
    { ax: 136, ay: 136, bx: 136, by: 192 },
    { ax: 178, ay: 136, bx: 178, by: 192 },
    { ax: 220, ay: 136, bx: 220, by: 192 },
  );
  return segs;
})();

type Sling = { a: FxVec; b: FxVec; c: FxVec; nx: number; ny: number };

/** Triangular slingshot: edges a-b and b-c are passive walls; the a-c face
 *  kicks. The kick normal is oriented toward the playfield interior. */
function makeSling(a: FxVec, b: FxVec, c: FxVec): Sling {
  let nx = c.y - a.y;
  let ny = -(c.x - a.x);
  const mx = (a.x + c.x) / 2;
  const my = (a.y + c.y) / 2;
  if (nx * (PF_CX - mx) + ny * (300 - my) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const l = Math.hypot(nx, ny) || 1;
  return { a, b, c, nx: nx / l, ny: ny / l };
}

// The slings' outer edges (a-b) lean 5px inward at the top so they are NOT
// parallel to the outlane dividers beside them — a parallel channel lets a
// horizontal ball ping-pong between the two faces indefinitely; the lean turns
// every rebound slightly downward instead.
// The slings float ~34px above the inlane guides — a ball can always pass
// UNDER the wedge to reach the flipper, so nothing on the lower table forms a
// closed pocket it could wedge into.
const SLINGS: Sling[] = [
  makeSling({ x: 69, y: 384 }, { x: 64, y: 442 }, { x: 96, y: 452 }),
  makeSling({ x: 245, y: 384 }, { x: 250, y: 442 }, { x: 218, y: 452 }),
];

const BUMPERS = [
  { x: 105, y: 238, r: 16 },
  { x: 209, y: 238, r: 16 },
  { x: 157, y: 302, r: 16 },
];

const LAMPS = [
  { x: 115, y: 168 },
  { x: 157, y: 168 },
  { x: 199, y: 168 },
];

// —— Game state ———————————————————————————————————————————————————————————————
type Phase = 'ready' | 'play' | 'done';
type Ball = { x: number; y: number; vx: number; vy: number };
type Flipper = {
  px: number;
  py: number;
  rest: number; // blade angle at rest (rad from +x)
  raised: number; // blade angle when flipped
  angle: number;
  omega: number; // rad/s this substep (drives the impulse transfer)
  pressed: boolean;
};
type Ev =
  | { kind: 'bumper'; x: number; y: number; i: number }
  | { kind: 'sling'; x: number; y: number; i: number }
  | { kind: 'lane'; x: number; y: number }
  | { kind: 'lanes' }
  | { kind: 'nudge'; x: number; y: number };
type GS = {
  phase: Phase;
  time: number; // sim clock (s) — all cooldowns/deadlines live on this
  ballNo: number; // 1-based
  score: number;
  ball: Ball;
  live: boolean; // false = racked on the plunger
  saveUntil: number; // ball-saver deadline (sim time)
  plunger: { pointerId: number | null; t: number }; // t = charge 0..1
  fL: Flipper;
  fR: Flipper;
  bumperCd: number[];
  slingCd: number[];
  lamps: boolean[];
  pointers: Map<number, 'L' | 'R'>; // flipper pointers by pointerId
  events: Ev[]; // drained by the frame loop for sounds/fx
  stillT: number; // seconds the live ball has sat near-motionless (stuck watchdog)
};

const L_REST = 0.52;
const R_REST = Math.PI - 0.52;

function freshGS(): GS {
  return {
    phase: 'ready',
    time: 0,
    ballNo: 1,
    score: 0,
    ball: { x: PLUNGE_X, y: RACK_Y, vx: 0, vy: 0 },
    live: false,
    saveUntil: 0,
    plunger: { pointerId: null, t: 0 },
    fL: { px: 110, py: 490, rest: L_REST, raised: -0.55, angle: L_REST, omega: 0, pressed: false },
    fR: { px: 204, py: 490, rest: R_REST, raised: Math.PI + 0.55, angle: R_REST, omega: 0, pressed: false },
    bumperCd: [0, 0, 0],
    slingCd: [0, 0],
    lamps: [false, false, false],
    pointers: new Map(),
    events: [],
    stillT: 0,
  };
}

/** Circle-vs-segment: push the ball out along the contact normal and reflect
 *  with restitution `e`. Returns the impact speed when a bounce was applied
 *  (0 otherwise) so callers can detect kicks. */
function collideSeg(
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
function collideFlipper(b: Ball, f: Flipper): void {
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

function stepFlipper(f: Flipper): void {
  const target = f.pressed ? f.raised : f.rest;
  const prev = f.angle;
  const maxStep = (f.pressed ? ANG_UP : ANG_DOWN) * DT;
  const d = target - f.angle;
  f.angle = Math.abs(d) <= maxStep ? target : f.angle + Math.sign(d) * maxStep;
  f.omega = (f.angle - prev) / DT;
}

/** One 240 Hz physics substep. Gameplay events land in gs.events. */
function step(gs: GS): void {
  gs.time += DT;
  stepFlipper(gs.fL);
  stepFlipper(gs.fR);
  if (gs.plunger.pointerId !== null && !gs.live) {
    gs.plunger.t = Math.min(1, gs.plunger.t + DT / CHARGE_S);
  }
  if (!gs.live) return;

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
      const hit = collideSeg(b, sl.a.x, sl.a.y, sl.c.x, sl.c.y, BALL_R + WALL_PAD, 0.5);
      if (hit > 70 && gs.time >= gs.slingCd[i]) {
        gs.slingCd[i] = gs.time + 0.15;
        // Kick along the face normal, keeping a bit of tangential motion.
        const vt = b.vx * -sl.ny + b.vy * sl.nx;
        b.vx = sl.nx * SLING_V + -sl.ny * vt * 0.35;
        b.vy = sl.ny * SLING_V + sl.nx * vt * 0.35;
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

    collideFlipper(b, gs.fL);
    collideFlipper(b, gs.fR);
  }

  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAXV) {
    b.vx = (b.vx / sp) * MAXV;
    b.vy = (b.vy / sp) * MAXV;
  }

  // Stuck-ball watchdog. The table has no slope toward the drain, so the ball
  // can come to a true dead rest cradled between wall tips (the outlane mouth
  // is the classic spot) — REST_VN kills every bounce there and the anti-stall
  // bounce jitter never fires on a resting contact. After ~1.2s of standstill,
  // give it the bump a tilted playfield would: a kick toward the playfield
  // center with a little lift. The flipper zone (y ≥ 462) is exempt so a ball
  // deliberately trapped on a flipper stays trapped, as is the shooter lane
  // (weak launches are allowed to fall back and re-rack in peace).
  if (sp < 26 && b.y < 462 && b.x < PF_R - BALL_R) {
    gs.stillT += DT;
    if (gs.stillT >= 1.2) {
      gs.stillT = 0;
      const dir = b.x > PF_CX ? -1 : 1;
      b.vx += dir * (90 + Math.random() * 60);
      b.vy -= 30 + Math.random() * 40;
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

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the fixed-timestep sim is never touched; they're
// advanced per animation frame with a real dt and only ever paint pixels.
type FX = {
  trail: FxVec[]; // recent ball positions → motion streak
  particles: Particle[]; // spark bursts on bumpers/slings/launch
  floaters: Floater[]; // rising "+100" score popups
  shake: number; // impact shake magnitude (px), decays to 0
  flash: number; // LANES-bonus flash 0..1, decays to 0
  flashColor: string;
  bumperGlow: number[]; // per-bumper hit glow 0..1
  slingGlow: number[]; // per-sling face flash 0..1
  plungerPop: number; // launch recoil of the plunger head 0..1
};

function freshFX(): FX {
  return {
    trail: [],
    particles: [],
    floaters: [],
    shake: 0,
    flash: 0,
    flashColor: '#fde68a',
    bumperGlow: [0, 0, 0],
    slingGlow: [0, 0],
    plungerPop: 0,
  };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, gs: GS, dt: number) {
  if (gs.live && Math.hypot(gs.ball.vx, gs.ball.vy) > 140) {
    pushTrail(fx.trail, gs.ball.x, gs.ball.y, 12);
  } else if (!gs.live) {
    fx.trail.length = 0;
  }
  fx.particles = stepParticles(fx.particles, dt, 0.02, 500);
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
  fx.plungerPop = decay(fx.plungerPop, dt, 0.006);
  for (let i = 0; i < fx.bumperGlow.length; i++) fx.bumperGlow[i] = decay(fx.bumperGlow[i], dt, 0.004);
  for (let i = 0; i < fx.slingGlow.length; i++) fx.slingGlow[i] = decay(fx.slingGlow[i], dt, 0.005);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** Stroke a wall path twice: a dark body then a glowing neon core. */
function rails(ctx: CanvasRenderingContext2D, trace: (c: CanvasRenderingContext2D) => void) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#2c2452';
  trace(ctx);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#8b7bd8';
  ctx.shadowColor = 'rgba(139,123,216,0.8)';
  ctx.shadowBlur = 7;
  trace(ctx);
  ctx.stroke();
  ctx.restore();
}

function traceOutline(c: CanvasRenderingContext2D) {
  c.beginPath();
  c.moveTo(PF_L, 462);
  c.lineTo(PF_L, ARCH_Y);
  for (const p of ARCH_PTS) c.lineTo(p.x, p.y);
  c.lineTo(OUT_R, H);
}

function traceInnerWalls(c: CanvasRenderingContext2D) {
  c.beginPath();
  c.moveTo(PF_R, 168);
  c.lineTo(PF_R, H);
  // Outlane dividers + inlane guides (matching SEGS).
  c.moveTo(36, 404);
  c.lineTo(36, 468);
  c.lineTo(107, 489);
  c.moveTo(278, 404);
  c.lineTo(278, 468);
  c.lineTo(207, 489);
  // Rollover lane fins — short guides around the lamps (matching SEGS).
  c.moveTo(94, 136);
  c.lineTo(94, 192);
  c.moveTo(136, 136);
  c.lineTo(136, 192);
  c.moveTo(178, 136);
  c.lineTo(178, 192);
  c.moveTo(220, 136);
  c.lineTo(220, 192);
}

function drawSlingShape(ctx: CanvasRenderingContext2D, s: Sling, glow: number) {
  ctx.beginPath();
  ctx.moveTo(s.a.x, s.a.y);
  ctx.lineTo(s.b.x, s.b.y);
  ctx.lineTo(s.c.x, s.c.y);
  ctx.closePath();
  const g = ctx.createLinearGradient(s.a.x, s.a.y, s.b.x, s.b.y);
  g.addColorStop(0, '#b91c1c');
  g.addColorStop(1, '#5f1414');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(10,7,25,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // The kicking face, lit hotter while it fires.
  ctx.save();
  ctx.strokeStyle = withAlpha('#fbbf24', 0.7 + glow * 0.3);
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur = 6 + glow * 16;
  ctx.lineWidth = 3 + glow * 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s.a.x, s.a.y);
  ctx.lineTo(s.c.x, s.c.y);
  ctx.stroke();
  ctx.restore();
}

function drawBumper(
  ctx: CanvasRenderingContext2D,
  b: { x: number; y: number; r: number },
  glow: number,
) {
  drawShadow(ctx, b.x, b.y + 4, b.r * 0.95, b.r * 0.4, 0.35);
  if (glow > 0.02) {
    // Expanding hit ring.
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + (1 - glow) * 16, 0, TWO_PI);
    ctx.strokeStyle = withAlpha('#f0abfc', glow * 0.7);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  drawSphere(ctx, b.x, b.y, b.r, '#fbcfe8', '#db2777', '#701a38', { rim: true });
  drawSphere(ctx, b.x, b.y, b.r * 0.6, '#fdf2f8', '#f472b6', '#9d2458', { specular: false });
  ctx.save();
  ctx.font = 'bold 8px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(255,255,255,${0.85 + glow * 0.15})`;
  ctx.fillText('100', b.x, b.y + 3);
  ctx.restore();
}

function drawFlipper(ctx: CanvasRenderingContext2D, f: Flipper) {
  const tx = f.px + Math.cos(f.angle) * FLIP_LEN;
  const ty = f.py + Math.sin(f.angle) * FLIP_LEN;
  drawShadow(ctx, (f.px + tx) / 2, (f.py + ty) / 2 + 5, FLIP_LEN * 0.55, 6, 0.3);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(f.px, f.py);
  ctx.lineTo(tx, ty);
  ctx.lineWidth = FLIP_R * 2 + 2;
  ctx.strokeStyle = '#7c2d12';
  ctx.stroke();
  const g = ctx.createLinearGradient(f.px, f.py, tx, ty);
  g.addColorStop(0, '#fcd34d');
  g.addColorStop(1, '#d97706');
  ctx.beginPath();
  ctx.moveTo(f.px, f.py);
  ctx.lineTo(tx, ty);
  ctx.lineWidth = FLIP_R * 2 - 2;
  ctx.strokeStyle = g;
  ctx.stroke();
  ctx.restore();
  drawSphere(ctx, f.px, f.py, 5.5, '#fef3c7', '#f59e0b', '#92400e', { specular: false });
}

function drawPlunger(ctx: CanvasRenderingContext2D, t: number, pop: number) {
  const headY = PLUNGE_HEAD_Y + t * PLUNGE_SQUASH - pop * 9;
  // Compressed spring coil.
  ctx.save();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PLUNGE_X, headY + 8);
  const coils = 5;
  for (let i = 0; i < coils; i++) {
    const yy = headY + 8 + ((546 - headY - 8) * (i + 0.5)) / coils;
    ctx.lineTo(PLUNGE_X + (i % 2 === 0 ? 6 : -6), yy);
  }
  ctx.lineTo(PLUNGE_X, 546);
  ctx.stroke();
  ctx.restore();
  // Plunger head.
  const g = ctx.createLinearGradient(0, headY, 0, headY + 9);
  g.addColorStop(0, '#fca5a5');
  g.addColorStop(1, '#7f1d1d');
  ctx.fillStyle = g;
  roundRectPath(ctx, PF_R + 4, headY, OUT_R - PF_R - 8, 9, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(10,7,25,0.7)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, PF_R + 4, headY, OUT_R - PF_R - 8, 9, 3);
  ctx.stroke();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);

  // —— Playfield: dark glossy deck with a soft overhead sheen ——
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#181239');
  bg.addColorStop(0.5, '#0f0a24');
  bg.addColorStop(1, '#080513');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const sheen = ctx.createRadialGradient(PF_CX, H * 0.3, 20, PF_CX, H * 0.3, H * 0.7);
  sheen.addColorStop(0, 'rgba(147,120,255,0.12)');
  sheen.addColorStop(1, 'rgba(147,120,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  // Cabinet mask outside the walls (sides + above the arch).
  ctx.fillStyle = '#04030c';
  ctx.fillRect(0, 0, PF_L, H);
  ctx.fillRect(OUT_R, 0, W - OUT_R, H);
  ctx.beginPath();
  ctx.moveTo(0, 170);
  ctx.lineTo(PF_L, ARCH_Y);
  for (const p of ARCH_PTS) ctx.lineTo(p.x, p.y);
  ctx.lineTo(W, 170);
  ctx.lineTo(W, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  // Shooter lane strip, slightly recessed.
  const lane = ctx.createLinearGradient(PF_R, 0, OUT_R, 0);
  lane.addColorStop(0, '#0a0718');
  lane.addColorStop(0.5, '#151030');
  lane.addColorStop(1, '#0a0718');
  ctx.fillStyle = lane;
  ctx.fillRect(PF_R, 119, OUT_R - PF_R, H - 119);

  // —— Deterministic decals (index-derived, identical every frame) ——
  for (let i = 0; i < 24; i++) {
    const x = 18 + ((i * 89) % 272);
    const y = 200 + ((i * 137) % 290);
    ctx.fillStyle = withAlpha('#c4b5fd', 0.05 + ((i * 31) % 4) * 0.015);
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.save();
  ctx.strokeStyle = withAlpha('#db2777', 0.14);
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(BUMPERS[0].x, BUMPERS[0].y);
  ctx.lineTo(BUMPERS[1].x, BUMPERS[1].y);
  ctx.lineTo(BUMPERS[2].x, BUMPERS[2].y);
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = withAlpha('#8b5cf6', 0.1);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(157, 260, 78, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();

  // Vignette for depth.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // —— Dynamic layer (shaken on bumper hits) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  rails(ctx, traceOutline);
  rails(ctx, traceInnerWalls);

  // One-way gate wire at the lane top.
  ctx.save();
  ctx.strokeStyle = withAlpha('#fbbf24', 0.55);
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(PF_R, 121);
  ctx.lineTo(PF_R, 166);
  ctx.stroke();
  ctx.restore();

  // Rollover lamps (pulse while lit).
  for (let i = 0; i < LAMPS.length; i++) {
    const L = LAMPS[i];
    if (gs.lamps[i]) {
      const pulse = 0.65 + 0.35 * Math.sin(now / 150 + i);
      ctx.beginPath();
      ctx.arc(L.x, L.y, 11, 0, TWO_PI);
      ctx.fillStyle = withAlpha('#fde68a', 0.25 * pulse);
      ctx.fill();
      ctx.save();
      ctx.shadowColor = '#fde68a';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(L.x, L.y, 6, 0, TWO_PI);
      ctx.fillStyle = '#fde68a';
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(L.x, L.y, 6, 0, TWO_PI);
      ctx.fillStyle = '#2a2350';
      ctx.fill();
      ctx.strokeStyle = withAlpha('#fde68a', 0.35);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  for (let i = 0; i < SLINGS.length; i++) drawSlingShape(ctx, SLINGS[i], fx.slingGlow[i]);
  for (let i = 0; i < BUMPERS.length; i++) drawBumper(ctx, BUMPERS[i], fx.bumperGlow[i]);

  drawPlunger(ctx, gs.live ? 0 : gs.plunger.t, fx.plungerPop);

  // Charge meter up the shooter lane while the plunger is held.
  if (!gs.live && gs.plunger.pointerId !== null) {
    const t = gs.plunger.t;
    const color = t < 0.5 ? '#4ade80' : t < 0.8 ? '#fbbf24' : '#f87171';
    neonLine(ctx, PF_R + 5, 542, PF_R + 5, 542 - t * 360, color, 3, 10);
  }

  // Ball-saver lamp across the drain while the saver is armed.
  if (gs.live && gs.time < gs.saveUntil) {
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.4 * Math.sin(now / 120);
    neonLine(ctx, 137, 548, 177, 548, '#4ade80', 3, 12);
    ctx.restore();
  }

  drawFlipper(ctx, gs.fL);
  drawFlipper(ctx, gs.fR);

  // Ball motion streak.
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, BALL_R * (0.3 + k * 0.6), 0, TWO_PI);
    ctx.fillStyle = withAlpha('#bfdbfe', 0.03 + k * 0.12);
    ctx.fill();
  }

  // The ball (racked balls sit on the plunger, squashing down as it charges).
  drawShadow(ctx, gs.ball.x, gs.ball.y + 5, BALL_R * 0.95, BALL_R * 0.5, 0.4);
  drawSphere(ctx, gs.ball.x, gs.ball.y, BALL_R, '#ffffff', '#d7dee8', '#77828f', { rim: true });

  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
  ctx.restore();

  // —— LANES-bonus flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }
}

export default function Pinball() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());
  const scoreShownRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [ballNo, setBallNo] = useState(1);
  const [liveUI, setLiveUI] = useState(false); // mirrors gs.live for the hint line

  const active = phase !== 'done';
  useFitCanvas(canvasRef, W, H, active);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    // Pause via visibilitychange, not a hidden-rAF branch: mobile browsers
    // suspend requestAnimationFrame while backgrounded, so a hidden frame may
    // never run to keep `last` fresh. Everything time-based in the sim runs on
    // gs.time (which only advances in substeps), so resetting the accumulator
    // on resume is the whole pause story.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        hiddenAt = 0;
        last = performance.now();
        acc = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const frame = (now: number) => {
      const gs = gsRef.current;
      const fx = fxRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(now - last, 100); // clamp to avoid a spiral after a stall
      acc += dt;
      last = now;

      while (acc >= FIXED) {
        if (gs.phase === 'play') step(gs);
        acc -= FIXED;
      }

      if (gs.phase === 'play') {
        const b = gs.ball;
        if (!gs.live) {
          // Racked: the ball rides the plunger head as the spring squashes.
          b.x = PLUNGE_X;
          b.y = RACK_Y + gs.plunger.t * PLUNGE_SQUASH;
          b.vx = 0;
          b.vy = 0;
        } else if (b.x > PF_R && b.y > 520 && Math.hypot(b.vx, b.vy) < 80) {
          // A weak launch fell back down the shooter lane: quietly re-rack.
          gs.live = false;
          gs.plunger.t = 0;
        } else if (b.y > H + 24) {
          // Drained.
          gs.live = false;
          gs.plunger.t = 0;
          fx.trail.length = 0;
          if (gs.time < gs.saveUntil) {
            playUndo();
            spawnFloater(fx.floaters, PF_CX, 470, 'BALL SAVED', '#4ade80', { size: 20, life: 1000 });
          } else if (gs.ballNo >= BALLS) {
            gs.phase = 'done';
            setPhase('done');
            playFanfare();
          } else {
            playBuzz();
            gs.ballNo += 1;
            setBallNo(gs.ballNo);
            spawnFloater(fx.floaters, PF_CX, 470, 'DRAIN', '#94a3b8', { size: 18, life: 800 });
          }
        }

        for (const ev of gs.events) {
          if (ev.kind === 'bumper') {
            playBump(1.1);
            fx.shake = Math.min(6, fx.shake + 3);
            fx.bumperGlow[ev.i] = 1;
            spawnBurst(fx.particles, ev.x, ev.y, 10, 240, '#f0abfc');
            spawnFloater(fx.floaters, ev.x, ev.y - 10, '+100', '#f0abfc', { size: 15 });
          } else if (ev.kind === 'sling') {
            playPinClack(0.8);
            fx.slingGlow[ev.i] = 1;
            spawnBurst(fx.particles, ev.x, ev.y, 6, 170, '#fbbf24');
            spawnFloater(fx.floaters, ev.x, ev.y - 10, '+50', '#fcd34d', { size: 13 });
          } else if (ev.kind === 'lane') {
            playDing();
            spawnBurst(fx.particles, ev.x, ev.y, 8, 150, '#fde68a');
            spawnFloater(fx.floaters, ev.x, ev.y + 22, '+500', '#fde68a', { size: 16, life: 800 });
          } else if (ev.kind === 'nudge') {
            playTick();
            fx.shake = Math.min(4, fx.shake + 2.5);
            spawnFloater(fx.floaters, ev.x, ev.y - 14, 'NUDGE', '#94a3b8', { size: 12, life: 600 });
          } else {
            playCup();
            fx.flash = 1;
            fx.flashColor = '#fde68a';
            fx.shake = Math.min(7, fx.shake + 5);
            spawnBurst(fx.particles, PF_CX, 200, 30, 320, '#fde68a');
            spawnFloater(fx.floaters, PF_CX, 230, 'LANES! +2000', '#fde68a', { size: 24, life: 1100 });
          }
        }
        gs.events.length = 0;

        if (gs.score !== scoreShownRef.current) {
          scoreShownRef.current = gs.score;
          setScore(gs.score);
        }
        setLiveUI(gs.live); // no-op re-render unless it actually changed
      }

      updateFX(fx, gs, dt);
      draw(ctx, gs, fx, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);

  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }, []);

  const launch = useCallback(() => {
    const gs = gsRef.current;
    const t = gs.plunger.t;
    const b = gs.ball;
    b.x = PLUNGE_X;
    b.y = RACK_Y + t * PLUNGE_SQUASH;
    b.vx = 0;
    b.vy = -(620 + 820 * t);
    gs.live = true;
    gs.saveUntil = gs.time + SAVE_S;
    gs.plunger.t = 0;
    fxRef.current.plungerPop = 1;
    playStroke();
    playBump(0.4 + t); // spring thunk scaled with the charge
    spawnBurst(fxRef.current.particles, b.x, b.y, 8, 160, '#a5f3fc');
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (gs.phase !== 'play') return;
      canvasRef.current?.setPointerCapture(e.pointerId);
      // While the ball is racked, the first touch anywhere charges the plunger;
      // additional touches (and all touches while live) work the flippers.
      if (!gs.live && gs.plunger.pointerId === null) {
        gs.plunger.pointerId = e.pointerId;
        gs.plunger.t = 0;
        return;
      }
      const side = toField(e).x < W / 2 ? 'L' : 'R';
      gs.pointers.set(e.pointerId, side);
      const f = side === 'L' ? gs.fL : gs.fR;
      if (!f.pressed) playTick();
      f.pressed = true;
    },
    [toField],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (e.pointerId === gs.plunger.pointerId) {
        gs.plunger.pointerId = null;
        if (gs.phase === 'play' && !gs.live) launch();
        return;
      }
      if (!gs.pointers.has(e.pointerId)) return;
      gs.pointers.delete(e.pointerId);
      let l = false;
      let r = false;
      gs.pointers.forEach((s) => {
        if (s === 'L') l = true;
        else r = true;
      });
      gs.fL.pressed = l;
      gs.fR.pressed = r;
    },
    [launch],
  );

  const start = useCallback(() => {
    const gs = freshGS();
    gs.phase = 'play';
    gsRef.current = gs;
    fxRef.current = freshFX();
    scoreShownRef.current = 0;
    setScore(0);
    setBallNo(1);
    setPhase('play');
  }, []);

  if (phase === 'done') {
    const remark =
      score >= 10000
        ? 'Pinball Wizard! 🧙'
        : score >= 5000
          ? 'Flipper ace! 🔥'
          : score >= 2000
            ? 'Solid game! 👍'
            : 'Keep flipping! 🎮';
    return (
      <Screen>
        <TopBar title="Pinball" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🕹️</span>
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">across {BALLS} balls</p>
          </div>
          <div className="mt-8">
            <Button onClick={start} sound="none">
              Play again
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  const racked = phase === 'play' && !liveUI;
  const hint =
    phase === 'ready'
      ? 'Charge the plunger, flip with the screen halves — 3 balls.'
      : racked
        ? 'Hold anywhere to charge the plunger — release to launch!'
        : 'Left / right half = flippers. Light all 3 lanes for a bonus!';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Pinball" back="/fun" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Ball <span className="text-fairway-100">{Math.min(ballNo, BALLS)}</span>
          <span className="font-normal text-fairway-400"> / {BALLS}</span>
        </span>
        <span className="text-fairway-300">
          Score <span className="font-bold text-fairway-100">{score}</span>
        </span>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="col-start-1 row-start-1 block touch-none rounded-2xl border border-fairway-800"
        />
        {phase === 'ready' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <span className="text-5xl">🕹️</span>
            <p className="text-sm text-fairway-100">
              Hold to charge the plunger, release to launch. Tap the left / right halves to flip —
              both at once works. {BALLS} balls: bumpers 100, slings 50, lanes 500.
            </p>
            <Button onClick={start}>Start</Button>
          </div>
        )}
      </div>

      <p className="flex h-16 shrink-0 items-center justify-center px-4 pb-4 pt-3 text-center text-sm text-fairway-100/80">
        <span className="line-clamp-2">{hint}</span>
      </p>
    </div>
  );
}
