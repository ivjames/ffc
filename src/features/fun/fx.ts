// Shared "juice" toolkit for the Fun Zone canvas games.
//
// These are rendering-only helpers — gradient spheres, soft contact shadows,
// neon strokes, a small particle system, motion trails, and decaying scalars
// for screen-shake / flash. NONE of it touches game state: each game keeps its
// own fixed-timestep sim and calls these purely from its draw loop, so the look
// can be overhauled without any gameplay risk. See AirHockey.tsx for the
// canonical usage (an `fxRef` holding particles/shake/flash/trail, advanced per
// animation frame with a real `dt`).

export const TWO_PI = Math.PI * 2;

// FX randomness runs on its OWN PRNG so rendering (spark bursts, screen-shake)
// never draws from the global Math.random() sequence the game sims use for
// gameplay (serves, pitch timing, AI, …). Sharing that sequence would let a
// frame-rate-dependent burst count shift later gameplay RNG — breaking the
// "rendering-only" guarantee. Games route effect-only randomness through
// fxRandom() for the same reason. Determinism of the effects themselves isn't
// required; isolation from the gameplay stream is.
let fxSeed = 0x9e3779b9 >>> 0;
export function fxRandom(): number {
  // mulberry32 — tiny, fast, self-contained.
  fxSeed = (fxSeed + 0x6d2b79f5) >>> 0;
  let t = fxSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export type Vec = { x: number; y: number };

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // ms remaining
  max: number; // ms total (for alpha falloff)
  r: number;
  color: string;
};

// —— color ————————————————————————————————————————————————————————————————————
/** Convert `#rgb` / `#rrggbb` to an `rgba()` string with the given alpha. */
export function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// —— paths ————————————————————————————————————————————————————————————————————
/** Trace a rounded-rect path (caller fills/strokes). */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// —— lit primitives ———————————————————————————————————————————————————————————
/** A soft elliptical ground/contact shadow, centered at (x, y). */
export function drawShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha = 0.35,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TWO_PI);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fill();
}

export type SphereOpts = {
  specular?: boolean; // bright top-left hotspot (default true)
  rim?: boolean; // subtle top-left rim highlight arc (default false)
};

/** A top-lit sphere: radial body (light→base→dark) with an optional specular
 *  hotspot and rim highlight. The workhorse for balls, pucks, mallets, cars,
 *  bumper boats — anything round that should read as a lit 3D object. */
export function drawSphere(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  light: string,
  base: string,
  dark: string,
  opts: SphereOpts = {},
): void {
  const { specular = true, rim = false } = opts;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.12, x, y, r);
  g.addColorStop(0, light);
  g.addColorStop(0.6, base);
  g.addColorStop(1, dark);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fillStyle = g;
  ctx.fill();

  if (rim) {
    ctx.beginPath();
    ctx.arc(x, y, r - Math.max(1, r * 0.06), Math.PI * 1.05, Math.PI * 1.6);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.stroke();
  }

  if (specular) {
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.36, r * 0.22, 0, TWO_PI);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
  }
}

/** A glowing neon line (uses shadowBlur; isolated in save/restore). */
export function neonLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 4,
  blur = 14,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

// —— particles ————————————————————————————————————————————————————————————————
/** Spawn an outward spark burst of `n` particles into `list`. */
export function spawnBurst(
  list: Particle[],
  x: number,
  y: number,
  n: number,
  speed: number,
  color: string,
): void {
  for (let i = 0; i < n; i++) {
    const a = fxRandom() * TWO_PI;
    const s = speed * (0.35 + fxRandom() * 0.65);
    const max = 260 + fxRandom() * 300;
    list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: max, max, r: 1.4 + fxRandom() * 2.6, color });
  }
}

/** Advance particles by `dt` ms (framerate-correct) and return the survivors.
 *  `damp` is the per-second velocity multiplier; `gravity` in units/s². */
export function stepParticles(list: Particle[], dt: number, damp = 0.02, gravity = 0): Particle[] {
  const dts = dt / 1000;
  const k = Math.pow(damp, dts);
  for (const p of list) {
    p.x += p.vx * dts;
    p.y += p.vy * dts;
    p.vx *= k;
    p.vy = p.vy * k + gravity * dts;
    p.life -= dt;
  }
  return list.filter((p) => p.life > 0);
}

/** Draw particles additively so overlaps read as bright sparks. */
export function drawParticles(ctx: CanvasRenderingContext2D, list: Particle[]): void {
  if (!list.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of list) {
    const a = Math.max(0, p.life / p.max);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, TWO_PI);
    ctx.fillStyle = withAlpha(p.color, a);
    ctx.fill();
  }
  ctx.restore();
}

// —— trails & decay ———————————————————————————————————————————————————————————
/** Push a point onto a capped motion trail (mutates + returns it). */
export function pushTrail(trail: Vec[], x: number, y: number, cap = 16): Vec[] {
  trail.push({ x, y });
  if (trail.length > cap) trail.shift();
  return trail;
}

/** Linear decay of a shake/flash scalar toward 0. `perMs` is units per ms. */
export function decay(v: number, dt: number, perMs: number): number {
  return v > 0 ? Math.max(0, v - dt * perMs) : 0;
}

/** Random screen-shake offset for a magnitude (apply via ctx.translate). */
export function shakeOffset(mag: number): Vec {
  return { x: (fxRandom() * 2 - 1) * mag, y: (fxRandom() * 2 - 1) * mag };
}
