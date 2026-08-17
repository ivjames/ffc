import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameTicketAward from './GameTicketAward';
import GameHighScore from './GameHighScore';
import { useFitCanvas } from './useFitCanvas';
import { drawLogo } from './logo';
import { playStroke, playCup, playDing, playUndo, playPinClack, playFanfare } from '../../lib/sound';
import type { Particle, Vec as FxVec, Floater } from './fx';
import {
  TWO_PI,
  withAlpha,
  roundRectPath,
  drawShadow,
  drawSphere,
  spawnBurst,
  stepParticles,
  drawParticles,
  spawnFloater,
  stepFloaters,
  drawFloaters,
  pushTrail,
  decay,
  shakeOffset,
  drawScreenVeil,
} from './fx';

// §12 Milk Bottle Knockdown — the classic midway booth. Six heavy "milk"
// bottles stacked 3-2-1 on a barrel; flick the softball into the stack. On
// impact a simple momentum model topples any bottle struck hard enough; a
// falling bottle can knock its neighbours and a bottle whose supporters go
// down loses its footing — so a low, hard shot into the base row wipes the
// whole pyramid while clipping the top bottle only nets one. Three racks, two
// throws per rack, +1 a bottle; all six with the first ball is a CLEAN SWEEP
// (+5). Canvas-rendered, client-side, offline.

// —— Booth + physics (logical units; the canvas scales to fit) ————————————————
const W = 340;
const H = 560;
const CX = W / 2;
const BARREL_TOP = 344;
const BARREL_BOT = 468;
const START = { x: CX, y: 505 };

const FIXED = 1000 / 120; // physics substep, ms
const G_BALL = 0.045; // px/step² — a light arc on the throw
const G_BOT = 0.12; // px/step² — heavy bottles drop fast once toppled
const AIR_DRAG = 0.999;
const REST = 0.35; // collision restitution
const BALL_M = 5;
const BOT_M = 3;
const BALL_PR = 10; // physics radius (draw radius scales with depth)
const BOT_PR = 13;
const MIN_V = 5;
const MAX_V = 12.5;
const MAX_DRAG = 280;
// A bottle only topples when the closing speed of the hit beats its weight —
// below this it absorbs the ball with a dead thud. Chained knocks (a falling
// bottle clipping a standing one) need far less.
const TOPPLE = 4.2;
const CHAIN = 1.6;
const MAX_LIVE_MS = 3200; // hard stop for a throw's simulation
const NEXT_DELAY_MS = 1000;
const RACKS = 3;
const THROWS_PER_RACK = 2;
const SWEEP_BONUS = 5;
const COUNT_STEP_MS = 800; // per digit of the "3, 2, 1" countdown
const GO_MS = 500; // beat of "GO!" after the digits
const COUNTDOWN_MS = 3 * COUNT_STEP_MS + GO_MS;

// The 3-2-1 pyramid, base row resting on the barrel top. Row spacing matches
// the drawn bottle height so each row visually stands on the one below.
const SPOTS: Array<{ x: number; y: number }> = [
  { x: CX - 28, y: 316 },
  { x: CX, y: 316 },
  { x: CX + 28, y: 316 },
  { x: CX - 14, y: 272 },
  { x: CX + 14, y: 272 },
  { x: CX, y: 228 },
];
// Which base bottles hold each upper bottle up; lose any one and it topples.
const SUPPORTS: number[][] = [[], [], [], [0, 1], [1, 2], [3, 4]];

type Bottle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  sx: number; // standing spot (restored when a hit is absorbed)
  sy: number;
  down: boolean;
  gone: boolean; // tumbled out of frame
};
type Ball = { x: number; y: number; vx: number; vy: number };
type Drag = { active: boolean; sx: number; sy: number; dx: number; dy: number };
type Phase = 'ready' | 'countdown' | 'aim' | 'live' | 'scored' | 'done';
type GS = {
  phase: Phase;
  rack: number; // 0-based
  throwNo: number; // 0 or 1 within the rack
  score: number;
  bottles: Bottle[];
  ball: Ball;
  drag: Drag;
  liveStart: number;
  countStart: number;
  lastClack: number; // throttle so a pile-up doesn't machine-gun the clack
  downAtThrowStart: number; // downed count when this ball left the hand
  note: string;
};

