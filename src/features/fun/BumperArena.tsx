import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playBump, playWaterBump, playScore, playFanfare } from '../../lib/sound';
import type { Vec as FxVec } from './fx';
import { TWO_PI, withAlpha, roundRectPath, drawShadow, drawSphere, pushTrail, decay, shakeOffset } from './fx';

// §12 Bumper arena — the shared engine behind Bumper Cars and Bumper Boats.
// Drive with a floating joystick and ram the other units; land as many solid
// bumps as you can before the 30-second horn. Top-down real-time canvas physics,
// client-side, offline. A `BumperTheme` swaps the visuals + handling so cars
// (grippy, on a rink) and boats (floaty, on water) share one implementation.
//
// Fixed-timestep accumulator (framerate-independent, no tunneling); the clock
// pauses when backgrounded, like the other games. Units are equal-mass circles
// that collide elastically; a bump only scores when YOU drive into another unit
// hard enough (rewarding aggression, not getting shoved).

// —— Shared arena constants (logical units; the canvas scales to fit) —————————
const W = 340;
const H = 560;
const UNIT_R = 26;
const N_AI = 4;
const FIXED = 1000 / 120; // physics substep (ms)
const WALL_E = 0.6; // wall bounce restitution
const UNIT_E = 0.92; // unit-unit restitution
const JOY_MAX = 60; // joystick travel (field units) for full throttle
const BUMP_COOLDOWN = 450; // ms before the same unit can be bumped again
const GAME_MS = 30000;

// Boat-only water FX.
const RIPPLE_INTERVAL = 85; // ms between wake ripples dropped by a moving boat
const RIPPLE_LIFE = 1300; // ms a wake ripple lingers (long trail)
const RIPPLE_MIN_SPEED = 0.8; // boat must be moving this fast to leave a wake
const SPLASH_LIFE = 560; // ms a splash droplet lives
const SPLASH_MIN_GAP = 55; // ms throttle between splash bursts

// Car-only bump FX.
const SPARK_LIFE = 340; // ms a bump spark lives (quick pop)
const SPARK_MIN_GAP = 45; // ms throttle between spark bursts

/** Per-game skin + handling. Everything that differs between cars and boats. */
export type BumperTheme = {
  title: string;
  emoji: string;
  kind: 'car' | 'boat';
  playerColor: string;
  aiColors: string[];
  hint: string;
  remark: (score: number) => string;
  // Handling (boats are floatier: less damping, gentler thrust).
  friction: number;
  accel: number;
  maxSpeed: number;
  aiAccel: number;
  aiMax: number;
  bumpSpeed: number; // closing speed that counts as a solid bump (lower = easier)
};

