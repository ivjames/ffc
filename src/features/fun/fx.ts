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

// Canvas drawing is invisible to the CSS `prefers-reduced-motion` block, so a
// game that paints ambient motion — an attract-mode shimmer, an idle pulse on a
// target — has to gate it here instead. Tracked live (same shape as
// lib/haptics.ts) so toggling the OS setting mid-session is honored without a
// reload; a phone left on a cabinet all evening never gets reloaded.
//
// Note this covers AMBIENT motion only. Motion the player caused — a ball in
// flight, a bumper lighting on a hit — is the game responding to input, not
// decoration, and stays on regardless.
let reduceMotion = false;
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduceMotion = mq.matches;
  const onChange = (e: MediaQueryListEvent) => {
    reduceMotion = e.matches;
  };
  // Older Safari only has addListener; try both.
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof (mq as unknown as { addListener?: unknown }).addListener === 'function')
    (mq as unknown as { addListener: (fn: (e: MediaQueryListEvent) => void) => void }).addListener(
      onChange,
    );
}

/** Whether the player has asked for reduced motion. Gate ambient motion on it. */
export function prefersReducedMotion(): boolean {
  return reduceMotion;
}

/**
 * A 0..1 sine for attract-mode idling — the slow breath a real machine's lamps
 * have while nobody is playing. `offset` (radians) staggers sibling elements so
 * a row of lamps ripples instead of blinking in unison.
 *
 * Returns a steady mid-brightness under reduced motion, so the element still
 * reads as lit rather than snapping dark.
 */
