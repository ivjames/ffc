import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useFitCanvas } from './useFitCanvas';
import {
  playStroke,
  playTick,
  playDing,
  playUndo,
  playBump,
  playPinClack,
  playBuzz,
  playScore,
  playFanfare,
} from '../../lib/sound';
import type { Particle, Floater } from './fx';
import {
  TWO_PI,
  withAlpha,
  roundRectPath,
  drawShadow,
  neonLine,
  spawnBurst,
  stepParticles,
  drawParticles,
  spawnFloater,
  stepFloaters,
  drawFloaters,
  decay,
  shakeOffset,
} from './fx';

// §12 Claw Machine — a Fun Zone attraction mini-game. One-tap timing: the claw
// trolley sweeps left↔right along its rail; tap to stop it, and the claw drops,
// closes on whatever plush is beneath, then hoists and carries it to the prize
// chute. Grip and mid-carry slip are decided by a deterministic rubric on how
// well-centered the stop was (rare prizes demand more center) — no dice, so the
// carry home is a skill payoff, not a coin flip. A dead-center stop always
// holds; an edge grip always fails; the band between grabs but slips mid-carry.
// Five credits; common 5 / deluxe 10 / gold star 25. Canvas, offline.
//
// The pit is a real (tiny) physics scene: every plush is a circle body on a
// fixed-timestep sim — gravity, bouncy floor/wall contacts, prize↔prize
// impulse collisions, claw disturbance, and a sleep threshold so the settled
// pile goes fully still. A slipped prize falls ballistically back INTO the
// pile and shoves whatever it lands on.

// —— Cabinet geometry (logical units; the canvas scales to fit) ———————————————
const W = 340;
const H = 560;
const WALL_L = 16;
const WALL_R = 324;
const WALL_T = 56;
const FLOOR_Y = 534;
const RAIL_Y = 88;
const HOME_Y = 128; // claw tip resting height
const SWEEP_X0 = 88; // sweep stays clear of the chute on the left
const SWEEP_X1 = 312;
const SWEEP_MS = 1400;
const CHUTE_X = 48; // where the trolley parks to deliver
const CHUTE_L = 26;
const CHUTE_R = 70;
const CHUTE_RIM = 428;
const CHUTE_SCORE_Y = 478; // a chute drop past this depth banks the prize

const CREDITS = 5;
const GRAB_TOL = 8; // px of claw-tip slack beyond a prize's radius
const DESCEND_V = 0.24; // px/ms
const HOIST_V = 0.3;
const CARRY_V = 0.13;
const GRAB_MS = 380; // jaw close
const RELEASE_MS = 340; // jaw open over the chute
const BETWEEN_MS = 1150; // beat between credits
const TICK_MS = 90; // cable-ratchet click cadence while descending
const EMPTY_DROP_Y = 492; // tip depth when nothing is under the claw
const GRAV = 0.0012; // px/ms² for the chute-dropped prize

// —— Pit physics (fixed-timestep circle bodies for the plush pile) ————————————
const FIXED = 1000 / 120; // physics substep (ms)
const GRAV_PIT = 0.0016; // pile gravity px/ms²
const REST_WALL = 0.4; // floor/wall restitution — drops visibly bounce
const REST_PAIR = 0.35; // prize↔prize restitution
const AIR_DAMP = 0.999; // per-step velocity damping
const FLOOR_FRICTION = 0.975; // per-step vx damping while touching the floor
const MAX_V = 1.0; // px/ms speed clamp
const SLEEP_V = 0.025; // below this speed a body counts as still…
const SLEEP_MS = 300; // …and after this long it sleeps (no perpetual jitter)
const WAKE_V = 0.035; // a neighbor moving faster than this wakes a sleeper
const CLAW_R = 13; // kinematic radius the claw shoves plush aside with
const CLAW_PUSH = 0.1; // px/ms the claw imparts to nudged plush
const SETTLE_GRACE = 1300; // ms before impact sounds arm (initial pile drop-in)
const BUMP_CD = 110; // ms between floor-bump sounds
const CLACK_CD = 90; // ms between prize-on-prize clacks

type Rarity = 'common' | 'uncommon' | 'rare';
const PTS: Record<Rarity, number> = { common: 5, uncommon: 10, rare: 25 };
// Grip is decided by a deterministic rubric on how centered the stop was — no
// dice. `c` (computed at grab time) is 1 for a dead-center grip and falls to 0
// toward the prize's edge. Each rarity sets two thresholds on `c`:
//   c < hold          → the claw can't close on it (wriggles free)
//   hold ≤ c < secure → it grabs but the grip is marginal (slips mid-carry)
//   c ≥ secure        → a clean hold that survives the whole carry
// Rarer prizes demand a more centered grip on both counts.
type GripBand = { hold: number; secure: number };
const GRIP_RUBRIC: Record<Rarity, GripBand> = {
  common: { hold: 0.2, secure: 0.55 },
  uncommon: { hold: 0.35, secure: 0.7 },
  rare: { hold: 0.5, secure: 0.82 },
};

type Kind = 'teddy' | 'bunny' | 'star';
type Prize = {
  kind: Kind;
  rarity: Rarity;
  x: number; // live physics-body center in the pit
  y: number;
  vx: number; // px/ms
  vy: number;
  r: number;
  rot: number; // plush wobble angle (rad)
  vrot: number;
  asleep: boolean; // fully at rest — skipped by integration until woken
  stillT: number; // ms spent below the motion threshold
  light: string;
  base: string;
  dark: string;
  inPit: boolean;
};