type Unit = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  tx: number; // AI wander target (unused for the player)
  ty: number;
  retargetAt: number;
  lastRipple: number; // last time this unit dropped a wake ripple
};
type Ripple = { x: number; y: number; born: number }; // expanding wake ring
type Splash = { x: number; y: number; vx: number; vy: number; born: number }; // droplet
type Spark = { x: number; y: number; vx: number; vy: number; born: number }; // bump spark
type Joystick = { active: boolean; ox: number; oy: number; kx: number; ky: number };
type Phase = 'play' | 'done';
type GS = {
  phase: Phase;
  units: Unit[]; // [0] = player, rest = AI
  score: number;
  elapsed: number; // ms of active play
  joy: Joystick;
  lastBump: number[]; // per-AI-index cooldown timestamps
  lastSound: number;
  ripples: Ripple[]; // boat wake trail
  splashes: Splash[]; // droplets thrown up by a bump
  lastSplash: number; // throttle for splash bursts
  sparks: Spark[]; // sparks flung out by a car bump
  lastSpark: number; // throttle for spark bursts
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function freshGS(theme: BumperTheme): GS {
  const player: Unit = { x: W / 2, y: H - 90, vx: 0, vy: 0, color: theme.playerColor, tx: 0, ty: 0, retargetAt: 0, lastRipple: 0 };
  const units: Unit[] = [player];
  // Space the AI units across the upper arena so they don't start overlapping.
  const spots = [
    { x: W * 0.28, y: H * 0.22 },
    { x: W * 0.72, y: H * 0.22 },
    { x: W * 0.3, y: H * 0.48 },
    { x: W * 0.7, y: H * 0.48 },
  ];
  for (let i = 0; i < N_AI; i++) {
    units.push({
      x: spots[i].x,
      y: spots[i].y,
      vx: 0,
      vy: 0,
      color: theme.aiColors[i % theme.aiColors.length],
      tx: rnd(UNIT_R, W - UNIT_R),
      ty: rnd(UNIT_R, H - UNIT_R),
      retargetAt: 0,
      lastRipple: 0,
    });
  }
  return {
    phase: 'play',
    units,
    score: 0,
    elapsed: 0,
    joy: { active: false, ox: 0, oy: 0, kx: 0, ky: 0 },
    lastBump: new Array(N_AI + 1).fill(-1e9),
    lastSound: -1e9,
    ripples: [],
    splashes: [],
    lastSplash: -1e9,
    sparks: [],
    lastSpark: -1e9,
  };
}

function capSpeed(c: Unit, max: number) {
  const s = Math.hypot(c.vx, c.vy);
  if (s > max) {
    c.vx = (c.vx / s) * max;
    c.vy = (c.vy / s) * max;
  }
}

function wallBounce(c: Unit) {
  if (c.x < UNIT_R) {
    c.x = UNIT_R;
    c.vx = Math.abs(c.vx) * WALL_E;
  } else if (c.x > W - UNIT_R) {
    c.x = W - UNIT_R;
    c.vx = -Math.abs(c.vx) * WALL_E;
  }
  if (c.y < UNIT_R) {
    c.y = UNIT_R;
    c.vy = Math.abs(c.vy) * WALL_E;
  } else if (c.y > H - UNIT_R) {
    c.y = H - UNIT_R;
    c.vy = -Math.abs(c.vy) * WALL_E;
  }
}

/** One physics substep at time `now` (ms). */
function step(gs: GS, now: number, theme: BumperTheme) {
  const units = gs.units;
  const player = units[0];

  // Player thrust from the joystick.
  if (gs.joy.active) {
    const dx = gs.joy.kx - gs.joy.ox;
    const dy = gs.joy.ky - gs.joy.oy;
    const len = Math.hypot(dx, dy);
    if (len > 4) {
      const throttle = Math.min(len / JOY_MAX, 1);
      player.vx += (dx / len) * theme.accel * throttle;
      player.vy += (dy / len) * theme.accel * throttle;
    }
  }

  // AI wander: steer toward a target, repicking periodically.
  for (let i = 1; i < units.length; i++) {
    const c = units[i];
    if (now >= c.retargetAt || Math.hypot(c.tx - c.x, c.ty - c.y) < 40) {
      c.tx = rnd(UNIT_R, W - UNIT_R);
      c.ty = rnd(UNIT_R, H - UNIT_R);
      c.retargetAt = now + rnd(900, 2000);
    }
    const dx = c.tx - c.x;
    const dy = c.ty - c.y;
    const d = Math.hypot(dx, dy) || 1;
    c.vx += (dx / d) * theme.aiAccel;
    c.vy += (dy / d) * theme.aiAccel;
  }

  // Integrate + friction + walls + speed caps.
  for (let i = 0; i < units.length; i++) {
    const c = units[i];
    c.vx *= theme.friction;
    c.vy *= theme.friction;
    capSpeed(c, i === 0 ? theme.maxSpeed : theme.aiMax);
    c.x += c.vx;
    c.y += c.vy;
    wallBounce(c);
    // Boats leave a wake: drop an expanding ripple behind the stern while moving.
    if (theme.kind === 'boat') {
      const sp = Math.hypot(c.vx, c.vy);
      if (sp > RIPPLE_MIN_SPEED && now - c.lastRipple > RIPPLE_INTERVAL) {
        c.lastRipple = now;
        gs.ripples.push({ x: c.x - (c.vx / sp) * (UNIT_R - 4), y: c.y - (c.vy / sp) * (UNIT_R - 4), born: now });
      }
    }
  }

  // Unit-unit collisions (equal mass, elastic with restitution).
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const min = UNIT_R * 2;
      if (dist >= min) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      // Player's approach speed toward this unit, captured BEFORE the impulse
      // below cancels it out. For an equal-mass hit the impulse reduces the
      // player's normal velocity to a fraction of its incoming value, so a
      // post-impulse test would never register an ordinary player-driven ram.
      const playerIntoAi = a.vx * nx + a.vy * ny;
      // Separate equally.
      const overlap = min - dist;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; // <0 => approaching
      const closing = -rel;
      if (rel < 0) {
        const jimp = (-(1 + UNIT_E) * rel) / 2; // equal mass
        a.vx -= jimp * nx;
        a.vy -= jimp * ny;
        b.vx += jimp * nx;
        b.vy += jimp * ny;
      }
      // A hard enough hit throws up FX at the contact point (a splash for boats,
      // a spark burst for cars) and plays a themed bump sound scaled by the
      // closing speed, throttled so a pile-up doesn't machine-gun the audio.
      if (closing > theme.bumpSpeed) {
        const cx = a.x + nx * UNIT_R;
        const cy = a.y + ny * UNIT_R;
        if (theme.kind === 'boat' && now - gs.lastSplash > SPLASH_MIN_GAP) {
          gs.lastSplash = now;
          spawnSplash(gs, cx, cy, now, closing);
        } else if (theme.kind === 'car' && now - gs.lastSpark > SPARK_MIN_GAP) {
          gs.lastSpark = now;
          spawnSparks(gs, cx, cy, now, closing);
        }
        if (now - gs.lastSound > 70) {
          gs.lastSound = now;
          const intensity = Math.min(1.4, 0.5 + closing * 0.13);
          if (theme.kind === 'boat') playWaterBump(intensity);
          else playBump(intensity);
        }
      }
      // Scoring: player (index 0) drives into an AI hard enough.
      if (i === 0 && closing > theme.bumpSpeed) {
        const aiIdx = j;
        if (playerIntoAi > 0.4 && now - gs.lastBump[aiIdx] > BUMP_COOLDOWN) {
          gs.score += 1;
          gs.lastBump[aiIdx] = now;
          // Bright accent on top of the bump thud so a scoring hit stands out.
          playScore();
        }
      }
    }
  }
}