export function attractPulse(now: number, periodMs: number, offset = 0): number {
  if (reduceMotion) return 0.5;
  return 0.5 + 0.5 * Math.sin((now / periodMs) * TWO_PI + offset);
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

// —— score floaters ———————————————————————————————————————————————————————————
// Rising, fading text popups ("+3", "GOAL!") anchored where a score happened.
export type Floater = {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number; // ms remaining
  max: number; // ms total (for alpha falloff)
  size: number; // font px
};

/** Push a rising score popup onto `list`. */
export function spawnFloater(
  list: Floater[],
  x: number,
  y: number,
  text: string,
  color: string,
  opts: { life?: number; size?: number } = {},
): void {
  const max = opts.life ?? 650;
  list.push({ x, y, text, color, life: max, max, size: opts.size ?? 20 });
}

/** Advance floaters by `dt` ms (rise + fade) and return the survivors. */
export function stepFloaters(list: Floater[], dt: number, rise = 0.045): Floater[] {
  for (const f of list) {
    f.y -= dt * rise;
    f.life -= dt;
  }
  return list.filter((f) => f.life > 0);
}

/** Draw floaters with a soft self-colored glow, fading out over their life. */
export function drawFloaters(ctx: CanvasRenderingContext2D, list: Floater[]): void {
  if (!list.length) return;
  ctx.save();
  ctx.textAlign = 'center';
  for (const f of list) {
    ctx.globalAlpha = Math.max(0, f.life / f.max);
    ctx.font = `bold ${f.size}px system-ui, sans-serif`;
    ctx.fillStyle = f.color;
    ctx.shadowColor = f.color;
    ctx.shadowBlur = 10;
    ctx.fillText(f.text, f.x, f.y);
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

// --- Cabinet screen treatment ----------------------------------------------
// The last thing a game's draw loop does. The CSS side (`.arcade-screen` in
// index.css) supplies the bezel, the bloom, and the seat shadow — everything
// OUTSIDE the drawing. These two supply what has to be composited on top of
// the pixels themselves, which CSS cannot do to a canvas: a <canvas> is a
// replaced element, so a ::after veil is never rendered on it.
//
// Both are pure overlays: call them after everything else, and they need no
// state, no per-game tuning, and no changes to what the game already draws.

/** Scanline pitch in CSS pixels. Three is the tightest that still reads as
 *  lines rather than as a flat grey wash once the canvas is scaled down to a
 *  phone. */
const SCANLINE_PITCH = 3;

/**
 * The CRT veil: scanlines plus a corner vignette, as a curved tube gives.
 *
 * Cheap by construction — one fillRect per line over a canvas a few hundred
 * pixels tall, no gradients per line, no offscreen buffer — because this runs
 * every frame in games that are already doing physics.
 *
 * @param strength 0..1; scales both effects together so a game with a dark
 *   playfield can dial it down rather than turning it off.
 */
export function drawScreenVeil(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength = 1,
): void {
  if (strength <= 0) return;
  ctx.save();

  // Scanlines.
  ctx.fillStyle = `rgba(0,0,0,${0.14 * strength})`;
  for (let y = 0; y < h; y += SCANLINE_PITCH) ctx.fillRect(0, y, w, 1);

  // Vignette. One radial gradient, transparent through most of the frame so it
  // only bites at the corners.
  const grad = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${0.42 * strength})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();
}

/**
 * A full-screen colored flash — the frame a machine lights up on a jackpot,
 * a strike, a bullseye. Drive `amount` from a scalar you decay() each frame:
 *
 *   gs.flash = decay(gs.flash, dt, 0.004);
 *   drawScreenFlash(ctx, W, H, gs.flash, '#fbbf24');
 *
 * Screen-blended, so it brightens the playfield rather than fogging it grey —
 * a plain white overlay at low alpha is what makes a "flash" look like haze.
 */
export function drawScreenFlash(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
  color = '#ffffff',
): void {
  if (amount <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = Math.min(1, amount) * 0.55;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// --- Cached static layers ---------------------------------------------------
// Most of these games repaint a completely static backdrop every frame — a
// dartboard is 60 wedge fills, 20 numbers and a spider wire that are identical
// on frame 1 and frame 10,000. Painting it once into an offscreen canvas and
// blitting it costs one drawImage instead, which is what buys the per-frame
// budget for the lighting work layered on top.
//
// Same idea as PuttGolf's cached hazard layer, generalised: build once, keep it
// in a module-level slot, blit forever.

/** Supersample factor for cached layers. Two matches the DPR cap the games
 *  render at, so a blit is pixel-exact on a phone rather than resampled soft. */
export const LAYER_SS = 2;

/**
 * Build a static layer: `paint` runs ONCE into an offscreen canvas sized for
 * `w`×`h` logical units (already scaled, so paint in plain game coordinates).
 * Blit it with `ctx.drawImage(layer, 0, 0, w, h)`.
 *
 * Returns null when there's no DOM or no 2D context; callers fall back to
 * painting directly so a layer that can't be built is never a blank screen.
 */
export function makeLayer(
  w: number,
  h: number,
  paint: (c: CanvasRenderingContext2D) => void,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w * LAYER_SS;
  cv.height = h * LAYER_SS;
  const c = cv.getContext('2d');
  if (!c) return null;
  c.scale(LAYER_SS, LAYER_SS);
  paint(c);
  return cv;
}

/**
 * A static layer that builds on first use and REBUILDS when `key` changes.
 *
 * The key matters more than it looks. Every one of these backdrops paints the
 * venue logo, and `drawLogo` no-ops until the mark has decoded — which happens
 * after the first frames, because branding hydrates from /api/content. A layer
 * built naively on frame one would latch the logo-less version forever. Passing
 * `logoReady(variant)` as the key rebuilds it exactly once, when the mark
 * actually becomes drawable (and again if a branding swap changes it).
 *
 * Call at module scope; the returned getter is what the draw loop calls.
 */
export function makeCachedLayer(
  w: number,
  h: number,
  paint: (c: CanvasRenderingContext2D) => void,
): (key?: unknown) => HTMLCanvasElement | null {
  let layer: HTMLCanvasElement | null = null;
  let built = false;
  let lastKey: unknown;
  return (key?: unknown) => {
    if (!built || key !== lastKey) {
      layer = makeLayer(w, h, paint);
      built = true;
      lastKey = key;
    }
    return layer;
  };
}

/**
 * Deterministic anisotropic streaks — the directional grain that separates
 * brushed metal from a flat grey fill. Paint it INTO a cached layer (it's a few
 * hundred hairline strokes, far too much for a frame) over an existing fill,
 * clipped by the caller.
 *
 * Index-derived, never fxRandom(): a cached layer is built once, so a random
 * grain would differ between a rebuild and look like the surface changed.
 */
export function brushedStreaks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  count = 90,
  alpha = 0.05,
): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    // Two coprime strides keep successive streaks from stacking into bands.
    const sx = x + ((i * 71) % w);
    const sy = y + ((i * 137) % h);
    const len = 18 + ((i * 29) % 46);
    const light = i % 3 === 0;
    ctx.strokeStyle = light
      ? `rgba(255,255,255,${alpha})`
      : `rgba(0,0,0,${alpha * 1.4})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, Math.min(sy + len, y + h));
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A soft glow behind a bright element — the halo a real light throws on the
 * glass in front of it. Draw BEFORE the element itself.
 *
 * Uses a radial gradient rather than ctx.shadowBlur: shadowBlur is the single
 * most expensive thing you can put in a per-frame canvas loop, and at the
 * radii that read as "glow" it costs more than the rest of the frame.
 */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha = 0.5,
): void {
  if (radius <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, withAlpha(color, alpha));
  grad.addColorStop(0.5, withAlpha(color, alpha * 0.35));
  grad.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}