/** The pit population: fifteen plush seeded in three loose rows, which the
 *  physics sim settles into a natural pile on the way in. Mostly commons, a
 *  few deluxe in the middle, the two gold stars perched on top — exposed, but
 *  slippery. */
function makePrizes(): Prize[] {
  const p = (
    kind: Kind,
    rarity: Rarity,
    x: number,
    y: number,
    r: number,
    light: string,
    base: string,
    dark: string,
  ): Prize => ({
    kind,
    rarity,
    x,
    y,
    vx: 0,
    vy: 0,
    r,
    rot: 0,
    vrot: 0,
    asleep: false,
    stillT: 0,
    light,
    base,
    dark,
    inPit: true,
  });
  return [
    // Bottom row — commons.
    p('teddy', 'common', 96, 500, 21, '#e8b483', '#b4713a', '#6f4322'),
    p('bunny', 'common', 130, 502, 19, '#f8fafc', '#cbd5e1', '#8a94a6'),
    p('teddy', 'common', 164, 499, 21, '#f9a8d4', '#ec6bb0', '#9d2e6d'),
    p('bunny', 'common', 198, 503, 19, '#a5d8ff', '#5aa9e6', '#2b6a9e'),
    p('teddy', 'common', 232, 500, 21, '#b9f0c5', '#5fbf77', '#2e7a44'),
    p('bunny', 'common', 266, 502, 19, '#ddd6fe', '#a78bfa', '#5b21b6'),
    p('teddy', 'common', 300, 499, 20, '#fed7aa', '#fb923c', '#9a3412'),
    // Middle row — commons plus the deluxe pair.
    p('teddy', 'common', 112, 464, 20, '#fecaca', '#f87171', '#991b1b'),
    p('bunny', 'common', 150, 462, 18, '#f1f5f9', '#94a3b8', '#475569'),
    p('star', 'uncommon', 190, 463, 18, '#e9d5ff', '#a855f7', '#6b21a8'),
    p('teddy', 'uncommon', 230, 462, 19, '#99f6e4', '#2dd4bf', '#0f766e'),
    p('bunny', 'common', 268, 464, 18, '#fbcfe8', '#f472b6', '#9d174d'),
    // Top of the pile — a deluxe bunny and the two gold stars.
    p('bunny', 'uncommon', 140, 430, 18, '#c7d2fe', '#818cf8', '#3730a3'),
    p('star', 'rare', 200, 426, 15, '#fef3c7', '#fbbf24', '#92400e'),
    p('star', 'rare', 252, 429, 16, '#fde68a', '#f59e0b', '#92400e'),
  ];
}