function makeBottles(): Bottle[] {
  return SPOTS.map((s) => ({ x: s.x, y: s.y, vx: 0, vy: 0, rot: 0, vrot: 0, sx: s.x, sy: s.y, down: false, gone: false }));
}

function freshBall(): Ball {
  return { x: START.x, y: START.y, vx: 0, vy: 0 };
}

function freshGS(): GS {
  return {
    phase: 'ready',
    rack: 0,
    throwNo: 0,
    score: 0,
    bottles: makeBottles(),
    ball: freshBall(),
    drag: { active: false, sx: 0, sy: 0, dx: 0, dy: 0 },
    liveStart: 0,
    countStart: 0,
    lastClack: -1e9,
    downAtThrowStart: 0,
    note: '',
  };
}

const downedCount = (bs: Bottle[]) => bs.reduce((n, b) => n + (b.down ? 1 : 0), 0);

/** Map a flick (drag delta) to a launch velocity, or null if it isn't a valid
 *  upward throw. */
function launch(dx: number, dy: number): { vx: number; vy: number } | null {
  const len = Math.hypot(dx, dy);
  if (len < 12) return null; // deadzone tap
  if (dy / len > -0.35) return null; // not aimed up at the stack
  const power = Math.min(len / MAX_DRAG, 1);
  const speed = MIN_V + power * (MAX_V - MIN_V);
  return { vx: (dx / len) * speed, vy: (dy / len) * speed };
}

/** Resolve a circle↔circle collision with mass + restitution. Returns the
 *  closing speed when a bounce was applied (0 otherwise) so the caller can
 *  judge topples and voice the impact. */
