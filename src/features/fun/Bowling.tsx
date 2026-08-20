import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameAwards from './GameAwards';
import GameHighScore from './GameHighScore';
import { useFitCanvas } from './useFitCanvas';
import { drawLogo, logoReady } from './logo';
import { playStroke, playCup, playUndo, playPinClack, playFanfare } from '../../lib/sound';
import type { Particle, Vec as FxVec, Floater } from './fx';
import Icon from '../../ui/Icon';
import {
  TWO_PI,
  withAlpha,
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
  drawGlow,
  makeCachedLayer,
  fxRandom,
} from './fx';

// §12 Bowling — the sixth attraction mini-game. Swipe up the lane to roll (aim
// with the angle, power with the length; an angled shot hooks a little). Real
// ball↔pin↔pin physics knock the rack down, scored with standard 10-frame rules
// (strikes, spares, 10th-frame fill balls). Canvas, client-side, offline.

// —— Lane + physics (logical units; the canvas scales to fit) ————————————————
const W = 340;
const H = 560;
const LANE_L = 40;
const LANE_R = W - 40;
const BALL_R = 12;
const PIN_R = 9;
const HEAD_Y = 150; // head pin (nearest the bowler)
const PIN_GAP_X = 22;
const PIN_GAP_Y = 24;
const START = { x: W / 2, y: H - 40 };

const FIXED = 1000 / 120;
const BALL_FRICTION = 0.996;
const PIN_FRICTION = 0.93; // higher = pins slide farther, so they knock each other over more
const REST = 0.5; // collision restitution
const BALL_M = 6;
const PIN_M = 1;
const MIN_V = 4;
const MAX_V = 9;
const MAX_DRAG = 260;
const HOOK = 0.006; // lateral curve per step, in the aim's x direction
const DOWN_DIST = 6; // a pin moved this far from its spot is knocked down
const MAX_ROLL_MS = 2200; // hard stop for a roll's simulation
const SWEEP_MS = 950; // pause showing the fallen pins before the sweep clears them
const TURKEY_SWEEP_MS = 1900; // longer hold on a turkey so the bird gets its flight
const REST_SPEED = 0.5; // below this a ball/pin is parked so micro-jitter can't stall settle

type Pin = { x: number; y: number; vx: number; vy: number; ox: number; oy: number; down: boolean };
/** What the last roll earned, if anything — drives the banner, the shake and
 *  (for a turkey) the birds. Derived from the deck, not from the note text. */
type Celebration = 'strike' | 'spare' | 'turkey' | null;
type Ball = { x: number; y: number; vx: number; vy: number; gutter: boolean; rolling: boolean };
type Vel = { vx0: number; vy0: number; spin: number };

/** The 10-pin rack: 4 rows receding from the head pin. */
function makePins(): Pin[] {
  const pins: Pin[] = [];
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i <= r; i++) {
      const x = W / 2 + (i - r / 2) * PIN_GAP_X;
      const y = HEAD_Y - r * PIN_GAP_Y;
      pins.push({ x, y, vx: 0, vy: 0, ox: x, oy: y, down: false });
    }
  }
  return pins;
}

function launch(dx: number, dy: number): Vel | null {
  const len = Math.hypot(dx, dy);
  if (len < 10) return null;
  if (dy / len > -0.3) return null; // must be aimed up the lane
  const power = Math.min(len / MAX_DRAG, 1);
  const speed = MIN_V + power * (MAX_V - MIN_V);
  return { vx0: (dx / len) * speed, vy0: (dy / len) * speed, spin: Math.max(-1, Math.min(1, dx / MAX_DRAG)) };
}

/** Standard 10-frame scoring over a flat list of pinfalls. Missing future
 *  bonus balls count as 0 so the running total updates as you play. */
/**
 * Three strikes in a row — a "turkey". Frames 1–9 take one roll when struck and
 * two otherwise; the 10th allows up to three balls, so consecutive tens there
 * continue the run too. Reads the same flat roll list computeScore walks.
 */
export function hasTurkey(rolls: number[]): boolean {
  let run = 0;
  let i = 0;
  for (let frame = 0; frame < 9 && i < rolls.length; frame++) {
    if (rolls[i] === 10) {
      if (++run >= 3) return true;
      i += 1;
    } else {
      run = 0;
      i += 2;
    }
  }
  for (; i < rolls.length; i++) {
    if (rolls[i] === 10) {
      if (++run >= 3) return true;
    } else run = 0;
  }
  return false;
}

function computeScore(rolls: number[]): number {
  let score = 0;
  let i = 0;
  const at = (k: number) => rolls[k] ?? 0;
  for (let frame = 0; frame < 10 && i < rolls.length; frame++) {
    if (at(i) === 10) {
      score += 10 + at(i + 1) + at(i + 2);
      i += 1;
    } else if (at(i) + at(i + 1) === 10) {
      score += 10 + at(i + 2);
      i += 2;
    } else {
      score += at(i) + at(i + 1);
      i += 2;
    }
  }
  return score;
}

/** What to call a run of consecutive strikes. Three is the turkey; past that
 *  the alley names keep going, and anything long enough just gets counted. */
const RUN_NAMES: Record<number, string> = { 3: 'Turkey', 4: 'Four-bagger', 5: 'Five-bagger', 6: 'Six-pack' };
const runName = (n: number) => RUN_NAMES[n] ?? `${n} in a row`;

/** One frame's display on the scorecard: the ball marks (`X` `/` digit `-`) and
 *  the running total, which stays null until the frame's bonus balls exist. */
type FrameView = { balls: string[]; score: number | null };

const rollLabel = (pins: number) => (pins === 0 ? '-' : String(pins));

/** Turn the flat pinfall list into ten frames of marks + cumulative scores for
 *  the on-screen scorecard, mirroring computeScore's standard 10-frame rules. */