/** Triangle wave 0→1→0 over `period` ms, for the trolley sweep. */
function triWave(now: number, period: number): number {
  const u = (now % period) / period;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

type Phase =
  | 'ready'
  | 'sweep'
  | 'descend'
  | 'grab'
  | 'hoist'
  | 'carry'
  | 'release'
  | 'between'
  | 'done';

// A prize released over the chute, free-falling to the score line. (Mid-carry
// slips don't use this — a slipped prize becomes a live pit body again and
// falls ballistically into the pile.)
type Fall = {
  prize: Prize;
  x: number;
  y: number;
  vy: number;
  rot: number;
  vrot: number;
};

type GS = {
  phase: Phase;
  credit: number; // 0-based
  score: number;
  won: number;
  prizes: Prize[];
  clawX: number;
  clawY: number; // claw tip
  jaw: number; // 0 open .. 1 closed
  theta: number; // hanging-prize pendulum angle
  target: Prize | null; // what the descent is aimed at
  targetY: number;
  held: Prize | null;
  gripT: number; // jaw open/close timer
  carryT: number; // pendulum clock (hoist + carry)
  carryFrom: number; // x where the carry started, for slip progress
  slipAt: number; // carry progress fraction where the slip fires (2 = none)
  fall: Fall | null;
  sweepBase: number;
  waitT: number;
  tickAcc: number;
  simT: number; // total simulated pit time (arms impact sounds after settle-in)
  bumpCd: number; // rate limiter for floor-bump sounds (ms)
  clackCd: number; // rate limiter for prize-on-prize clacks (ms)
};

function freshGS(now: number): GS {
  return {
    phase: 'ready',
    credit: 0,
    score: 0,
    won: 0,
    prizes: makePrizes(),
    clawX: (SWEEP_X0 + SWEEP_X1) / 2,
    clawY: HOME_Y,
    jaw: 0,
    theta: 0,
    target: null,
    targetY: EMPTY_DROP_Y,
    held: null,
    gripT: 0,
    carryT: 0,
    carryFrom: SWEEP_X1,
    slipAt: 2,
    fall: null,
    sweepBase: now,
    waitT: 0,
    tickAcc: 0,
    simT: 0,
    bumpCd: 0,
    clackCd: 0,
  };
}

// —— pit physics ——————————————————————————————————————————————————————————————
function wake(p: Prize): void {
  p.asleep = false;
  p.stillT = 0;
}

/** Strongest impact speeds (px/ms) seen during a frame's physics substeps —
 *  drained once per frame into rate-limited bump/clack sounds. */
type Impacts = { floor: number; pair: number };

/** One fixed physics substep for the plush pile: claw disturbance, gravity +
 *  boundary bounces, prize↔prize collisions (positional separation + impulse),
 *  then a rest/sleep pass so the settled pile goes fully still. */
function stepPit(gs: GS, dt: number, impacts: Impacts): void {
  const pit: Prize[] = [];
  for (const p of gs.prizes) if (p.inPit) pit.push(p);

  // The claw shoves plush aside while it's down among the pile (descending,
  // squeezing, or pulling back out). The grab target itself is exempt so a
  // well-aimed drop isn't pushed out from between the prongs.
  const clawDown =
    (gs.phase === 'descend' || gs.phase === 'grab' || gs.phase === 'hoist') && gs.clawY > 400;
  if (clawDown) {
    for (const p of pit) {
      if (p === gs.target) continue;
      const dx = p.x - gs.clawX;
      const dy = p.y - (gs.clawY + 4);
      const min = p.r + CLAW_R;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.0001;
      const nx = dx / d;
      const ny = dy / d;
      wake(p);
      p.x += nx * (min - d);
      p.y += ny * (min - d);
      const along = p.vx * nx + p.vy * ny;
      if (along < CLAW_PUSH) {
        p.vx += nx * (CLAW_PUSH - along);
        p.vy += ny * (CLAW_PUSH - along) * 0.6;
      }
      p.vrot += nx * 0.01;
    }
  }

  // Integrate awake bodies against gravity and the cabinet boundaries.
  for (const p of pit) {
    if (p.asleep) continue;
    p.vy += GRAV_PIT * dt;
    p.vx *= AIR_DAMP;
    p.vy *= AIR_DAMP;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > MAX_V) {
      p.vx = (p.vx / sp) * MAX_V;
      p.vy = (p.vy / sp) * MAX_V;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    p.vrot *= 0.985;
    p.rot -= p.rot * Math.min(1, 0.004 * dt); // plush rights itself as it rests
    if (p.rot > 0.6) p.rot = 0.6;
    else if (p.rot < -0.6) p.rot = -0.6;

    // Glass side walls.
    if (p.x < WALL_L + p.r) {
      p.x = WALL_L + p.r;
      if (p.vx < 0) p.vx = -p.vx * REST_WALL;
    } else if (p.x > WALL_R - p.r) {
      p.x = WALL_R - p.r;
      if (p.vx > 0) p.vx = -p.vx * REST_WALL;
    }
    // The chute housing is solid — plush bounce off its right wall instead of
    // tumbling down the shaft.
    if (p.y + p.r > CHUTE_RIM && p.x - p.r < CHUTE_R) {
      p.x = CHUTE_R + p.r;
      if (p.vx < 0) p.vx = -p.vx * REST_WALL;
    }
    // Pit floor: restitution only above a small threshold, so the floor never
    // feeds perpetual micro-bounces.
    if (p.y > FLOOR_Y - p.r) {
      p.y = FLOOR_Y - p.r;
      if (p.vy > 0) {
        if (p.vy > 0.08) {
          if (p.vy > impacts.floor) impacts.floor = p.vy;
          p.vrot += p.vx * 0.004;
          p.vy = -p.vy * REST_WALL;
        } else {
          p.vy = 0;
        }
      }
      p.vx *= FLOOR_FRICTION;
    }
  }

  // Prize↔prize: positional separation (mass ∝ r²) plus an impulse bounce, so
  // a dropped plush knocks its neighbors around and the pile shifts naturally.
  for (let i = 0; i < pit.length; i++) {
    for (let j = i + 1; j < pit.length; j++) {
      const a = pit[i];
      const b = pit[j];
      if (a.asleep && b.asleep) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.r + b.r - 2; // plush squish: a couple of px of soft overlap
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.0001;
      const nx = dx / d;
      const ny = dy / d;
      const overlap = min - d;
      // Wake a sleeper only when it's genuinely being shoved, so a settled
      // stack doesn't jitter itself awake.
      if (a.asleep && (Math.hypot(b.vx, b.vy) > WAKE_V || overlap > 1.5)) wake(a);
      if (b.asleep && (Math.hypot(a.vx, a.vy) > WAKE_V || overlap > 1.5)) wake(b);
      const ma = a.r * a.r;
      const mb = b.r * b.r;
      let sa = mb / (ma + mb);
      let sb = ma / (ma + mb);
      if (a.asleep) {
        sa = 0;
        sb = 1;
      } else if (b.asleep) {
        sa = 1;
        sb = 0;
      }
      a.x -= nx * overlap * sa;
      a.y -= ny * overlap * sa;
      b.x += nx * overlap * sb;
      b.y += ny * overlap * sb;
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const e = -vn > 0.06 ? REST_PAIR : 0; // soft contacts don't rebound
        const jn = (-(1 + e) * vn) / (1 / ma + 1 / mb);
        if (!a.asleep) {
          a.vx -= (jn / ma) * nx;
          a.vy -= (jn / ma) * ny;
        }
        if (!b.asleep) {
          b.vx += (jn / mb) * nx;
          b.vy += (jn / mb) * ny;
        }
        if (-vn > impacts.pair) impacts.pair = -vn;
        // A little tumble from the graze.
        const tv = -rvx * ny + rvy * nx;
        if (!a.asleep) a.vrot += tv * 0.002;
        if (!b.asleep) b.vrot -= tv * 0.002;
      }
    }
  }

  // Rest: below the motion threshold long enough → sleep, fully still.
  for (const p of pit) {
    if (p.asleep) continue;
    if (Math.hypot(p.vx, p.vy) < SLEEP_V && Math.abs(p.vrot) < 0.003) {
      p.stillT += dt;
      if (p.stillT >= SLEEP_MS) {
        p.asleep = true;
        p.vx = 0;
        p.vy = 0;
        p.vrot = 0;
      }
    } else {
      p.stillT = 0;
    }
  }
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the sim is never touched; they're advanced per
// animation frame with a real dt and only ever paint pixels. Built on the
// shared ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  particles: Particle[];
  floaters: Floater[];
  shake: number;
  flash: number;
  flashColor: string;
};