function collideCircles(
  a: { x: number; y: number; vx: number; vy: number },
  b: { x: number; y: number; vx: number; vy: number },
  ra: number,
  rb: number,
  ma: number,
  mb: number,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const min = ra + rb;
  if (dist >= min) return 0;
  const nx = dx / dist;
  const ny = dy / dist;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  const invA = 1 / ma;
  const invB = 1 / mb;
  const push = (min - dist) / (invA + invB);
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

/** A struck bottle tips over: keep the impulse the collision gave it, bias it
 *  off the barrel edge, and set it spinning so it tumbles out of frame. */
function toppleFromHit(b: Bottle) {
  b.down = true;
  const dir = Math.sign(b.vx) || Math.sign(b.x - CX) || (Math.random() < 0.5 ? -1 : 1);
  b.vx += dir * 0.4;
  b.vrot = dir * (0.04 + Math.random() * 0.06);
}

/** A bottle whose footing vanished leans into the gap and goes over. */
function toppleUnsupported(b: Bottle, dir: number) {
  b.down = true;
  b.vx = dir * (0.4 + Math.random() * 0.6);
  b.vy = -0.3;
  b.vrot = dir * (0.03 + Math.random() * 0.05);
}

/** One physics substep. `now` only throttles the collision clacks — the
 *  physics itself stays fixed-timestep. Collisions/topples only run while the
 *  throw is live; in 'scored' the leftovers just keep tumbling out of frame. */
function step(gs: GS, now: number) {
  const live = gs.phase === 'live';
  const ball = gs.ball;

  ball.vy += G_BALL;
  ball.vx *= AIR_DRAG;
  ball.vy *= AIR_DRAG;
  ball.x += ball.vx;
  ball.y += ball.vy;

  // A short lob comes back down onto the barrel head and bounces off dead.
  if (live && ball.vy > 0 && Math.abs(ball.x - CX) < 76 && ball.y > BARREL_TOP - 4 && ball.y < BARREL_TOP + 24) {
    ball.y = BARREL_TOP - 4;
    ball.vy = -ball.vy * 0.35;
    ball.vx += (Math.sign(ball.x - CX) || 1) * 0.4; // roll off the edge
    if (now - gs.lastClack > 60) {
      gs.lastClack = now;
      playPinClack(0.35);
    }
  }

  // Toppled bottles: gravity + tumble until they leave the frame.
  for (const b of gs.bottles) {
    if (b.gone || !b.down) continue;
    b.vy += G_BOT;
    b.vx *= AIR_DRAG;
    b.x += b.vx;
    b.y += b.vy;
    b.rot += b.vrot;
    if (b.y > H + 80) b.gone = true;
  }

  if (!live) return;

  // Ball ↔ bottle: topple past the threshold, absorb (dead thud) below it.
  let clack = 0;
  for (const b of gs.bottles) {
    if (b.gone) continue;
    const wasStanding = !b.down;
    const hit = collideCircles(ball, b, BALL_PR, BOT_PR, BALL_M, BOT_M);
    if (hit <= 0) continue;
    if (wasStanding) {
      if (hit >= TOPPLE) {
        toppleFromHit(b);
        clack = Math.max(clack, Math.min(1.4, 0.35 + hit * 0.09));
      } else {
        // Too weak to move the heavy bottle — it soaks the hit up.
        b.x = b.sx;
        b.y = b.sy;
        b.vx = 0;
        b.vy = 0;
        clack = Math.max(clack, 0.3);
      }
    } else {
      clack = Math.max(clack, Math.min(1, 0.25 + hit * 0.07));
    }
  }

  // Bottle ↔ bottle: a tumbling bottle can knock a standing neighbour over.
  for (let i = 0; i < gs.bottles.length; i++) {
    for (let k = i + 1; k < gs.bottles.length; k++) {
      const a = gs.bottles[i];
      const b = gs.bottles[k];
      if (a.gone || b.gone) continue;
      if (!a.down && !b.down) continue; // the standing rack never self-collides
      const aStood = !a.down;
      const bStood = !b.down;
      const hit = collideCircles(a, b, BOT_PR, BOT_PR, BOT_M, BOT_M);
      if (hit <= 0) continue;
      for (const [bot, stood] of [
        [a, aStood],
        [b, bStood],
      ] as Array<[Bottle, boolean]>) {
        if (!stood) continue;
        if (hit >= CHAIN) toppleFromHit(bot);
        else {
          bot.x = bot.sx;
          bot.y = bot.sy;
          bot.vx = 0;
          bot.vy = 0;
        }
      }
      clack = Math.max(clack, Math.min(0.9, 0.2 + hit * 0.08));
    }
  }

  // Support: an upper bottle with any downed supporter loses its footing.
  for (let i = 3; i < gs.bottles.length; i++) {
    const b = gs.bottles[i];
    if (b.down || b.gone) continue;
    const fallen = SUPPORTS[i].find((s) => gs.bottles[s].down);
    if (fallen !== undefined) {
      const dir = Math.sign(SPOTS[fallen].x - b.x) || (Math.random() < 0.5 ? -1 : 1);
      toppleUnsupported(b, dir);
      clack = Math.max(clack, 0.5);
    }
  }

  if (clack > 0 && now - gs.lastClack > 60) {
    gs.lastClack = now;
    playPinClack(clack);
  }
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the fixed-timestep sim is never touched; they're
// advanced per animation frame with a real dt and only ever paint pixels. Built
// on the shared ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent ball positions → throw motion streak
  particles: Particle[]; // paint-chip bursts as bottles go over
  floaters: Floater[]; // "+N" / "CLEAN SWEEP!" popups
  shake: number; // impact shake magnitude (px), decays to 0
  flash: number; // big-knockdown flash 0..1, decays to 0
  downSeen: Set<number>; // bottle indices already burst (each falls once)
};

function freshFX(): FX {
  return { trail: [], particles: [], floaters: [], shake: 0, flash: 0, downSeen: new Set() };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). Reads gs but
 *  never mutates it — every event it reacts to already happened in the sim. */
function updateFX(fx: FX, gs: GS, dt: number) {
  if (gs.phase === 'live') pushTrail(fx.trail, gs.ball.x, gs.ball.y, 14);
  else fx.trail.length = 0;

  // A bottle that just went over throws a burst of cream paint chips, once.
  gs.bottles.forEach((b, i) => {
    if (b.down && !fx.downSeen.has(i)) {
      fx.downSeen.add(i);
      spawnBurst(fx.particles, b.x, b.y, 10, 180, '#f1e5c8');
      spawnBurst(fx.particles, b.x, b.y, 5, 110, '#b06a32'); // rust flecks
      fx.shake = Math.min(9, fx.shake + 2.2);
    }
  });

  fx.particles = stepParticles(fx.particles, dt, 0.02, 220);
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** Depth cue: the ball shrinks as it flies up-frame into the booth. */
const depthScale = (y: number) => 0.76 + 0.24 * Math.min(1, Math.max(0, (y - 300) / (START.y - 300)));

/** The striped canvas awning with a scalloped valance across the top. */
function drawAwning(ctx: CanvasRenderingContext2D) {
  const bandW = W / 10;
  const hemY = 50;
  for (let i = 0; i < 10; i++) {
    const col = i % 2 === 0 ? '#a31f2b' : '#f0e6cf';
    ctx.fillStyle = col;
    ctx.fillRect(i * bandW, 0, bandW + 0.5, hemY);
    ctx.beginPath();
    ctx.arc(i * bandW + bandW / 2, hemY, bandW / 2, 0, Math.PI);
    ctx.fill();
  }
  // Fabric shading so the canvas reads as hanging, not flat.
  const g = ctx.createLinearGradient(0, 0, 0, hemY + bandW / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, hemY + bandW / 2 + 1);
}

/** A sagging string of bunting flags under the awning (index-derived colors —
 *  no RNG in the draw path). */
function drawBunting(ctx: CanvasRenderingContext2D) {
  const p0 = { x: 6, y: 84 };
  const p1 = { x: W - 6, y: 84 };
  const c = { x: W / 2, y: 108 };
  ctx.strokeStyle = 'rgba(230,215,180,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.quadraticCurveTo(c.x, c.y, p1.x, p1.y);
  ctx.stroke();
  const cols = ['#e8b93b', '#3f7fc1', '#c0455a', '#4d9e63'];
  for (let i = 0; i < 9; i++) {
    const t = 0.08 + (i * 0.84) / 8;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x;
    const y = mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y;
    ctx.fillStyle = cols[i % cols.length];
    ctx.beginPath();
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 13);
    ctx.closePath();
    ctx.fill();
  }
}

/** The wooden barrel the stack stands on: staved body + two steel bands. */
function drawBarrel(ctx: CanvasRenderingContext2D) {
  drawShadow(ctx, CX, BARREL_BOT + 8, 92, 12, 0.35);
  // Body — bulged sides, lengthwise wood gradient.
  ctx.beginPath();
  ctx.moveTo(CX - 79, BARREL_TOP);
  ctx.bezierCurveTo(CX - 89, BARREL_TOP + 42, CX - 89, BARREL_BOT - 30, CX - 75, BARREL_BOT);
  ctx.lineTo(CX + 75, BARREL_BOT);
  ctx.bezierCurveTo(CX + 89, BARREL_BOT - 30, CX + 89, BARREL_TOP + 42, CX + 79, BARREL_TOP);
  ctx.closePath();
  const wood = ctx.createLinearGradient(CX - 89, 0, CX + 89, 0);
  wood.addColorStop(0, '#3a2712');
  wood.addColorStop(0.3, '#6b4a26');
  wood.addColorStop(0.55, '#7d5a30');
  wood.addColorStop(0.8, '#553a1d');
  wood.addColorStop(1, '#2e1e0e');
  ctx.fillStyle = wood;
  ctx.fill();
  // Stave seams.
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1.2;
  for (let k = 1; k < 6; k++) {
    const xt = CX - 79 + (158 / 6) * k;
    const xb = CX - 75 + (150 / 6) * k;
    ctx.beginPath();
    ctx.moveTo(xt, BARREL_TOP + 4);
    ctx.bezierCurveTo(xt + (xt - CX) * 0.06, BARREL_TOP + 50, xb + (xb - CX) * 0.06, BARREL_BOT - 40, xb, BARREL_BOT - 2);
    ctx.stroke();
  }
  // Steel bands with a top highlight.
  for (const y of [BARREL_TOP + 32, BARREL_BOT - 28]) {
    roundRectPath(ctx, CX - 86, y, 172, 9, 3);
    ctx.fillStyle = '#3b4048';
    ctx.fill();
    ctx.fillStyle = 'rgba(210,220,235,0.35)';
    ctx.fillRect(CX - 84, y + 1, 168, 1.6);
  }
  // Barrel head the bottles stand on.
  ctx.beginPath();
  ctx.ellipse(CX, BARREL_TOP, 79, 15, 0, 0, TWO_PI);
  const head = ctx.createLinearGradient(0, BARREL_TOP - 15, 0, BARREL_TOP + 15);
  head.addColorStop(0, '#9a7440');
  head.addColorStop(1, '#5f4322');
  ctx.fillStyle = head;
  ctx.fill();
  ctx.strokeStyle = 'rgba(25,16,8,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** One cream-painted steel milk bottle. Rust flecks and wear are index-derived
 *  so the draw path stays deterministic per frame. */
function drawBottle(ctx: CanvasRenderingContext2D, b: Bottle, i: number) {
  const w = 26;
  const h = 48;
  if (!b.down) drawShadow(ctx, b.x, b.y + h / 2 + 2, w * 0.62, 4, 0.3);
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.rot);
  // Silhouette: cylinder body, shoulder, short neck with a rolled lip.
  ctx.beginPath();
  ctx.moveTo(-w / 2, h / 2);
  ctx.lineTo(-w / 2, -h * 0.06);
  ctx.bezierCurveTo(-w / 2, -h * 0.26, -w * 0.22, -h * 0.26, -w * 0.22, -h * 0.4);
  ctx.lineTo(-w * 0.3, -h * 0.42);
  ctx.lineTo(-w * 0.3, -h / 2);
  ctx.lineTo(w * 0.3, -h / 2);
  ctx.lineTo(w * 0.3, -h * 0.42);
  ctx.lineTo(w * 0.22, -h * 0.4);
  ctx.bezierCurveTo(w * 0.22, -h * 0.26, w / 2, -h * 0.26, w / 2, -h * 0.06);
  ctx.lineTo(w / 2, h / 2);
  ctx.closePath();
  const paint = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  paint.addColorStop(0, '#b8a986');
  paint.addColorStop(0.32, '#f2ead6');
  paint.addColorStop(0.6, '#e6dabd');
  paint.addColorStop(1, '#9d8d6b');
  ctx.fillStyle = paint;
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,48,30,0.55)';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  // Faded painted band near the base.
  ctx.fillStyle = 'rgba(150,42,42,0.35)';
  ctx.fillRect(-w / 2 + 1.5, h * 0.22, w - 3, 5);
  // Rust flecks (deterministic per bottle index).
  ctx.fillStyle = 'rgba(140,74,32,0.55)';
  for (let k = 0; k < 5; k++) {
    const fx = ((i * 53 + k * 29) % 20) / 20;
    const fy = ((i * 31 + k * 41) % 20) / 20;
    ctx.beginPath();
    ctx.arc(-w * 0.35 + fx * w * 0.7, -h * 0.34 + fy * h * 0.74, 0.8 + ((i + k) % 3) * 0.5, 0, TWO_PI);
    ctx.fill();
  }
  // Dull sheen down the lit side — old painted steel, not glass.
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-w * 0.28, -h * 0.34);
  ctx.quadraticCurveTo(-w * 0.34, 0, -w * 0.3, h * 0.36);
  ctx.stroke();
  ctx.restore();
}