function frameViews(rolls: number[]): FrameView[] {
  const views: FrameView[] = [];
  const at = (k: number) => rolls[k] ?? 0;
  const has = (k: number) => k < rolls.length;
  let i = 0;
  let running = 0;
  for (let frame = 0; frame < 10; frame++) {
    if (frame < 9) {
      if (!has(i)) {
        views.push({ balls: [], score: null });
        continue;
      }
      if (at(i) === 10) {
        // Strike: scored once the next two balls (its bonus) have been thrown.
        let score: number | null = null;
        if (has(i + 1) && has(i + 2)) {
          running += 10 + at(i + 1) + at(i + 2);
          score = running;
        }
        views.push({ balls: ['X'], score });
        i += 1;
      } else if (has(i + 1)) {
        const spare = at(i) + at(i + 1) === 10;
        const balls = [rollLabel(at(i)), spare ? '/' : rollLabel(at(i + 1))];
        let score: number | null = null;
        if (spare) {
          if (has(i + 2)) {
            running += 10 + at(i + 2);
            score = running;
          }
        } else {
          running += at(i) + at(i + 1);
          score = running;
        }
        views.push({ balls, score });
        i += 2;
      } else {
        // Only the first ball of this frame has been thrown so far.
        views.push({ balls: [rollLabel(at(i))], score: null });
        i += 1;
      }
    } else {
      // 10th frame: up to three balls, with fresh racks after a strike/spare.
      const rest = rolls.slice(i);
      // A ball opens a fresh rack after a strike (reset) or after a spare closes
      // the previous rack — so a '/' only marks two balls that share a rack.
      const firstOfRack = (k: number) =>
        k === 0 ? true : k === 1 ? rest[0] === 10 : rest[1] === 10 || (rest[0] !== 10 && rest[0] + rest[1] === 10);
      const balls = rest.map((v, k) => {
        if (v === 10) return 'X';
        if (k > 0 && !firstOfRack(k) && rest[k - 1] !== 10 && rest[k - 1] + v === 10) return '/';
        return rollLabel(v);
      });
      const open = rest.length === 2 && rest[0] !== 10 && rest[0] + rest[1] !== 10;
      const complete = rest.length === 3 || open;
      const score = complete ? running + rest.reduce((a, b) => a + b, 0) : null;
      views.push({ balls, score });
    }
  }
  return views;
}

type Phase = 'aim' | 'rolling' | 'sweep' | 'done';
type Drag = { active: boolean; sx: number; sy: number; dx: number; dy: number };
type GS = {
  phase: Phase;
  pins: Pin[];
  ball: Ball;
  drag: Drag;
  rolls: number[]; // flat pinfalls across the game
  frame: number; // 0..9
  rollInFrame: number; // balls thrown in the current frame
  standing: number; // pins up at the start of the current ball
  rollStart: number;
  note: string;
  celebrate: Celebration; // what the settled roll earned (banner / fx / birds)
  strikeRun: number; // consecutive strikes, across frames — 3 is a turkey
  turkeys: number; // turkeys earned this game — one per completed three-in-a-row
  sweepAt: number; // when the current sweep pause began
  sweepMs: number; // how long this sweep pause runs (a turkey gets longer)
  lastClack: number; // throttle so a pile-up doesn't machine-gun the clack
  afterSweep: 'rack' | 'clear' | 'done'; // what the sweep resolves to
};

function freshBall(): Ball {
  return { x: START.x, y: START.y, vx: 0, vy: 0, gutter: false, rolling: false };
}

function freshGS(): GS {
  return {
    phase: 'aim',
    pins: makePins(),
    ball: freshBall(),
    drag: { active: false, sx: 0, sy: 0, dx: 0, dy: 0 },
    rolls: [],
    frame: 0,
    rollInFrame: 0,
    standing: 10,
    rollStart: 0,
    note: '',
    celebrate: null,
    strikeRun: 0,
    turkeys: 0,
    sweepAt: 0,
    sweepMs: SWEEP_MS,
    lastClack: -1e9,
    afterSweep: 'rack',
  };
}

const standingCount = (pins: Pin[]) => pins.reduce((n, p) => n + (p.down ? 0 : 1), 0);

/** One physics substep of a live roll. `now` is only used to throttle the
 *  collision clacks — the physics itself stays fixed-timestep. */
function step(gs: GS, now: number) {
  const ball = gs.ball;
  if (ball.rolling && !ball.gutter) {
    // Hook: a gentle lateral pull in the aim's x direction while moving.
    ball.vx += Math.sign(ball.vx) * HOOK * Math.min(Math.abs(ball.vx), 3);
  }
  ball.vx *= BALL_FRICTION;
  ball.vy *= BALL_FRICTION;
  ball.x += ball.vx;
  ball.y += ball.vy;
  // Once the ball has almost stopped (e.g. nestled among the pins) park it, so
  // it doesn't keep nudging the pins and stall the settle check.
  if (Math.hypot(ball.vx, ball.vy) < REST_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
  }

  // Gutters: once past the lane edge the ball drops in and can't hit pins.
  if (!ball.gutter) {
    if (ball.x < LANE_L + BALL_R) {
      ball.x = LANE_L + BALL_R - 2;
      ball.vx = 0;
      ball.gutter = true;
    } else if (ball.x > LANE_R - BALL_R) {
      ball.x = LANE_R - BALL_R + 2;
      ball.vx = 0;
      ball.gutter = true;
    }
  }

  // Pins: integrate + friction + keep on the lane.
  for (const p of gs.pins) {
    if (p.vx || p.vy) {
      p.vx *= PIN_FRICTION;
      p.vy *= PIN_FRICTION;
      p.x += p.vx;
      p.y += p.vy;
      p.x = Math.max(LANE_L + PIN_R, Math.min(LANE_R - PIN_R, p.x));
      if (Math.hypot(p.x - p.ox, p.y - p.oy) > DOWN_DIST) p.down = true;
      // Park a nearly-stopped pin so lingering micro-jitter doesn't stall settle.
      if (Math.hypot(p.vx, p.vy) < REST_SPEED) {
        p.vx = 0;
        p.vy = 0;
      }
    }
  }

  // Ball ↔ pin collisions (only pins still standing on the deck).
  let ballHit = 0;
  if (!ball.gutter) {
    for (const p of gs.pins) {
      ballHit = Math.max(ballHit, collide(ball, p, BALL_M, PIN_M));
    }
  }
  // Pin ↔ pin collisions.
  let pinHit = 0;
  for (let a = 0; a < gs.pins.length; a++) {
    for (let b = a + 1; b < gs.pins.length; b++) {
      pinHit = Math.max(pinHit, collide(gs.pins[a], gs.pins[b], PIN_M, PIN_M));
    }
  }
  // Voice the loudest impact this substep: a sharp clack for the ball striking
  // a pin, a lighter clatter for pins bouncing off each other.
  if (now - gs.lastClack > 55) {
    if (ballHit > 0.6) {
      gs.lastClack = now;
      playPinClack(Math.min(1.4, 0.4 + ballHit * 0.12));
    } else if (pinHit > 0.45) {
      gs.lastClack = now;
      playPinClack(Math.min(0.9, 0.25 + pinHit * 0.1));
    }
  }
}

/** Resolve a circle↔circle collision with mass + restitution. Returns the
 *  closing speed when a bounce was applied (0 otherwise) so the caller can
 *  voice the impact. */