/** Throw a ring of droplets outward from a bump's contact point. */
function spawnSplash(gs: GS, x: number, y: number, now: number, closing: number) {
  const n = 8;
  const power = 0.7 + Math.min(closing, 6) * 0.16;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.random() * 0.5;
    const spd = power * (0.7 + Math.random() * 0.8);
    gs.splashes.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, born: now });
  }
  // Keep the pool bounded even under heavy contact.
  if (gs.splashes.length > 200) gs.splashes.splice(0, gs.splashes.length - 200);
}

/** Fling a small burst of sparks outward from a car bump's contact point. */
function spawnSparks(gs: GS, x: number, y: number, now: number, closing: number) {
  const n = 7;
  const power = 1.1 + Math.min(closing, 6) * 0.28;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.random() * 0.7;
    const spd = power * (0.6 + Math.random() * 0.9);
    gs.sparks.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, born: now });
  }
  // Keep the pool bounded even under heavy contact.
  if (gs.sparks.length > 200) gs.sparks.splice(0, gs.sparks.length - 200);
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live OUTSIDE GS so the fixed-timestep sim is never touched. They're
// advanced per animation frame with a real dt and only ever paint pixels:
// per-unit motion trails (skid marks / wakes), a decaying screen-shake on hard
// contact, and a flash on a scoring bump. Events are detected by watching values
// the sim already updates (score, the spark/splash spawn timestamps) — the
// physics and scoring paths are left completely alone.
type FX = {
  trails: FxVec[][]; // one capped motion trail per unit (index-aligned with gs.units)
  shake: number; // camera-shake magnitude (px), decays to 0
  flash: number; // scoring-bump flash 0..1, decays to 0
  flashColor: string;
  prevScore: number;
  prevSpark: number; // last-seen gs.lastSpark timestamp
  prevSplash: number; // last-seen gs.lastSplash timestamp
};

function freshFX(nUnits: number): FX {
  return {
    trails: Array.from({ length: nUnits }, () => [] as FxVec[]),
    shake: 0,
    flash: 0,
    flashColor: '#ffffff',
    prevScore: 0,
    prevSpark: -1e9,
    prevSplash: -1e9,
  };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). Reacts to
 *  events that already happened in the sim this frame. */