function freshFX(): FX {
  return { particles: [], floaters: [], shake: 0, flash: 0, flashColor: '#fbbf24' };
}

function updateFX(fx: FX, dt: number) {
  fx.particles = stepParticles(fx.particles, dt, 0.02, 260);
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
function starPath(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.5;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** A plush prize drawn at the origin: rounded gradient body with simple ears
 *  and a face. `rare` adds the gold star's soft glow. */
function drawPrize(
  ctx: CanvasRenderingContext2D,
  kind: Kind,
  r: number,
  light: string,
  base: string,
  dark: string,
  rare = false,
) {
  ctx.save();
  if (rare) {
    ctx.shadowColor = withAlpha('#fbbf24', 0.75);
    ctx.shadowBlur = 14;
  }
  if (kind === 'star') {
    const g = ctx.createLinearGradient(0, -r * 1.15, 0, r * 1.15);
    g.addColorStop(0, light);
    g.addColorStop(0.55, base);
    g.addColorStop(1, dark);
    starPath(ctx, r * 1.18);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = withAlpha(dark, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    // Ears behind the head.
    ctx.fillStyle = base;
    if (kind === 'teddy') {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * 0.6, -r * 0.62, r * 0.34, 0, TWO_PI);
        ctx.fill();
      }
      ctx.fillStyle = withAlpha(dark, 0.55);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * 0.6, -r * 0.62, r * 0.16, 0, TWO_PI);
        ctx.fill();
      }
    } else {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * r * 0.38, -r * 0.92, r * 0.2, r * 0.52, s * 0.18, 0, TWO_PI);
        ctx.fill();
      }
      ctx.fillStyle = '#fbcfe8';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * r * 0.38, -r * 0.9, r * 0.09, r * 0.34, s * 0.18, 0, TWO_PI);
        ctx.fill();
      }
    }
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r);
    g.addColorStop(0, light);
    g.addColorStop(0.6, base);
    g.addColorStop(1, dark);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TWO_PI);
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();

  // Face — shared across shapes so the whole pit reads as one plush family.
  ctx.fillStyle = '#1f2430';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * r * 0.26, -r * 0.06, r * 0.09, 0, TWO_PI);
    ctx.fill();
  }
  ctx.strokeStyle = '#1f2430';
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, r * 0.12, r * 0.16, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
  if (kind === 'teddy') {
    ctx.fillStyle = withAlpha('#3a2a1a', 0.85);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.14, r * 0.11, r * 0.08, 0, 0, TWO_PI);
    ctx.fill();
  }
}

/** The claw: metal body block + two curving prongs. `jaw` 0 = spread open,
 *  1 = pinched shut. (x, y) is the tip anchor between the prongs. */
function drawClaw(ctx: CanvasRenderingContext2D, x: number, y: number, jaw: number) {
  const bg = ctx.createLinearGradient(x - 9, y - 27, x + 9, y - 10);
  bg.addColorStop(0, '#e2e8f0');
  bg.addColorStop(0.5, '#94a3b8');
  bg.addColorStop(1, '#475569');
  roundRectPath(ctx, x - 9, y - 27, 18, 15, 4);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,23,42,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const spread = 16 * (1 - jaw) + 3;
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + s * 7, y - 13);
    ctx.quadraticCurveTo(x + s * (spread + 7), y + 2, x + s * spread * 0.45, y + 14);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(51,65,85,0.8)';
  ctx.lineWidth = 1.2;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + s * 7, y - 13);
    ctx.quadraticCurveTo(x + s * (spread + 7), y + 2, x + s * spread * 0.45, y + 14);
    ctx.stroke();
  }
  // Hinge bolt.
  ctx.beginPath();
  ctx.arc(x, y - 12, 2.4, 0, TWO_PI);
  ctx.fillStyle = '#f1f5f9';
  ctx.fill();
}

/** Where a held prize's center hangs below the claw tip for pendulum angle θ. */
function hangPoint(clawX: number, clawY: number, theta: number, r: number) {
  const len = r * 0.9 + 8;
  return { x: clawX + Math.sin(theta) * len, y: clawY + 6 + Math.cos(theta) * len };
}