function collide(
  a: { x: number; y: number; vx: number; vy: number },
  b: { x: number; y: number; vx: number; vy: number },
  ma: number,
  mb: number,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const min = ma === BALL_M || mb === BALL_M ? BALL_R + PIN_R : PIN_R * 2;
  if (dist >= min) return 0;
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
    return -rel;
  }
  return 0;
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the fixed-timestep sim is never touched; they're
// advanced per animation frame with a real dt and only ever paint pixels. Built
// on the shared ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent ball positions → rolling motion streak
  particles: Particle[]; // spark bursts on pin hits / strikes / spares
  shake: number; // camera shake magnitude (px), decays to 0
  flash: number; // strike/spare flash 0..1, decays to 0
  floaters: Floater[]; // rising "+N" pinfall popups
  turkeys: Turkey[]; // birds launched out of the pit on three-in-a-row
  downSeen: Map<Pin, boolean>; // pins already spark-flashed (so each falls once)
  prevPhase: Phase; // for edge-detecting the roll → sweep transition
};

/** A live bird: screen-space (px) ballistics, tumbling and flapping as it goes.
 *  Rendering-only, like everything else in FX — the sim never sees it. */
type Turkey = {
  x: number;
  y: number;
  vx: number; // px/s
  vy: number;
  rot: number; // rad
  spin: number; // rad/s
  flap: number; // wing phase (rad)
  life: number; // ms remaining
  max: number; // ms total (for the fade-out)
};

function freshFX(): FX {
  return { trail: [], particles: [], shake: 0, flash: 0, floaters: [], turkeys: [], downSeen: new Map(), prevPhase: 'aim' };
}

const PURPLE_LIGHT = '#e9d5ff';
const PURPLE = '#a855f7';
const PURPLE_DEEP = '#6b21a8';
// The bird runs warm on purpose: a turkey has to read as a turkey, and nothing
// else on this lane is orange.
const FEATHER = '#f59e0b';
const TAIL_FEATHERS = ['#f59e0b', '#ef4444', '#f97316', '#fbbf24', '#f97316', '#ef4444', '#f59e0b'];

const TURKEY_LIFE = 2400; // ms of flight before a bird fades out
const TURKEY_GRAVITY = 420; // px/s² — arcs over the rack, then down the lane inside the sweep
const MAX_TURKEYS = 6; // a bird per strike in the run, capped

/** Launch `n` birds out of the pit behind the rack. They pop up over the deck,
 *  then gravity brings them down the lane toward the bowler — growing as they
 *  come, which is what sells "thrown at you" under this projection. */
function spawnTurkeys(fx: FX, n: number) {
  const deck = project(W / 2, HEAD_Y);
  for (let i = 0; i < n; i++) {
    // Fan them across the deck but keep them flying down the lane, not out of
    // frame — the point is that they come at the bowler.
    const spread = (n === 1 ? 0 : (i / (n - 1)) * 2 - 1) * (0.6 + fxRandom() * 0.4);
    fx.turkeys.push({
      x: W / 2 + spread * 42,
      y: deck.y - 8,
      vx: spread * 46,
      vy: -(175 + fxRandom() * 45),
      rot: -spread * 0.3,
      spin: (spread >= 0 ? 1 : -1) * (0.7 + fxRandom() * 1.1),
      flap: fxRandom() * TWO_PI,
      life: TURKEY_LIFE,
      max: TURKEY_LIFE,
    });
  }
}

/** How big a bird draws at screen height `y`: small up by the pit, large down
 *  by the bowler — matching the lane's own perspective without projecting it
 *  (the birds are off the lane surface, so project() doesn't apply). */
const turkeyScale = (y: number) => 0.55 + Math.max(0, Math.min(1, (y - HORIZON) / (H - HORIZON))) * 1.3;

/** Advance the birds by `dt` ms and return the ones still in flight. Molting a
 *  feather now and then is what ties them to the rest of the particle work. */
function stepTurkeys(list: Turkey[], particles: Particle[], dt: number): Turkey[] {
  const dts = dt / 1000;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    t.x += t.vx * dts;
    t.y += t.vy * dts;
    t.vy += TURKEY_GRAVITY * dts;
    t.rot += t.spin * dts;
    t.flap += dts * 15;
    t.life -= dt;
    if (fxRandom() < dt / 130) {
      spawnBurst(particles, t.x, t.y, 1, 26, TAIL_FEATHERS[i % TAIL_FEATHERS.length]);
    }
  }
  return list.filter((t) => t.life > 0 && t.y < H + 80);
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). Reads gs but
 *  never mutates it — every event it reacts to (pin down, strike, spare) has
 *  already happened in the sim. */