function updateFX(fx: FX, gs: GS, theme: BumperTheme, dt: number) {
  // Trails: extend while a unit is moving, fade (shift out) once it stops.
  for (let i = 0; i < gs.units.length && i < fx.trails.length; i++) {
    const c = gs.units[i];
    if (Math.hypot(c.vx, c.vy) > 0.6) pushTrail(fx.trails[i], c.x, c.y, 12);
    else if (fx.trails[i].length) fx.trails[i].shift();
  }
  // Event → shake/flash (thresholds don't feed back into gameplay).
  if (gs.score !== fx.prevScore) {
    fx.prevScore = gs.score;
    fx.shake = Math.max(fx.shake, 5.5);
    fx.flash = 1;
    fx.flashColor = theme.kind === 'boat' ? '#7dd3fc' : '#fdba74';
  }
  if (gs.lastSpark !== fx.prevSpark) {
    fx.prevSpark = gs.lastSpark;
    fx.shake = Math.max(fx.shake, 3);
  }
  if (gs.lastSplash !== fx.prevSplash) {
    fx.prevSplash = gs.lastSplash;
    fx.shake = Math.max(fx.shake, 2.5);
  }
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.004);
}

/** Lighten/darken a `#rrggbb` toward white/black by `t` (0..1). */
function shade(hex: string, t: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (t >= 0) {
    r += (255 - r) * t;
    g += (255 - g) * t;
    b += (255 - b) * t;
  } else {
    const k = 1 + t;
    r *= k;
    g *= k;
    b *= k;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// —— drawing —————————————————————————————————————————————————————————————————
/** Trace a 5-pointed star centered at (cx, cy) with the given outer radius. */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const inner = r * 0.5;
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? r : inner;
    // Start at the top point (-90°) and step every 36°.
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawUnit(ctx: CanvasRenderingContext2D, c: Unit, isPlayer: boolean, theme: BumperTheme) {
  const speed = Math.hypot(c.vx, c.vy);
  const nx = speed > 0.3 ? c.vx / speed : 0;
  const ny = speed > 0.3 ? c.vy / speed : 0;
  const boat = theme.kind === 'boat';

  // Contact shadow (cars) / soft hull reflection on the water (boats).
  drawShadow(ctx, c.x, c.y + (boat ? 4 : 6), UNIT_R * 0.95, UNIT_R * (boat ? 0.55 : 0.5), boat ? 0.18 : 0.34);

  // Player highlight: a glowing ring so your unit reads instantly.
  if (isPlayer) {
    ctx.save();
    ctx.strokeStyle = withAlpha('#facc15', 0.9);
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, UNIT_R + 2.5, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  // Bumper ring (rubber tube for a boat, fender for a car): dark base + lit
  // colored fender so the rim catches the overhead light.
  ctx.beginPath();
  ctx.arc(c.x, c.y, UNIT_R, 0, TWO_PI);
  ctx.fillStyle = boat ? '#0b2a44' : isPlayer ? '#052e16' : '#0d1424';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = shade(c.color, 0.12);
  ctx.stroke();

  // Lit domed body via a top-left radial gradient.
  drawSphere(ctx, c.x, c.y, UNIT_R - 8, shade(c.color, 0.55), c.color, shade(c.color, -0.45), {
    specular: true,
    rim: isPlayer,
  });

  if (boat) {
    // Dark cockpit well so it reads as a seat, not a solid disc.
    ctx.beginPath();
    ctx.arc(c.x, c.y, UNIT_R - 14, 0, TWO_PI);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
  }

  // Heading nub in the direction of travel.
  if (speed > 0.3) {
    ctx.beginPath();
    ctx.arc(c.x + nx * (UNIT_R - 6), c.y + ny * (UNIT_R - 6), 4, 0, TWO_PI);
    ctx.fillStyle = '#0b0f14';
    ctx.fill();
  }

  // Glowing yellow star centered on the active player.
  if (isPlayer) {
    ctx.save();
    ctx.shadowColor = 'rgba(250,204,21,0.8)';
    ctx.shadowBlur = 8;
    starPath(ctx, c.x, c.y, UNIT_R - 11);
    ctx.fillStyle = '#facc15';
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#78350f';
    ctx.stroke();
  }
}

/** A capped motion trail behind a unit: dark skid streak (cars) / bright wake
 *  (boats), widening and fading toward the unit. */
function drawTrail(ctx: CanvasRenderingContext2D, trail: FxVec[], boat: boolean) {
  if (trail.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 1; i < trail.length; i++) {
    const k = i / trail.length;
    const a = trail[i - 1];
    const b = trail[i];
    ctx.strokeStyle = boat ? `rgba(219,234,254,${k * 0.16})` : `rgba(20,22,30,${k * 0.3})`;
    ctx.lineWidth = (boat ? 7 : 6) * k;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Paint the lit arena floor (gradient + sheen + accents + vignette) and its
 *  rounded, glowing rail. Purely cosmetic; identical bounds for both variants. */
function drawArena(ctx: CanvasRenderingContext2D, theme: BumperTheme, now: number) {
  const boat = theme.kind === 'boat';
  const accent = boat ? '#0ea5e9' : '#f97316';

  const surf = ctx.createLinearGradient(0, 0, 0, H);
  if (boat) {
    surf.addColorStop(0, '#0c4a6e');
    surf.addColorStop(0.5, '#075985');
    surf.addColorStop(1, '#0a3350');
  } else {
    surf.addColorStop(0, '#1b2942');
    surf.addColorStop(0.5, '#111c30');
    surf.addColorStop(1, '#0b1220');
  }
  ctx.fillStyle = surf;
  ctx.fillRect(0, 0, W, H);

  if (boat) {
    // Drifting water: sine bands that slowly slide, plus a couple of soft
    // sun-glint highlights so the surface reads as living water.
    const drift = now * 0.0012;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    for (let y = 24; y < H; y += 34) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 20) {
        const yy = y + Math.sin((x / W) * Math.PI * 4 + drift + y * 0.05) * 3;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 2; i++) {
      const gx = W * (0.32 + i * 0.4) + Math.sin(drift + i) * 18;
      const gy = H * (0.3 + i * 0.4);
      const glint = ctx.createRadialGradient(gx, gy, 6, gx, gy, 120);
      glint.addColorStop(0, 'rgba(186,230,253,0.14)');
      glint.addColorStop(1, 'rgba(186,230,253,0)');
      ctx.fillStyle = glint;
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    // Glossy rink: a faint grid for a sense of motion under a warm sheen.
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 40; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 40; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    const sheen = ctx.createRadialGradient(W / 2, H * 0.3, 20, W / 2, H * 0.3, H * 0.75);
    sheen.addColorStop(0, 'rgba(249,115,22,0.1)');
    sheen.addColorStop(1, 'rgba(249,115,22,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);
  }

  // Corner vignette for depth.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // Rounded wall: dark bevel under a glowing accent rail.
  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeStyle = boat ? 'rgba(6,25,40,0.9)' : 'rgba(8,12,22,0.9)';
  roundRectPath(ctx, 4, 4, W - 8, H - 8, 18);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = withAlpha(accent, 0.6);
  ctx.shadowColor = accent;
  ctx.shadowBlur = 12;
  roundRectPath(ctx, 6, 6, W - 12, H - 12, 16);
  ctx.stroke();
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, theme: BumperTheme, now: number, fx: FX) {
  const boat = theme.kind === 'boat';
  ctx.clearRect(0, 0, W, H);

  drawArena(ctx, theme, now);

  // —— Dynamic layer: everything that moves, shaken on a hard bump ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Boat wake: fading, expanding rings drawn under the boats.
  if (boat) {
    ctx.strokeStyle = '#dbeafe';
    ctx.lineWidth = 2;
    for (const rp of gs.ripples) {
      const age = now - rp.born;
      if (age < 0 || age > RIPPLE_LIFE) continue;
      const t = age / RIPPLE_LIFE;
      ctx.globalAlpha = (1 - t) * 0.3;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 5 + t * 22, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Per-unit motion trails (skid / wake), under the units.
  for (let i = 0; i < gs.units.length && i < fx.trails.length; i++) drawTrail(ctx, fx.trails[i], boat);

  for (let i = gs.units.length - 1; i >= 0; i--) drawUnit(ctx, gs.units[i], i === 0, theme);

  // Splash droplets thrown up by bumps, drawn over the boats (additive foam).
  if (boat) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#eff6ff';
    for (const s of gs.splashes) {
      const age = now - s.born;
      if (age < 0 || age > SPLASH_LIFE) continue;
      const t = age / SPLASH_LIFE;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.arc(s.x + s.vx * age * 0.05, s.y + s.vy * age * 0.05, 3 * (1 - t) + 0.8, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Spark burst thrown off by car bumps, drawn over the cars (additive).
  if (!boat) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of gs.sparks) {
      const age = now - s.born;
      if (age < 0 || age > SPARK_LIFE) continue;
      const t = age / SPARK_LIFE;
      // Sparks fade warm from white to amber as they fly out and shrink.
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = t < 0.4 ? '#fef9c3' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(s.x + s.vx * age * 0.06, s.y + s.vy * age * 0.06, 2.4 * (1 - t) + 0.6, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  ctx.restore(); // end dynamic layer

  // Scoring-bump flash overlay.
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.16);
    ctx.fillRect(0, 0, W, H);
  }

  // Joystick (UI — outside the shake).
  if (gs.joy.active) {
    const kx = clamp(gs.joy.kx, gs.joy.ox - JOY_MAX, gs.joy.ox + JOY_MAX);
    const ky = clamp(gs.joy.ky, gs.joy.oy - JOY_MAX, gs.joy.oy + JOY_MAX);
    ctx.beginPath();
    ctx.arc(gs.joy.ox, gs.joy.oy, JOY_MAX, 0, TWO_PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(kx, ky, 20, 0, TWO_PI);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
  }
}

export default function BumperArena({ theme }: { theme: BumperTheme }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS(theme));
  const fxRef = useRef<FX>(freshFX(N_AI + 1));

  const [phase, setPhase] = useState<Phase>('play');
  const [score, setScore] = useState(0);
  const [secs, setSecs] = useState(GAME_MS / 1000);

  const playing = phase !== 'done';

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
    let pushedScore = -1;
    let pushedSecs = -1;
    const frame = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(now - last, 100);
      last = now;
      acc += dt;
      gs.elapsed += dt;

      while (acc >= FIXED) {
        if (gs.phase === 'play') step(gs, now, theme);
        acc -= FIXED;
      }

      // Age out FX so the pools stay small.
      if (theme.kind === 'boat') {
        if (gs.ripples.length) gs.ripples = gs.ripples.filter((r) => now - r.born <= RIPPLE_LIFE);
        if (gs.splashes.length) gs.splashes = gs.splashes.filter((s) => now - s.born <= SPLASH_LIFE);
      } else if (theme.kind === 'car') {
        if (gs.sparks.length) gs.sparks = gs.sparks.filter((s) => now - s.born <= SPARK_LIFE);
      }

      if (gs.score !== pushedScore) {
        pushedScore = gs.score;
        setScore(gs.score);
      }
      const remain = Math.max(0, Math.ceil((GAME_MS - gs.elapsed) / 1000));
      if (remain !== pushedSecs) {
        pushedSecs = remain;
        setSecs(remain);
      }

      if (gs.elapsed >= GAME_MS) {
        gs.phase = 'done';
        setPhase('done');
        playFanfare();
      }

      updateFX(fxRef.current, gs, theme, dt);
      draw(ctx, gs, theme, now, fxRef.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // Re-inits only when the play view mounts; the loop reads gsRef and pushes
    // React state only when a mirrored value (score/secs) actually changes.
  }, [playing, theme]);

  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const p = toField(e);
      gsRef.current.joy = { active: true, ox: p.x, oy: p.y, kx: p.x, ky: p.y };
      canvasRef.current?.setPointerCapture(e.pointerId);
    },
    [toField],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (!gs.joy.active) return;
      const p = toField(e);
      gs.joy.kx = p.x;
      gs.joy.ky = p.y;
    },
    [toField],
  );
  const onPointerUp = useCallback(() => {
    gsRef.current.joy.active = false;
  }, []);

  const restart = useCallback(() => {
    gsRef.current = freshGS(theme);
    fxRef.current = freshFX(N_AI + 1);
    setScore(0);
    setSecs(GAME_MS / 1000);
    setPhase('play');
  }, [theme]);

  if (phase === 'done') {
    return (
      <Screen>
        <TopBar title={theme.title} back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">{theme.emoji}</span>
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{theme.remark(score)}</p>
            <p className="text-sm text-fairway-400">bumps in 30 seconds</p>
          </div>
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
    <Screen>
      <TopBar title={theme.title} back="/fun" />
      <Content>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-green-400">Bumps {score}</span>
          <span className={`font-bold ${secs <= 5 ? 'text-red-400' : 'text-fairway-300'}`}>⏱ {secs}s</span>
        </div>

        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="block w-full touch-none rounded-2xl border border-fairway-800"
          style={{ aspectRatio: `${W} / ${H}` }}
        />

        <p className="mt-3 min-h-[2.5rem] text-center text-sm text-fairway-100/80">{theme.hint}</p>
      </Content>
    </Screen>
  );
}