/** The softball, shrinking with depth, with its two red stitch seams. */
function drawBall(ctx: CanvasRenderingContext2D, ball: Ball) {
  const sc = depthScale(ball.y);
  const r = 13 * sc;
  drawSphere(ctx, ball.x, ball.y, r, '#fefce8', '#fde047', '#a16207');
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.strokeStyle = 'rgba(185,28,28,0.7)';
  ctx.lineWidth = Math.max(1, 1.4 * sc);
  ctx.beginPath();
  ctx.arc(-r * 1.5, 0, r * 1.75, -0.55, 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r * 1.5, 0, r * 1.75, Math.PI - 0.55, Math.PI + 0.55);
  ctx.stroke();
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);

  // —— Booth backdrop: dusk canvas tent wall ——
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#221629');
  bg.addColorStop(0.5, '#191024');
  bg.addColorStop(1, '#100a18');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Faint canvas-panel stripes.
  ctx.fillStyle = 'rgba(255,235,200,0.03)';
  for (let x = 20; x < W; x += 56) ctx.fillRect(x, 0, 28, H);
  // Warm booth-lamp pool behind the stack.
  const lamp = ctx.createRadialGradient(CX, 280, 20, CX, 280, 240);
  lamp.addColorStop(0, 'rgba(255,196,110,0.16)');
  lamp.addColorStop(1, 'rgba(255,196,110,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, W, H);
  // Plank floor of the booth.
  const floor = ctx.createLinearGradient(0, 452, 0, H);
  floor.addColorStop(0, '#2c1d10');
  floor.addColorStop(1, '#160e07');
  ctx.fillStyle = floor;
  ctx.fillRect(0, 452, W, H - 452);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  for (const y of [472, 494, 518, 542]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  drawAwning(ctx);
  drawBunting(ctx);
  // Back wall of the booth, in the band between the bunting (hangs to ~108) and
  // the top of the bottle pyramid (~197). The full lockup fits here — this is
  // the roomiest wall in the booth set. Warm gold, matching the bunting's own
  // flags, so it reads as booth decor rather than an overlay.
  drawLogo(ctx, W / 2, 152, { width: 150, tint: '#e8b93b', alpha: 0.5 });

  // Vignette for depth.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.74);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // —— Dynamic layer (shaken on knockdowns) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  drawBarrel(ctx);

  // Bottles, far (top) first so the base row fronts the stack.
  const order = gs.bottles.map((_, i) => i).sort((a, b) => gs.bottles[a].y - gs.bottles[b].y);
  for (const i of order) {
    const b = gs.bottles[i];
    if (!b.gone) drawBottle(ctx, b, i);
  }

  // Motion streak behind the thrown ball.
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, (3 + k * 7) * depthScale(t.y), 0, TWO_PI);
    ctx.fillStyle = `rgba(253,224,71,${0.03 + k * 0.13})`;
    ctx.fill();
  }

  // The softball — waiting in the hand, or mid-flight.
  if (gs.phase === 'aim' || gs.phase === 'countdown') {
    drawShadow(ctx, START.x, START.y + 14, 13, 4, 0.3);
    drawBall(ctx, gs.ball);
  } else if (gs.phase === 'live' || gs.phase === 'scored') {
    if (gs.ball.y > -30 && gs.ball.y < H + 30) drawBall(ctx, gs.ball);
  }

  // Flick guide while aiming — direction + power, faded so it stays a hint.
  if (gs.phase === 'aim' && gs.drag.active) {
    const v = launch(gs.drag.dx, gs.drag.dy);
    if (v) {
      const sp = Math.hypot(v.vx, v.vy);
      const len = 46 + ((sp - MIN_V) / (MAX_V - MIN_V)) * 110;
      ctx.save();
      ctx.strokeStyle = 'rgba(251,191,36,0.8)';
      ctx.shadowColor = 'rgba(251,191,36,0.7)';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.setLineDash([6, 7]);
      ctx.beginPath();
      ctx.moveTo(START.x, START.y - 10);
      ctx.lineTo(START.x + (v.vx / sp) * len, START.y - 10 + (v.vy / sp) * len);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
  ctx.restore();

  // —— Knockdown flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha('#fbbf24', fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }

  // "3, 2, 1, GO!" countdown before the first throw.
  if (gs.phase === 'countdown') {
    const left = COUNTDOWN_MS - (now - gs.countStart);
    const n = Math.ceil((left - GO_MS) / COUNT_STEP_MS);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = 'rgba(251,191,36,0.7)';
    ctx.shadowBlur = 18;
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n > 3 ? '3' : n <= 0 ? 'GO!' : String(n), W / 2, H / 2);
    ctx.restore();
  }

  // Cabinet finish, last of all: scanlines + a tube vignette over the
  // finished frame. The bezel and bloom around the screen are CSS
  // (.arcade-screen); this is the half that has to composite onto the
  // pixels, which CSS cannot do to a <canvas>.
  drawScreenVeil(ctx, W, H);
}