function updateFX(fx: FX, gs: GS, dt: number) {
  // Rolling ball leaves a fading streak; other phases clear it.
  if (gs.phase === 'rolling') pushTrail(fx.trail, gs.ball.x, gs.ball.y, 14);
  else fx.trail.length = 0;

  // A pin that just went down throws a little purple spark burst, once.
  for (const p of gs.pins) {
    if (p.down && !fx.downSeen.has(p)) {
      fx.downSeen.set(p, true);
      const q = projectPin(p.x, p.y);
      spawnBurst(fx.particles, q.x, q.y, 6, 50 + 90 * q.s, PURPLE_LIGHT);
    }
  }

  // On the roll → sweep edge, celebrate what the roll earned: a turkey throws
  // birds, a strike is big, a spare is small.
  if (fx.prevPhase !== 'sweep' && gs.phase === 'sweep') {
    const { x: cx, y: cy } = project(W / 2, HEAD_Y - PIN_GAP_Y * 1.5);
    if (gs.celebrate === 'turkey') {
      fx.shake = 11;
      fx.flash = 1;
      spawnBurst(fx.particles, cx, cy, 34, 320, PURPLE_LIGHT);
      spawnBurst(fx.particles, cx, cy, 24, 280, FEATHER);
      spawnTurkeys(fx, Math.min(MAX_TURKEYS, gs.strikeRun));
    } else if (gs.celebrate === 'strike') {
      fx.shake = 8;
      fx.flash = 1;
      spawnBurst(fx.particles, cx, cy, 34, 320, PURPLE_LIGHT);
      spawnBurst(fx.particles, cx, cy, 18, 180, '#f0abfc');
    } else if (gs.celebrate === 'spare') {
      fx.shake = 4;
      fx.flash = 0.6;
      spawnBurst(fx.particles, cx, cy, 20, 240, PURPLE);
    }
  }
  fx.prevPhase = gs.phase;

  fx.turkeys = stepTurkeys(fx.turkeys, fx.particles, dt);
  fx.particles = stepParticles(fx.particles, dt, 0.02, 40);
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
// —— POV projection ——
// The sim stays top-down (x across the lane, y down it); only the renderer
// looks down the lane from behind the bowler. project() maps a sim point on
// the lane surface to screen space: things farther up the lane (smaller sim y)
// shrink toward the vanishing point and rise toward the horizon.
const CAM_D = 140; // camera distance behind the near lane edge; bigger = flatter
const HORIZON = 56; // screen y the lane converges toward
const NEAR_Y = H - 4; // screen y of the nearest lane edge (sim y = H)
const PIN_VIEW = 2.5; // stylized pin size boost so the rack reads at distance
type Proj = { x: number; y: number; s: number };
function project(x: number, y: number): Proj {
  const s = CAM_D / (CAM_D + (H - y));
  return { x: W / 2 + (x - W / 2) * s, y: HORIZON + (NEAR_Y - HORIZON) * s, s };
}

// Display-only: exaggerate the rack's depth around the head pin so the back
// rows peek out from behind the front ones instead of clumping — the physics
// spacing is untouched.
const RACK_SPREAD = 1.6;
const projectPin = (x: number, y: number) => project(x, HEAD_Y + (y - HEAD_Y) * RACK_SPREAD);

/** Paint the pin profile at the current transform — head pointing +x, base at
 *  -1.48R. Real-pin proportions: 15" tall vs 4.75" max diameter (≈3.2:1), flat
 *  base, belly max at 0, neck waist at +1.8R, head centered at +2.8R. Shared by
 *  the upright and fallen renderers. */
function drawPinShape(ctx: CanvasRenderingContext2D) {
  const R = PIN_R;
  const g = ctx.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, '#f6f8fb');
  g.addColorStop(0.55, '#dfe6ef');
  g.addColorStop(1, '#a9b3c3');
  ctx.fillStyle = g;

  ctx.beginPath();
  ctx.moveTo(-R * 1.48, -R * 0.33);
  ctx.bezierCurveTo(-R * 1.15, -R * 0.72, -R * 0.55, -R * 0.78, 0, -R * 0.78);
  ctx.bezierCurveTo(R * 0.85, -R * 0.78, R * 1.3, -R * 0.42, R * 1.8, -R * 0.3);
  ctx.bezierCurveTo(R * 2.1, -R * 0.24, R * 2.3, -R * 0.3, R * 2.45, -R * 0.36);
  ctx.arc(R * 2.8, 0, R * 0.42, -Math.PI * 0.72, Math.PI * 0.72);
  ctx.bezierCurveTo(R * 2.3, R * 0.3, R * 2.1, R * 0.24, R * 1.8, R * 0.3);
  ctx.bezierCurveTo(R * 1.3, R * 0.42, R * 0.85, R * 0.78, 0, R * 0.78);
  ctx.bezierCurveTo(-R * 0.55, R * 0.78, -R * 1.15, R * 0.72, -R * 1.48, R * 0.33);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(105,115,135,0.45)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // The two stripes just below the neck waist.
  ctx.fillStyle = withAlpha(PURPLE, 0.9);
  ctx.fillRect(R * 1.42, -R * 0.34, R * 0.17, R * 0.68);
  ctx.fillRect(R * 1.7, -R * 0.31, R * 0.15, R * 0.62);

  // Thin highlight along the upper belly so it reads as glossy ivory.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-R * 1.0, -R * 0.55);
  ctx.quadraticCurveTo(-R * 0.1, -R * 0.68, R * 0.7, -R * 0.45);
  ctx.stroke();
}

/** A standing pin seen from behind the bowler: upright, base on the lane. */
function drawStandingPin(ctx: CanvasRenderingContext2D, p: Pin) {
  const q = projectPin(p.x, p.y);
  const sc = q.s * PIN_VIEW;
  drawShadow(ctx, q.x, q.y + 1.5, PIN_R * 1.1 * sc, PIN_R * 0.36 * sc, 0.3);
  ctx.save();
  ctx.translate(q.x, q.y);
  ctx.scale(sc, sc);
  ctx.rotate(-Math.PI / 2);
  ctx.translate(PIN_R * 1.48, 0); // put the flat base on the lane point
  drawPinShape(ctx);
  ctx.restore();
}

/** A fallen pin lying flat on the lane, foreshortened by the ground plane and
 *  pointing head-first along its topple direction. */
function drawFallenPin(ctx: CanvasRenderingContext2D, p: Pin) {
  const q = projectPin(p.x, p.y);
  const sc = q.s * PIN_VIEW;
  drawShadow(ctx, q.x + 1.5, q.y + 1.5, PIN_R * 2.1 * sc, PIN_R * 0.45 * sc, 0.18);
  ctx.save();
  ctx.translate(q.x, q.y);
  ctx.scale(sc, sc * 0.62); // squash before rotating: the pin lies on the lane
  ctx.rotate(Math.atan2(p.y - p.oy, p.x - p.ox) || 0);
  drawPinShape(ctx);
  ctx.restore();
}

/** The bird, centered on the origin, facing +x, at unit scale (1 ≈ a 14px
 *  body radius). `flap` is -1..1 and swings the near wing. Drawn rather than
 *  emoji'd so it lights, scales and molts like everything else on this lane. */