const FRAME = '#7f1d3a';
const FRAME_LIGHT = '#a83a5e';
const BULBS = ['#f472b6', '#60a5fa', '#fbbf24', '#4ade80'];

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);

  // —— Arcade-room backdrop ——
  const room = ctx.createLinearGradient(0, 0, 0, H);
  room.addColorStop(0, '#181226');
  room.addColorStop(0.6, '#100b1c');
  room.addColorStop(1, '#0a0712');
  ctx.fillStyle = room;
  ctx.fillRect(0, 0, W, H);

  // —— Cabinet shell ——
  const shell = ctx.createLinearGradient(0, 36, 0, H - 6);
  shell.addColorStop(0, FRAME_LIGHT);
  shell.addColorStop(0.25, FRAME);
  shell.addColorStop(1, '#4c1127');
  roundRectPath(ctx, 6, 36, W - 12, H - 42, 14);
  ctx.fillStyle = shell;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Marquee bulbs across the header, chasing on a fixed clock.
  const lit = Math.floor(now / 300);
  for (let i = 0; i < 10; i++) {
    const bx = 38 + i * 29.5;
    const c = BULBS[i % BULBS.length];
    const on = (i + lit) % 4 !== 0;
    ctx.beginPath();
    ctx.arc(bx, 47, 3.4, 0, TWO_PI);
    ctx.fillStyle = on ? c : withAlpha(c, 0.25);
    if (on) {
      ctx.shadowColor = c;
      ctx.shadowBlur = 8;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // —— Glass interior ——
  const inner = ctx.createLinearGradient(0, WALL_T, 0, FLOOR_Y);
  inner.addColorStop(0, '#171331');
  inner.addColorStop(0.65, '#120e26');
  inner.addColorStop(1, '#0b0918');
  ctx.fillStyle = inner;
  ctx.fillRect(WALL_L, WALL_T, WALL_R - WALL_L, FLOOR_Y - WALL_T);

  // Pit floor: a plush-lined base with soft mounds behind the front row.
  const pitG = ctx.createLinearGradient(0, 452, 0, FLOOR_Y);
  pitG.addColorStop(0, 'rgba(56,38,84,0)');
  pitG.addColorStop(1, '#2a1d40');
  ctx.fillStyle = pitG;
  ctx.fillRect(WALL_L, 452, WALL_R - WALL_L, FLOOR_Y - 452);
  ctx.fillStyle = '#231737';
  for (let i = 0; i < 6; i++) {
    const mx = 96 + i * 42;
    ctx.beginPath();
    ctx.arc(mx, 512 + (i % 2) * 6, 26, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = '#1c122c';
  ctx.fillRect(WALL_L, 522, WALL_R - WALL_L, FLOOR_Y - 522);

  // Chute shaft (back + walls); the front lip paints over the drop later.
  ctx.fillStyle = '#08060f';
  ctx.fillRect(CHUTE_L, CHUTE_RIM, CHUTE_R - CHUTE_L, FLOOR_Y - CHUTE_RIM);
  ctx.strokeStyle = 'rgba(251,191,36,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(CHUTE_L, CHUTE_RIM, CHUTE_R - CHUTE_L, FLOOR_Y - CHUTE_RIM);
  neonLine(ctx, CHUTE_L - 2, CHUTE_RIM, CHUTE_R + 2, CHUTE_RIM, '#fbbf24', 2.5, 10);

  // —— Dynamic layer (shaken on slips / gold wins) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Prizes in the pit, back row first so the front row overlaps naturally.
  const pit = gs.prizes.filter((p) => p.inPit).sort((a, b) => a.y - b.y);
  for (const p of pit) {
    drawShadow(ctx, p.x, p.y + p.r * 0.82, p.r * 0.9, p.r * 0.28, 0.35);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    drawPrize(ctx, p.kind, p.r, p.light, p.base, p.dark, p.rarity === 'rare');
    ctx.restore();
  }

  // Rail + trolley + cable + claw.
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(WALL_L + 4, RAIL_Y - 13, WALL_R - WALL_L - 8, 7);
  ctx.fillStyle = 'rgba(148,163,184,0.35)';
  ctx.fillRect(WALL_L + 4, RAIL_Y - 8, WALL_R - WALL_L - 8, 1.5);

  const tg = ctx.createLinearGradient(gs.clawX - 16, RAIL_Y - 10, gs.clawX + 16, RAIL_Y + 6);
  tg.addColorStop(0, '#64748b');
  tg.addColorStop(0.5, '#334155');
  tg.addColorStop(1, '#1e293b');
  roundRectPath(ctx, gs.clawX - 16, RAIL_Y - 10, 32, 16, 5);
  ctx.fillStyle = tg;
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(gs.clawX + s * 9, RAIL_Y - 10, 3.5, 0, TWO_PI);
    ctx.fillStyle = '#94a3b8';
    ctx.fill();
  }

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(gs.clawX, RAIL_Y + 6);
  ctx.lineTo(gs.clawX, gs.clawY - 26);
  ctx.stroke();

  // Held prize swings below the claw; drawn before the claw so the prongs
  // read as wrapped around it.
  if (gs.held) {
    const hp = hangPoint(gs.clawX, gs.clawY, gs.theta, gs.held.r);
    ctx.save();
    ctx.translate(hp.x, hp.y);
    ctx.rotate(gs.theta);
    drawPrize(ctx, gs.held.kind, gs.held.r, gs.held.light, gs.held.base, gs.held.dark, gs.held.rarity === 'rare');
    ctx.restore();
  }
  drawClaw(ctx, gs.clawX, gs.clawY, gs.jaw);

  // A chute-dropped prize in free fall toward the score line.
  if (gs.fall) {
    const f = gs.fall;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    drawPrize(ctx, f.prize.kind, f.prize.r, f.prize.light, f.prize.base, f.prize.dark, f.prize.rarity === 'rare');
    ctx.restore();
  }

  // Chute front lip — a chute drop vanishes behind it as it banks.
  ctx.fillStyle = '#140f22';
  ctx.fillRect(CHUTE_L, CHUTE_RIM + 18, CHUTE_R - CHUTE_L, FLOOR_Y - CHUTE_RIM - 18);
  ctx.strokeStyle = 'rgba(251,191,36,0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(CHUTE_L, CHUTE_RIM + 18, CHUTE_R - CHUTE_L, FLOOR_Y - CHUTE_RIM - 18);
  ctx.save();
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PRIZE', CHUTE_X, CHUTE_RIM + 38);
  ctx.fillText('▼', CHUTE_X, CHUTE_RIM + 52);
  ctx.restore();

  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
  ctx.restore();

  // —— Glass streaks over everything inside the cabinet ——
  ctx.save();
  ctx.beginPath();
  ctx.rect(WALL_L, WALL_T, WALL_R - WALL_L, FLOOR_Y - WALL_T);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (const [x0, w] of [
    [40, 34],
    [120, 16],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x0 + 130, WALL_T);
    ctx.lineTo(x0 + 130 + w, WALL_T);
    ctx.lineTo(x0 + w, FLOOR_Y);
    ctx.lineTo(x0, FLOOR_Y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(WALL_L, WALL_T, WALL_R - WALL_L, FLOOR_Y - WALL_T);

  // Coin door on the base panel.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRectPath(ctx, W / 2 - 26, FLOOR_Y + 6, 52, 12, 4);
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(W / 2 - 2, FLOOR_Y + 9, 4, 6);

  // —— Win flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }
}

export default function ClawMachine() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS(0));
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('ready');
  const [credit, setCredit] = useState(0);
  const [score, setScore] = useState(0);
  const [note, setNote] = useState('');

  const active = phase !== 'done';
  useFitCanvas(canvasRef, W, H, active);

  /** Bank a chute drop: score it, celebrate, count the win. */
  const deliver = useCallback((prize: Prize) => {
    const gs = gsRef.current;
    const fx = fxRef.current;
    const pts = PTS[prize.rarity];
    gs.score += pts;
    gs.won += 1;
    setScore(gs.score);
    setNote(`+${pts} — prize delivered!`);
    spawnFloater(fx.floaters, CHUTE_X + 14, CHUTE_RIM - 14, `+${pts}`, prize.rarity === 'rare' ? '#fbbf24' : '#a5f3a5', { size: 24, life: 900 });
    playScore();
    if (prize.rarity === 'rare') {
      playFanfare();
      fx.flash = 1;
      fx.flashColor = '#fbbf24';
      fx.shake = 6;
      spawnBurst(fx.particles, CHUTE_X + 10, CHUTE_RIM - 10, 26, 300, '#fde68a');
      spawnBurst(fx.particles, CHUTE_X + 10, CHUTE_RIM - 10, 16, 220, '#f472b6');
      spawnBurst(fx.particles, CHUTE_X + 10, CHUTE_RIM - 10, 16, 220, '#60a5fa');
    } else {
      spawnBurst(fx.particles, CHUTE_X + 10, CHUTE_RIM - 10, 12, 180, prize.light);
    }
  }, []);

  /** End the current credit; the next one (or the done screen) follows the beat. */
  const endCredit = useCallback((message: string) => {
    const gs = gsRef.current;
    gs.phase = 'between';
    gs.waitT = 0;
    setPhase('between');
    setNote(message);
  }, []);

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
    let sweepPausedAt = 0;
    let last = performance.now();
    let acc = 0; // pit-physics fixed-timestep accumulator
    // Pause via visibilitychange too, not just the hidden-rAF branch: mobile
    // browsers can fully suspend requestAnimationFrame while backgrounded, so a
    // hidden frame may never run. Everything else here is dt-driven (and dt is
    // clamped), so only the sweep's time base needs shifting by the away span —
    // guarded so the hidden-rAF branch and this handler never both shift it.
    // The physics accumulator is dropped on resume so the pile freezes with
    // the tab instead of simulating the whole away span.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const away = performance.now() - hiddenAt;
        hiddenAt = 0;
        if (!sweepPausedAt) gsRef.current.sweepBase += away;
        last = performance.now();
        acc = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const frame = (now: number) => {
      const gs = gsRef.current;
      const fx = fxRef.current;
      if (document.hidden) {
        if (!sweepPausedAt) sweepPausedAt = now;
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      if (sweepPausedAt) {
        gs.sweepBase += now - sweepPausedAt;
        sweepPausedAt = 0;
      }
      const dt = Math.min(now - last, 100);
      last = now;

      if (gs.phase === 'sweep') {
        gs.clawX = SWEEP_X0 + (SWEEP_X1 - SWEEP_X0) * triWave(now - gs.sweepBase, SWEEP_MS);
      } else if (gs.phase === 'descend') {
        gs.clawY = Math.min(gs.targetY, gs.clawY + DESCEND_V * dt);
        // Cable-ratchet clicks on the way down.
        gs.tickAcc += dt;
        while (gs.tickAcc >= TICK_MS) {
          gs.tickAcc -= TICK_MS;
          playTick();
        }
        if (gs.clawY >= gs.targetY) {
          gs.phase = 'grab';
          gs.gripT = 0;
          setPhase('grab');
        }
      } else if (gs.phase === 'grab') {
        gs.gripT += dt;
        gs.jaw = Math.min(1, gs.gripT / GRAB_MS);
        if (gs.gripT >= GRAB_MS) {
          // Resolve the grip against the rubric: purely how centered the stop
          // was, judged against this rarity's thresholds. No randomness — the
          // same stop on the same prize always resolves the same way.
          const t = gs.target;
          if (t) {
            const c = Math.max(0, 1 - Math.abs(gs.clawX - t.x) / (t.r + GRAB_TOL));
            const band = GRIP_RUBRIC[t.rarity];
            if (c >= band.hold) {
              gs.held = t;
              t.inPit = false;
              // Wake the neighbors so the pile settles into the gap the
              // extraction leaves.
              for (const q of gs.prizes) {
                if (q.inPit && Math.hypot(q.x - t.x, q.y - t.y) < q.r + t.r + 26) wake(q);
              }
              // A grip in the marginal band (below `secure`) slips mid-carry;
              // the closer it is to just-barely-holding, the earlier it goes.
              if (c >= band.secure) {
                gs.slipAt = 2; // clean hold — carries all the way home
                setNote('Solid grip — bring it home!');
              } else {
                const q = (c - band.hold) / (band.secure - band.hold); // 0..1 within the band
                gs.slipAt = 0.2 + 0.65 * q;
                setNote('Got it — but the grip feels loose…');
              }
              // Rising ding, not playCup: the cup sound's descending plunks
              // read as a fail cue when they mark a successful grab.
              playDing();
              spawnBurst(fx.particles, gs.clawX, gs.clawY + 8, 10, 160, t.light);
            } else {
              setNote('Off-center — it wriggled free of the claw!');
              playBuzz();
              spawnFloater(fx.floaters, gs.clawX, gs.clawY - 24, 'NO GRIP', '#94a3b8', { size: 16 });
            }
          } else {
            setNote('Nothing but air!');
            playBuzz();
            spawnFloater(fx.floaters, gs.clawX, gs.clawY - 24, 'MISS', '#94a3b8', { size: 16 });
          }
          gs.phase = 'hoist';
          gs.carryT = 0;
          setPhase('hoist');
        }
      } else if (gs.phase === 'hoist') {
        gs.clawY = Math.max(HOME_Y, gs.clawY - HOIST_V * dt);
        gs.carryT += dt;
        gs.theta = gs.held ? 0.1 * Math.sin(gs.carryT * 0.01) : 0;
        if (gs.clawY <= HOME_Y) {
          if (gs.held) {
            gs.phase = 'carry';
            gs.carryFrom = gs.clawX;
            setPhase('carry');
          } else {
            endCredit(gs.target ? 'The claw came up empty.' : 'The claw came up empty. Aim for a plush!');
          }
        }
      } else if (gs.phase === 'carry') {
        gs.clawX = Math.max(CHUTE_X, gs.clawX - CARRY_V * dt);
        gs.carryT += dt;
        const ramp = Math.min(1, gs.carryT / 350);
        gs.theta = 0.3 * ramp * Math.sin(gs.carryT * 0.0085);
        const span = Math.max(1, gs.carryFrom - CHUTE_X);
        const progress = (gs.carryFrom - gs.clawX) / span;
        // A rolled slip fires at its pre-chosen point along the carry — the
        // pendulum wobble makes the whole trip feel like it might.
        if (gs.held && progress >= gs.slipAt) {
          const p = gs.held;
          const hp = hangPoint(gs.clawX, gs.clawY, gs.theta, p.r);
          gs.held = null;
          gs.slipAt = 2;
          gs.jaw = 0.35;
          // Back into the sim: the dropped plush falls ballistically into the
          // pile (inheriting the trolley's leftward motion) and shoves
          // whatever it lands on — no scripted return to a home spot.
          p.x = hp.x;
          p.y = hp.y;
          // Re-entry drift follows the pendulum's swing at the moment of release
          // (deterministic — the whole outcome is), so the plush falls the way
          // it was swinging rather than on a coin flip.
          p.vx = -CARRY_V * 0.7 + Math.sin(gs.theta) * 0.06;
          p.vy = 0.02;
          p.rot = gs.theta;
          p.vrot = (gs.theta >= 0 ? 1 : -1) * 0.004;
          p.inPit = true;
          wake(p);
          fx.shake = 5;
          playUndo();
          spawnFloater(fx.floaters, hp.x, hp.y - 26, 'SO CLOSE!', '#fca5a5', { size: 18, life: 800 });
          setNote('It slipped away!');
        }
        if (gs.clawX <= CHUTE_X) {
          if (gs.held) {
            gs.phase = 'release';
            gs.gripT = 0;
            setPhase('release');
          } else {
            endCredit('It slipped back into the pit!');
          }
        }
      } else if (gs.phase === 'release') {
        // The jaw opens over the chute; the prize drops the moment it lets go.
        gs.gripT += dt;
        gs.jaw = Math.max(0, 1 - gs.gripT / RELEASE_MS);
        gs.theta = 0.3 * Math.max(0, 1 - gs.gripT / RELEASE_MS) * Math.sin(gs.carryT * 0.0085);
        if (gs.held && gs.gripT >= RELEASE_MS * 0.4) {
          const p = gs.held;
          const hp = hangPoint(gs.clawX, gs.clawY, gs.theta, p.r);
          gs.held = null;
          gs.fall = { prize: p, x: hp.x, y: hp.y, vy: 0.03, rot: gs.theta, vrot: 0.002 };
        }
        if (gs.gripT >= RELEASE_MS) endCredit('Down the chute…');
      } else if (gs.phase === 'between') {
        gs.waitT += dt;
        if (gs.waitT >= BETWEEN_MS) {
          if (gs.credit + 1 >= CREDITS) {
            gs.phase = 'done';
            setPhase('done');
            playFanfare();
          } else {
            gs.credit += 1;
            gs.phase = 'sweep';
            gs.clawY = HOME_Y;
            gs.jaw = 0;
            gs.theta = 0;
            gs.target = null;
            gs.sweepBase = now;
            setCredit(gs.credit);
            setPhase('sweep');
          }
        }
      }

      // Chute-drop integration runs across phases so a release late in the
      // beat can finish banking during the between-credits pause.
      if (gs.fall) {
        const f = gs.fall;
        f.vy += GRAV * dt;
        f.y += f.vy * dt;
        f.rot += f.vrot * dt;
        if (f.y >= CHUTE_SCORE_Y) {
          deliver(f.prize);
          gs.fall = null;
        }
      }

      // —— Plush-pile physics: fixed-timestep accumulator (120 Hz), dt already
      // clamped above so a stall never spirals. Impact maxima drain into soft,
      // rate-limited bump/clack sounds once per frame.
      const impacts: Impacts = { floor: 0, pair: 0 };
      acc += dt;
      while (acc >= FIXED) {
        stepPit(gs, FIXED, impacts);
        acc -= FIXED;
      }
      gs.simT += dt;
      gs.bumpCd -= dt;
      gs.clackCd -= dt;
      if (gs.simT > SETTLE_GRACE) {
        if (impacts.floor > 0.12 && gs.bumpCd <= 0) {
          gs.bumpCd = BUMP_CD;
          playBump(Math.min(1.3, 0.4 + impacts.floor * 0.9));
        }
        if (impacts.pair > 0.1 && gs.clackCd <= 0) {
          gs.clackCd = CLACK_CD;
          playPinClack(Math.min(1.3, 0.35 + impacts.pair));
        }
      }

      updateFX(fx, dt);
      draw(ctx, gs, fx, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, deliver, endCredit]);

  const onTap = useCallback(() => {
    const gs = gsRef.current;
    if (gs.phase !== 'sweep') return;
    // The loop stores the last-rendered sweep position in gs.clawX, so the
    // claw drops exactly where the player saw it.
    let best: Prize | null = null;
    for (const p of gs.prizes) {
      if (!p.inPit || Math.abs(gs.clawX - p.x) >= p.r + GRAB_TOL) continue;
      if (!best || p.y - p.r < best.y - best.r) best = p; // topmost surface first
    }
    gs.target = best;
    gs.targetY = best ? best.y - best.r + 6 : EMPTY_DROP_Y;
    gs.tickAcc = 0;
    gs.phase = 'descend';
    setPhase('descend');
    playStroke();
  }, []);

  const start = useCallback(() => {
    const now = performance.now();
    const gs = freshGS(now);
    gs.phase = 'sweep';
    gsRef.current = gs;
    fxRef.current = freshFX();
    setPhase('sweep');
    setCredit(0);
    setScore(0);
    setNote('');
  }, []);

  if (phase === 'done') {
    const gs = gsRef.current;
    const remark =
      score >= 30 ? 'Claw whisperer! 🏆' : score >= 15 ? 'Arcade ace! 🕹️' : score >= 1 ? 'A prize is a prize! 🧸' : 'The claw giveth… nothing. 🎮';
    return (
      <Screen>
        <TopBar title="Claw Machine" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🧸</span>
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">
              {gs.won} prize{gs.won === 1 ? '' : 's'} across {CREDITS} credits
            </p>
          </div>
          {/* No ticket earning: the claw stays a Fun Zone attraction, outside
              the ticket economy — its score is just for bragging rights. */}
          <div className="mt-8">
            <Button onClick={start} sound="none">
              Play again
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  const hint =
    phase === 'ready'
      ? 'Tap to stop the claw over a prize — then hope the grip holds.'
      : phase === 'sweep'
        ? `Tap to drop the claw! Credit ${credit + 1} of ${CREDITS}.`
        : phase === 'descend' || phase === 'grab'
          ? 'Going down…'
          : phase === 'hoist'
            ? note || 'Hoisting…'
            : phase === 'carry'
              ? 'Steady… steady…'
              : phase === 'release'
                ? 'Delivering!'
                : note || '…';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Claw Machine" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Credit <span className="text-fairway-100">{Math.min(credit + 1, CREDITS)}</span>
          <span className="font-normal text-fairway-400"> / {CREDITS}</span>
        </span>
        <span className="text-fairway-300">
          Score <span className="font-bold text-fairway-100">{score}</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-4 px-4 pb-1 text-[11px] text-fairway-300">
        <span>
          <span style={{ color: '#ec6bb0' }}>●</span> Plush 5
        </span>
        <span>
          <span style={{ color: '#a855f7' }}>●</span> Deluxe 10
        </span>
        <span>
          <span style={{ color: '#fbbf24' }}>★</span> Gold 25
        </span>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onTap}
          className="col-start-1 row-start-1 block touch-none rounded-2xl border border-fairway-800"
        />
        {phase === 'ready' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <span className="text-5xl">🧸</span>
            <p className="text-sm text-fairway-100">
              Tap to stop the claw over a prize — a dead-center grip holds best, and the gold star pays 25. {CREDITS} credits.
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