export default function MilkBottle() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());
  const nextTimer = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('ready');
  const [rack, setRack] = useState(0);
  const [throwNo, setThrowNo] = useState(0);
  const [score, setScore] = useState(0);
  const [note, setNote] = useState('');
  // One id per played round — the ticket award's idempotency key.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const active = phase !== 'done';
  useFitCanvas(canvasRef, W, H, active);

  // The pause on the result elapsed: hand out the next ball, rack, or scorecard.
  const advance = useCallback(() => {
    const gs = gsRef.current;
    const cleared = gs.bottles.every((b) => b.down);
    gs.ball = freshBall();
    if (gs.throwNo === 0 && !cleared) {
      gs.throwNo = 1;
      gs.phase = 'aim';
      setThrowNo(1);
      setPhase('aim');
      return;
    }
    gs.rack += 1;
    if (gs.rack >= RACKS) {
      gs.phase = 'done';
      setPhase('done');
      playFanfare();
      return;
    }
    gs.bottles = makeBottles();
    fxRef.current.downSeen.clear();
    gs.throwNo = 0;
    gs.downAtThrowStart = 0;
    gs.phase = 'aim';
    setRack(gs.rack);
    setThrowNo(0);
    setPhase('aim');
  }, []);

  // The throw is over: score the newly-downed bottles and queue what's next.
  const settleThrow = useCallback(() => {
    const gs = gsRef.current;
    const fx = fxRef.current;
    const totalDown = downedCount(gs.bottles);
    const newly = totalDown - gs.downAtThrowStart;
    const cleared = totalDown === gs.bottles.length;
    const sweep = cleared && gs.throwNo === 0;
    gs.score += newly + (sweep ? SWEEP_BONUS : 0);

    let note: string;
    if (sweep) {
      note = `CLEAN SWEEP! +${gs.bottles.length + SWEEP_BONUS}`;
      spawnFloater(fx.floaters, W / 2, 236, 'CLEAN SWEEP!', '#fbbf24', { size: 26, life: 1100 });
      spawnFloater(fx.floaters, W / 2, 268, `+${gs.bottles.length + SWEEP_BONUS}`, '#fde68a', { size: 22, life: 1100 });
      fx.flash = 1;
      fx.shake = Math.max(fx.shake, 9);
      spawnBurst(fx.particles, CX, 270, 34, 320, '#fde68a');
      spawnBurst(fx.particles, CX, 270, 18, 180, '#f1e5c8');
      playFanfare();
    } else if (cleared) {
      note = `Rack cleared! +${newly}`;
      spawnFloater(fx.floaters, W / 2, 244, `+${newly}`, '#4ade80', { size: 24, life: 900 });
      fx.flash = 0.6;
      spawnBurst(fx.particles, CX, 270, 22, 240, '#bbf7d0');
      playCup();
    } else if (newly > 0) {
      note = `${newly} down!`;
      spawnFloater(fx.floaters, W / 2, 244, `+${newly}`, '#fde68a', { size: 22, life: 800 });
      spawnBurst(fx.particles, CX, 280, 6 + newly * 4, 140 + newly * 30, '#f1e5c8');
      playDing();
    } else {
      note = 'Thud. Those bottles are heavy.';
      spawnFloater(fx.floaters, W / 2, 244, 'MISS', '#94a3b8', { size: 20, life: 700 });
      playUndo();
    }

    gs.note = note;
    gs.phase = 'scored';
    setScore(gs.score);
    setNote(note);
    setPhase('scored');
    nextTimer.current = window.setTimeout(advance, NEXT_DELAY_MS);
  }, [advance]);

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
    // Pause via visibilitychange, not a hidden-rAF branch: mobile browsers can
    // fully suspend requestAnimationFrame while backgrounded, so a hidden frame
    // may never run. Shift the countdown/throw time bases by the away span so
    // hidden time can't skip the countdown or expire a live throw.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const away = performance.now() - hiddenAt;
        const gs = gsRef.current;
        gs.countStart += away;
        gs.liveStart += away;
        hiddenAt = 0;
        last = performance.now();
        acc = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const frame = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(now - last, 100);
      acc += dt;
      last = now;

      if (gs.phase === 'countdown' && now - gs.countStart >= COUNTDOWN_MS) {
        gs.phase = 'aim';
        setPhase('aim');
      }

      while (acc >= FIXED) {
        if (gs.phase === 'live' || gs.phase === 'scored') step(gs, now);
        acc -= FIXED;
      }

      if (gs.phase === 'live') {
        const ballOut = gs.ball.y > H + 40 || gs.ball.y < -60 || gs.ball.x < -40 || gs.ball.x > W + 40;
        const settled = gs.bottles.every((b) => !b.down || b.gone);
        if ((ballOut && settled) || now - gs.liveStart > MAX_LIVE_MS) settleThrow();
      }

      updateFX(fxRef.current, gs, dt);
      draw(ctx, gs, fxRef.current, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, settleThrow]);

  useEffect(() => {
    return () => {
      if (nextTimer.current) clearTimeout(nextTimer.current);
    };
  }, []);

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
    if (gs.phase !== 'aim') return;
    const v = launch(gs.drag.dx, gs.drag.dy);
    if (!v) return; // not a valid flick — ball not consumed
    gs.ball.vx = v.vx;
    gs.ball.vy = v.vy;
    gs.downAtThrowStart = downedCount(gs.bottles);
    gs.phase = 'live';
    gs.liveStart = performance.now();
    setPhase('live');
    setNote('');
    // Rendering-only release puff off the hand.
    const fx = fxRef.current;
    fx.trail.length = 0;
    spawnBurst(fx.particles, START.x, START.y, 8, 130, '#fde68a');
    playStroke();
  }, []);

  const start = useCallback(() => {
    if (nextTimer.current) clearTimeout(nextTimer.current);
    const gs = freshGS();
    gs.phase = 'countdown';
    gs.countStart = performance.now();
    gsRef.current = gs;
    fxRef.current = freshFX();
    setPhase('countdown');
    setRack(0);
    setThrowNo(0);
    setScore(0);
    setNote('');
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    const remark =
      score >= 26 ? "Carnie's nightmare! 🎪" : score >= 18 ? 'Deadly arm! 💪' : score >= 10 ? "Nice chuckin'! 👍" : "Keep slingin'! 🎮";
    return (
      <Screen>
        <TopBar title="Milk Bottles" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🥎</span>
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">across {RACKS} racks</p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (2 tickets per point — a bottle is 1, the clean-sweep bonus 5). */}
          <GameTicketAward game="milkbottle" tickets={score * 2} sessionId={sessionId} />
          <GameHighScore game="milkbottle" score={score} sessionId={sessionId} />
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
      ? 'Flick the softball into the stack — low and hard topples the lot.'
      : phase === 'countdown'
        ? 'Get ready…'
        : phase === 'aim'
          ? throwNo === 0
            ? 'Flick low and hard — take out the bottom row.'
            : 'Second ball — clean up the stragglers.'
          : phase === 'live'
            ? 'Airborne…'
            : note;

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Milk Bottles" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Rack <span className="text-fairway-100">{Math.min(rack + 1, RACKS)}</span>
          <span className="font-normal text-fairway-400"> / {RACKS}</span>
          <span className="font-normal text-fairway-400"> · Throw {Math.min(throwNo + 1, THROWS_PER_RACK)}/{THROWS_PER_RACK}</span>
        </span>
        <span className="text-fairway-300">
          Score <span className="font-bold text-fairway-100">{score}</span>
        </span>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="col-start-1 row-start-1 block touch-none rounded-2xl arcade-screen"
        />
        {phase === 'ready' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <span className="text-5xl">🥎</span>
            <p className="text-sm text-fairway-100">
              Flick the softball to topple the bottles — hit the base row square and the whole stack goes. {RACKS} racks,{' '}
              {THROWS_PER_RACK} throws each; sweep all six with the first ball for a bonus.
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