function drawTurkeyShape(ctx: CanvasRenderingContext2D, flap: number) {
  const R = 14;

  // Tail fan, behind everything: seven feathers sweeping back off the body.
  for (let i = 0; i < TAIL_FEATHERS.length; i++) {
    const t = i / (TAIL_FEATHERS.length - 1);
    ctx.save();
    ctx.rotate(Math.PI * (0.72 + t * 0.56));
    ctx.translate(R * 1.2, 0);
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.95, R * 0.33, 0, 0, TWO_PI);
    ctx.fillStyle = TAIL_FEATHERS[i];
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,26,10,0.5)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();
  }

  // Legs, tucked back mid-flight.
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = R * 0.19;
  ctx.lineCap = 'round';
  for (const dy of [-R * 0.16, R * 0.22]) {
    ctx.beginPath();
    ctx.moveTo(R * 0.3, R * 0.5 + dy * 0.3);
    ctx.lineTo(R * 0.86, R * 0.98 + dy);
    ctx.lineTo(R * 1.14, R * 0.8 + dy);
    ctx.stroke();
  }

  // Body.
  const body = ctx.createLinearGradient(0, -R * 0.8, 0, R * 0.8);
  body.addColorStop(0, '#a9662f');
  body.addColorStop(0.6, '#7c4a21');
  body.addColorStop(1, '#5a3417');
  ctx.strokeStyle = 'rgba(40,18,6,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 0.98, R * 0.8, 0, 0, TWO_PI);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.stroke();

  // Neck + head, craned up and forward off the shoulder.
  ctx.beginPath();
  ctx.moveTo(R * 0.3, -R * 0.5);
  ctx.quadraticCurveTo(R * 0.72, -R * 0.62, R * 0.86, -R * 1.05);
  ctx.lineTo(R * 0.38, -R * 0.95);
  ctx.quadraticCurveTo(R * 0.34, -R * 0.7, R * 0.12, -R * 0.6);
  ctx.closePath();
  ctx.fillStyle = '#7a4620';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(R * 0.92, -R * 1.15, R * 0.46, 0, TWO_PI);
  ctx.fillStyle = '#93582b';
  ctx.fill();
  ctx.stroke();

  // Beak, wattle, eye.
  ctx.beginPath();
  ctx.moveTo(R * 1.26, -R * 1.26);
  ctx.lineTo(R * 1.82, -R * 1.1);
  ctx.lineTo(R * 1.26, -R * 0.98);
  ctx.closePath();
  ctx.fillStyle = '#fbbf24';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(R * 1.24, -R * 1.06);
  ctx.quadraticCurveTo(R * 1.56, -R * 0.62, R * 1.1, -R * 0.72);
  ctx.closePath();
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(R * 0.98, -R * 1.3, R * 0.12, 0, TWO_PI);
  ctx.fillStyle = '#1b1020';
  ctx.fill();

  // Near wing, beating over the body — pivoted at the shoulder so the flap
  // swings the tip, and paler than the body so it doesn't read as one blob.
  ctx.save();
  ctx.translate(R * 0.32, -R * 0.28);
  ctx.rotate(0.35 + flap * 0.75);
  const wing = ctx.createLinearGradient(0, -R * 0.3, 0, R * 0.3);
  wing.addColorStop(0, '#e0a865');
  wing.addColorStop(1, '#a9662f');
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.12);
  ctx.quadraticCurveTo(-R * 0.55, -R * 0.5, -R * 1.15, -R * 0.12);
  ctx.quadraticCurveTo(-R * 0.6, R * 0.34, 0, R * 0.16);
  ctx.closePath();
  ctx.fillStyle = wing;
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,18,6,0.5)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  // Two flight-feather seams so the wing reads as feathered at size.
  ctx.strokeStyle = 'rgba(70,32,10,0.35)';
  ctx.lineWidth = 0.9;
  for (const k of [0.45, 0.72]) {
    ctx.beginPath();
    ctx.moveTo(-R * k, -R * 0.3);
    ctx.lineTo(-R * (k - 0.06), R * 0.16);
    ctx.stroke();
  }
  ctx.restore();
}

/** Paint the birds in flight: lit from behind so they carry the lane's glow,
 *  fading out over the last stretch of their life. */
function drawTurkeys(ctx: CanvasRenderingContext2D, list: Turkey[]) {
  for (const t of list) {
    const sc = turkeyScale(t.y);
    const fade = Math.min(1, t.life / 320);
    drawGlow(ctx, t.x, t.y, 34 * sc, PURPLE_LIGHT, 0.16 * fade);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(t.x, t.y);
    ctx.scale(sc, sc);
    ctx.rotate(t.rot);
    drawTurkeyShape(ctx, Math.sin(t.flap));
    ctx.restore();
  }
}

/** View-scale for the ball: ×1 in the hand, boosted with distance so it stays
 *  in proportion to the (boosted) pins at the deck. */
const ballView = (s: number) => 1 + (1 - s) * 1.35;

/** The glossy bowling ball, shrinking as it rolls away from the bowler. */
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const q = project(x, y);
  const r = Math.max(3, BALL_R * q.s * ballView(q.s));
  drawShadow(ctx, q.x, q.y + r * 0.3, r * 0.95, r * 0.4, 0.35);
  drawSphere(ctx, q.x, q.y - r * 0.45, r, PURPLE_LIGHT, PURPLE, PURPLE_DEEP, { rim: true });
}

// —— Cached static layer ——
// The whole alley — back wall, pit, gutters, lane, boards, arrows, foul line,
// vignette — is fixed geometry projected through a pure function, so it is
// pixel-identical on every frame. Built once and blitted (see fx.makeLayer),
// which is what pays for the oil sheen and the deck lighting below.
function paintAlley(ctx: CanvasRenderingContext2D) {
  const nearL = project(LANE_L, H);
  const nearR = project(LANE_R, H);
  const farL = project(LANE_L, 0);
  const farR = project(LANE_R, 0);
  const deck = project(W / 2, HEAD_Y);

  // —— Back wall of the alley, falling away into darkness above the horizon ——
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b0a16');
  bg.addColorStop(0.3, '#1a1330');
  bg.addColorStop(0.55, '#121026');
  bg.addColorStop(1, '#0b0a16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Pin-deck glow radiating from behind the rack.
  const sheen = ctx.createRadialGradient(W / 2, deck.y - 14, 8, W / 2, deck.y - 14, H * 0.42);
  sheen.addColorStop(0, withAlpha(PURPLE, 0.2));
  sheen.addColorStop(1, withAlpha(PURPLE, 0));
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  // Pit + pinsetter: a near-black band with a neon edge above the deck.
  ctx.fillStyle = '#07060d';
  ctx.fillRect(farL.x - 16, farL.y - 30, farR.x - farL.x + 32, 30);
  neonLine(ctx, farL.x - 16, farL.y - 30, farR.x + 16, farL.y - 30, PURPLE, 2, 10);
  // House mark on the masking unit — the branded panel above the pin deck on a
  // real lane. The band is only ~84px wide at this projection depth, so the
  // wordmark runs at 76px: below its usual floor, but it's the far end of the
  // alley, where "small and glowing" is exactly how the real thing reads.
  drawLogo(ctx, W / 2, farL.y - 16, { variant: 'wordmark', width: 76, tint: PURPLE, alpha: 0.8 });

  // —— Gutters: converging recessed channels either side of the lane ——
  const gut = ctx.createLinearGradient(0, farL.y, 0, nearL.y);
  gut.addColorStop(0, '#0a0813');
  gut.addColorStop(1, '#141021');
  ctx.fillStyle = gut;
  for (const [x0, x1] of [
    [10, LANE_L],
    [LANE_R, W - 10],
  ] as const) {
    const a = project(x0, H);
    const b = project(x1, H);
    const c = project(x1, 0);
    const d = project(x0, 0);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }

  // —— Lane: polished boards converging on the pin deck ——
  ctx.beginPath();
  ctx.moveTo(nearL.x, nearL.y);
  ctx.lineTo(nearR.x, nearR.y);
  ctx.lineTo(farR.x, farR.y);
  ctx.lineTo(farL.x, farL.y);
  ctx.closePath();
  const wood = ctx.createLinearGradient(0, farL.y, 0, nearL.y);
  wood.addColorStop(0, '#3d3020');
  wood.addColorStop(0.45, '#5a4526');
  wood.addColorStop(1, '#6b5330');
  ctx.fillStyle = wood;
  ctx.fill();
  // Board-to-board tonal variation. A lane is forty-odd individual maple boards
  // and no two are quite the same shade — that variation, not more grain lines,
  // is what stops evenly ruled seams from reading as graph paper. Index-derived
  // so the lane is identical on every rebuild.
  for (let i = 0, x = LANE_L; x < LANE_R; i++, x += 20) {
    const x1 = Math.min(x + 20, LANE_R);
    const a = project(x, H);
    const b = project(x1, H);
    const c = project(x1, 0);
    const d = project(x, 0);
    const t = ((i * 53) % 7) / 7; // stable per board
    ctx.fillStyle =
      i % 3 === 0 ? `rgba(255,226,170,${0.03 + t * 0.05})` : `rgba(52,34,12,${0.03 + t * 0.06})`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }
  // Lengthwise gloss pooling down the middle boards.
  const gloss = ctx.createLinearGradient(nearL.x, 0, nearR.x, 0);
  gloss.addColorStop(0, 'rgba(0,0,0,0.25)');
  gloss.addColorStop(0.5, 'rgba(255,236,190,0.10)');
  gloss.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = gloss;
  ctx.fill();
  // Boards converging toward the vanishing point.
  ctx.strokeStyle = 'rgba(0,0,0,0.20)';
  ctx.lineWidth = 1;
  for (let x = LANE_L + 20; x < LANE_R; x += 20) {
    const a = project(x, H);
    const b = project(x, 0);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // Faint cross-seams for a sense of distance down the lane.
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  for (let y = 120; y < H - 60; y += 90) {
    const a = project(LANE_L, y);
    const b = project(LANE_R, y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // —— Aiming arrows: the classic lane guide, glowing in the theme color ——
  ctx.save();
  ctx.fillStyle = withAlpha(PURPLE, 0.5);
  ctx.shadowColor = withAlpha(PURPLE, 0.7);
  ctx.shadowBlur = 6;
  for (let i = -2; i <= 2; i++) {
    const q = project(W / 2 + i * 26, HEAD_Y + 150 + Math.abs(i) * 14);
    const sz = 5 * q.s + 2;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - sz * 1.6);
    ctx.lineTo(q.x - sz * 0.55, q.y);
    ctx.lineTo(q.x + sz * 0.55, q.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // —— Foul line: a glowing neon accent across the approach ——
  const foulL = project(LANE_L, H - 70);
  const foulR = project(LANE_R, H - 70);
  neonLine(ctx, foulL.x, foulL.y, foulR.x, foulR.y, PURPLE, 3, 12);

  // —— Vignette for depth ——
  const vig = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.28, W / 2, H * 0.5, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

const alleyLayer = makeCachedLayer(W, H, paintAlley);

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX) {
  ctx.clearRect(0, 0, W, H);

  // Keyed on the masking-unit mark so the alley rebuilds once it decodes; a null
  // layer means no DOM / no 2D context, so paint the frame directly.
  const alley = alleyLayer(logoReady('wordmark'));
  if (alley) ctx.drawImage(alley, 0, 0, W, H);
  else paintAlley(ctx);

  const deck = project(W / 2, HEAD_Y);

  // Lane oil. A dressed lane is wet down the middle and dry at the edges, and
  // the head of it mirrors the pin-deck lighting back at the bowler. Static —
  // a dressing pattern is a property of the surface, not an animation.
  const oilY = deck.y + 115;
  const oil = ctx.createRadialGradient(W / 2, oilY, 6, W / 2, oilY, 130);
  oil.addColorStop(0, withAlpha(PURPLE_LIGHT, 0.09));
  oil.addColorStop(0.5, withAlpha(PURPLE, 0.04));
  oil.addColorStop(1, withAlpha(PURPLE, 0));
  ctx.fillStyle = oil;
  ctx.fillRect(0, deck.y, W, H - deck.y);

  // The pin deck flares when the rack goes over; it is dark otherwise.
  if (fx.flash > 0.02) drawGlow(ctx, W / 2, deck.y - 10, 90, PURPLE_LIGHT, fx.flash * 0.55);

  // —— Dynamic layer (shaken on strikes/spares) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Rolling ball motion streak, tapering behind the ball.
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    const q = project(t.x, t.y);
    const br = BALL_R * q.s * ballView(q.s);
    ctx.beginPath();
    ctx.arc(q.x, q.y - br * 0.5, br * (0.3 + k * 0.6), 0, TWO_PI);
    ctx.fillStyle = withAlpha(PURPLE, 0.04 + k * 0.14);
    ctx.fill();
  }

  // Every lane object — fallen pins included — draws far-to-near in one pass,
  // so a pin that slid toward the bowler isn't painted under a farther
  // standing pin or the ball. Sort on projected screen y, since pins project
  // through the rack's display-only depth spread and the ball doesn't.
  const items: Array<{ sy: number; d: () => void }> = gs.pins.map((p) => ({
    sy: projectPin(p.x, p.y).y,
    d: p.down ? () => drawFallenPin(ctx, p) : () => drawStandingPin(ctx, p),
  }));
  items.push({ sy: project(gs.ball.x, gs.ball.y).y, d: () => drawBall(ctx, gs.ball.x, gs.ball.y) });
  items.sort((a, b) => a.sy - b.sy);
  for (const it of items) it.d();

  // Aim guide (glowing), converging up the lane with the perspective.
  if (gs.phase === 'aim' && gs.drag.active) {
    const v = launch(gs.drag.dx, gs.drag.dy);
    if (v) {
      const len = 150;
      const sp = Math.hypot(v.vx0, v.vy0);
      const from = project(START.x, START.y);
      const to = project(START.x + (v.vx0 / sp) * len, START.y + (v.vy0 / sp) * len);
      ctx.save();
      ctx.strokeStyle = withAlpha('#38bdf8', 0.85);
      ctx.shadowColor = withAlpha('#38bdf8', 0.8);
      ctx.shadowBlur = 10;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y - 6);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
  // Birds last of the shaken layer: they fly in front of the rack, over the pit.
  drawTurkeys(ctx, fx.turkeys);
  ctx.restore();

  // —— On-canvas TURKEY! / STRIKE! / SPARE! banner, softly lit ——
  if (gs.phase === 'sweep' && gs.celebrate) {
    const turkey = gs.celebrate === 'turkey';
    const label = turkey ? `${runName(gs.strikeRun).toUpperCase()}!` : gs.celebrate === 'strike' ? 'STRIKE!' : 'SPARE!';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Long run names ("8 IN A ROW!") have to fit the 340px lane.
    ctx.font = `bold ${label.length > 9 ? 26 : 34}px system-ui, sans-serif`;
    ctx.fillStyle = turkey ? '#fff3d6' : gs.celebrate === 'strike' ? '#f5e9ff' : '#ede9fe';
    ctx.shadowColor = withAlpha(turkey ? FEATHER : PURPLE, 0.95);
    ctx.shadowBlur = 18;
    ctx.fillText(label, W / 2, 330);
    ctx.restore();
  }

  // Cabinet finish, last of all: scanlines + a tube vignette over the
  // finished frame. The bezel and bloom around the screen are CSS
}

/** The classic ten-frame score strip: ball marks up top, cumulative score
 *  below, the active frame lit. Scrolls sideways if the row can't fit. */
function Scorecard({ rolls, activeFrame }: { rolls: number[]; activeFrame: number | null }) {
  const views = frameViews(rolls);
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-full gap-px rounded-lg border border-fairway-800 bg-fairway-800 text-center">
        {views.map((v, f) => {
          const active = f === activeFrame;
          const tenth = f === 9;
          return (
            <div
              key={f}
              className={`flex flex-1 flex-col ${tenth ? 'min-w-[42px]' : 'min-w-[28px]'} ${
                active ? 'bg-fairway-700' : 'bg-fairway-900'
              }`}
            >
              <div className="text-[9px] leading-tight text-fairway-500">{f + 1}</div>
              <div className="flex h-4 items-center justify-center gap-0.5 text-[11px] font-bold leading-none text-fairway-50">
                {v.balls.length ? v.balls.map((b, k) => <span key={k}>{b}</span>) : <span>&nbsp;</span>}
              </div>
              <div className="border-t border-fairway-800 text-[11px] font-semibold leading-tight text-fairway-200">
                {v.score ?? <span>&nbsp;</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Bowling() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('aim');
  const [score, setScore] = useState(0);
  const [frame, setFrame] = useState(0);
  const [note, setNote] = useState('');
  const [turkeys, setTurkeys] = useState(0);
  const [rolls, setRolls] = useState<number[]>([]);
  // One id per played round — the ticket award's idempotency key.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const playing = phase !== 'done';
  useFitCanvas(canvasRef, W, H, playing);

  /** Advance frame/deck state after a roll settles. */
  // A roll has stopped: score it and decide what happens next, but DEFER the
  // deck change — the fallen pins stay on screen through a sweep pause first.
  const settleRoll = useCallback(() => {
    const gs = gsRef.current;
    const after = standingCount(gs.pins);
    const pinfall = gs.standing - after;
    const tenthFrame = gs.frame === 9;
    gs.rolls.push(pinfall);
    setScore(computeScore(gs.rolls));
    setRolls([...gs.rolls]);

    // What the ball earned, read off the deck rather than off the note text: a
    // cleared full rack is a strike, a cleared remainder is a spare. Three
    // strikes back to back — across frames, and through the 10th's fresh racks
    // — is a turkey, which is the one that gets birds thrown on screen.
    const struck = gs.standing === 10 && after === 0;
    gs.strikeRun = struck ? gs.strikeRun + 1 : 0;
    let celebrate: Celebration = after === 0 ? (struck ? 'strike' : 'spare') : null;
    if (struck && gs.strikeRun >= 3) celebrate = 'turkey';

    // Every strike in a live run keeps throwing birds, but the tally counts
    // whole turkeys — twelve straight is four turkeys, not ten.
    if (celebrate === 'turkey' && gs.strikeRun % 3 === 0) gs.turkeys += 1;
    if (celebrate === 'turkey') playFanfare(); // a turkey outranks the deck-clear chime
    else if (after === 0) playCup(); // cleared the deck (strike / spare / clean-up)
    else if (pinfall === 0) playUndo(); // whiff or gutter

    // 'rack' = fresh ten after the sweep; 'clear' = sweep the downed pins and
    // leave the standing ones for the next ball; 'done' = game over.
    let afterSweep: 'rack' | 'clear' | 'done' = 'rack';
    let note = '';
    const endFrame = (label: string) => {
      gs.frame += 1;
      gs.rollInFrame = 0;
      setFrame(gs.frame);
      afterSweep = 'rack';
      note = label;
    };

    if (gs.frame < 9) {
      if (gs.rollInFrame === 0) {
        if (pinfall === 10) {
          endFrame('Strike! 🎳');
        } else {
          gs.rollInFrame = 1;
          afterSweep = 'clear';
          note = pinfall === 0 ? 'Gutter — one more ball.' : `${pinfall} down — one more.`;
        }
      } else {
        const first = gs.rolls[gs.rolls.length - 2] ?? 0;
        endFrame(first + pinfall === 10 ? 'Spare! ✅' : 'Nice frame.');
      }
    } else {
      // 10th frame: up to three balls, racking a fresh deck whenever it clears.
      gs.rollInFrame += 1;
      const tenth = gs.rolls.slice(gs.rolls.length - gs.rollInFrame);
      const b1 = tenth[0] ?? 0;
      const b2 = tenth[1] ?? 0;
      if (gs.rollInFrame === 1) {
        afterSweep = pinfall === 10 ? 'rack' : 'clear';
        note = pinfall === 10 ? 'Strike! One more.' : `${pinfall} down — one more.`;
      } else if (gs.rollInFrame === 2) {
        const thirdBall = b1 === 10 || b1 + b2 === 10;
        if (thirdBall) {
          afterSweep = after === 0 ? 'rack' : 'clear';
          note = 'Bonus ball!';
        } else {
          afterSweep = 'done';
          note = '';
        }
      } else {
        afterSweep = 'done';
        note = '';
      }
    }

    // A turkey renames the roll — the bird is the headline, and in the 10th the
    // "one more" hint still has to survive it.
    if (celebrate === 'turkey') {
      note = `${runName(gs.strikeRun)}! 🦃${tenthFrame && afterSweep !== 'done' ? ' One more.' : ''}`;
    }

    // The banner covers a celebrated roll; pop the pinfall for the rest —
    // including 10th-frame bonus clears, which set no banner note.
    if (!celebrate) {
      spawnFloater(fxRef.current.floaters, W / 2, project(W / 2, HEAD_Y).y + 44, pinfall > 0 ? `+${pinfall}` : 'MISS', pinfall > 0 ? '#d8b4fe' : '#94a3b8', { size: 22, life: 800 });
    }

    gs.afterSweep = afterSweep;
    gs.note = note;
    gs.celebrate = celebrate;
    setNote(note);
    setTurkeys(gs.turkeys);
    gs.phase = 'sweep';
    gs.sweepAt = performance.now();
    gs.sweepMs = celebrate === 'turkey' ? TURKEY_SWEEP_MS : SWEEP_MS;
  }, []);

  // The sweep pause elapsed: clear the downed pins (or rack a fresh ten) and
  // hand the next ball to the player.
  const applySweep = useCallback(() => {
    const gs = gsRef.current;
    gs.celebrate = null;
    if (gs.afterSweep === 'done') {
      gs.phase = 'done';
      setPhase('done');
      playFanfare();
      return;
    }
    if (gs.afterSweep === 'rack') {
      gs.pins = makePins();
      gs.standing = 10;
    } else {
      gs.pins = gs.pins.filter((p) => !p.down); // sweep the fallen pins away
      gs.standing = gs.pins.length;
    }
    gs.ball = freshBall();
    gs.phase = 'aim';
    setPhase('aim');
  }, []);

  useEffect(() => {
    if (!playing) return;
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
    // never run. Shift the roll/sweep deadlines by the away span on resume so a
    // roll backgrounded past MAX_ROLL_MS isn't settled (as a gutter) on return.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const gap = performance.now() - hiddenAt;
        const gs = gsRef.current;
        gs.rollStart += gap;
        gs.sweepAt += gap;
        hiddenAt = 0;
        last = performance.now();
        acc = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const frameLoop = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(frameLoop);
        return;
      }
      const dt = Math.min(now - last, 100);
      acc += dt;
      last = now;

      while (acc >= FIXED) {
        if (gs.phase === 'rolling') step(gs, now);
        acc -= FIXED;
      }

      if (gs.phase === 'rolling') {
        const ballSpeed = Math.hypot(gs.ball.vx, gs.ball.vy);
        const pinsMoving = gs.pins.some((p) => Math.abs(p.vx) + Math.abs(p.vy) > 0.05);
        const ballDone = gs.ball.y < -20 || ballSpeed < 0.06;
        // Wait for the pins to finish toppling even after the ball leaves, so a
        // fast strike isn't scored before the chain reaction completes.
        if ((ballDone && !pinsMoving) || now - gs.rollStart > MAX_ROLL_MS) {
          settleRoll();
        }
      } else if (gs.phase === 'sweep' && now - gs.sweepAt > gs.sweepMs) {
        applySweep();
      }

      updateFX(fxRef.current, gs, dt);
      draw(ctx, gs, fxRef.current);
      raf = requestAnimationFrame(frameLoop);
    };
    raf = requestAnimationFrame(frameLoop);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [playing, settleRoll, applySweep]);

  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (gs.phase !== 'aim') return;
      const p = toField(e);
      gs.drag = { active: true, sx: p.x, sy: p.y, dx: 0, dy: 0 };
      canvasRef.current?.setPointerCapture(e.pointerId);
    },
    [toField],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (!gs.drag.active) return;
      const p = toField(e);
      gs.drag.dx = p.x - gs.drag.sx;
      gs.drag.dy = p.y - gs.drag.sy;
    },
    [toField],
  );
  const onPointerUp = useCallback(() => {
    const gs = gsRef.current;
    if (!gs.drag.active) return;
    gs.drag.active = false;
    const v = launch(gs.drag.dx, gs.drag.dy);
    if (!v) return;
    gs.ball.vx = v.vx0;
    gs.ball.vy = v.vy0;
    gs.ball.rolling = true;
    gs.phase = 'rolling';
    gs.rollStart = performance.now();
    setPhase('rolling');
    setNote('');
    // Rendering-only: a little release puff at the foul line.
    const q = project(gs.ball.x, gs.ball.y);
    spawnBurst(fxRef.current.particles, q.x, q.y, 10, 140, PURPLE_LIGHT);
    playStroke();
  }, []);

  const restart = useCallback(() => {
    gsRef.current = freshGS();
    fxRef.current = freshFX();
    setScore(0);
    setFrame(0);
    setNote('');
    setRolls([]);
    setTurkeys(0);
    setPhase('aim');
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    // Now that a turkey throws a bird on screen, only claim one when it happened.
    const remark = score === 300
      ? 'Perfect game! 🎳🔥'
      : turkeys
        ? turkeys === 1
          ? 'Turkey! 🦃'
          : `${turkeys} turkeys! 🦃`
        : score >= 180
          ? 'Red hot! 🔥'
          : score >= 120
            ? 'Great game! 🎳'
            : score >= 80
              ? 'Nice rolling! 👍'
              : 'Keep bowling! 🎮';
    return (
      <Screen>
        <TopBar title="Bowling" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <Icon name="game.bowling" className="text-6xl" />
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">final score · 10 frames</p>
          </div>
          <div className="mt-6">
            <Scorecard rolls={rolls} activeFrame={null} />
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (1 ticket per 3 points — a perfect 300 pays 100). */}
          <GameAwards
            game="bowling"
            tickets={Math.round(score / 3)}
            sessionId={sessionId}
            feat={hasTurkey(rolls) ? 'turkey' : undefined}
          />
          <GameHighScore game="bowling" score={score} sessionId={sessionId} />
          <div className="mt-8">
            <Button onClick={restart} sound="none">
              Play again
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Bowling" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Frame <span className="text-fairway-100">{Math.min(frame + 1, 10)}</span>
          <span className="font-normal text-fairway-400"> / 10</span>
        </span>
        <span className="text-fairway-300">
          Score <span className="font-bold text-fairway-100">{score}</span>
        </span>
      </div>

      <div className="shrink-0 px-4 pb-1">
        <Scorecard rolls={rolls} activeFrame={Math.min(frame, 9)} />
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="block touch-none rounded-2xl arcade-screen"
        />
      </div>

      <p className="flex h-16 shrink-0 items-center justify-center px-4 pb-4 pt-3 text-center text-sm text-fairway-100/80">
        <span className="line-clamp-2">
          {phase === 'rolling' ? 'Rolling…' : note || 'Swipe up the lane to roll — angle it for a hook.'}
        </span>
      </p>
    </div>
  );
}
