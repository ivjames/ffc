import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameTicketAward from './GameTicketAward';
import GameHighScore from './GameHighScore';
import { useFitCanvas } from './useFitCanvas';
import { drawLogo } from './logo';
import { playStroke, playCup, playUndo, playFanfare, playPinClack } from '../../lib/sound';
import type { Particle, Floater, Vec as FxVec } from './fx';
import {
  TWO_PI,
  withAlpha,
  roundRectPath,
  drawShadow,
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

// §12 Ring Toss — a carnival midway attraction mini-game. Flick a plastic ring
// from the counter onto a field of glass soda bottles: the flick's direction
// aims it and its length sets the power (soft = front row, hard = back row).
// Drop it clean around a neck for a ringer — green glass pays 2, the marked
// red-neck bottles in the middle pay 5. Clip a rim and the ring clinks away;
// land wide and it bounces out between the bottles. Eight rings a game, and
// every ringer stays on its bottle. All client-side canvas; works offline.

// —— Field + geometry (logical units; the canvas scales to fit) ———————————————
const W = 340;
const H = 560;
const RING_COUNT = 8;
const START = { x: W / 2, y: 505 };

// The bottle grid: COLS wide × ROWS deep on a perspective-tilted table. Row 0 is
// the back row (highest on screen, smallest scale).
const COLS = 5;
const ROWS = 4;
const ROW_Y0 = 178; // back-row base y
const ROW_Y1 = 330; // front-row base y
// Red-neck bottles ("row,col") in the middle of the pack — the 5-pointers.
const RED_CELLS = new Set(['1,2', '2,1', '2,3']);

// Bottle proportions at scale 1.
const BODY_W = 22;
const BODY_H = 42;
const NECK_W = 8;
const NECK_H = 16;

type Pt = { x: number; y: number };
type Bottle = { x: number; y: number; s: number; red: boolean };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Built back row first so iterating in order draws back-to-front and the front
// bottles' necks overlap the rows behind them correctly.
function buildBottles(): Bottle[] {
  const out: Bottle[] = [];
  for (let r = 0; r < ROWS; r++) {
    const t = r / (ROWS - 1); // 0 = back → 1 = front
    const y = ROW_Y0 + t * (ROW_Y1 - ROW_Y0);
    const s = 0.6 + t * 0.4;
    const gap = 40 + t * 18; // columns spread wider toward the front
    for (let c = 0; c < COLS; c++) {
      out.push({ x: W / 2 + (c - (COLS - 1) / 2) * gap, y, s, red: RED_CELLS.has(`${r},${c}`) });
    }
  }
  return out;
}
const BOTTLES = buildBottles();

/** The neck target a landing ring is compared against. */
function neckPoint(b: Bottle): Pt {
  return { x: b.x, y: b.y - (BODY_H + NECK_H * 0.75) * b.s };
}

/** Where a settled ring rests on the bottle's shoulder; stacked rings pile up. */
function ringRestY(b: Bottle, stack: number): number {
  return b.y - (BODY_H - 2) * b.s - stack * 3.2 * b.s;
}

/** Perspective scale for a ring sitting on the table at ground y (slightly
 *  extrapolated past the rows so overshoots keep shrinking). */
function fieldScale(y: number): number {
  return 0.6 + 0.4 * clamp((y - ROW_Y0) / (ROW_Y1 - ROW_Y0), -0.2, 1.25);
}

// —— The flick ————————————————————————————————————————————————————————————————
const MAX_DRAG = 260; // drag px → full power
const MIN_D = 150; // softest flick's carry (lands short of the front row)
const MAX_D = 420; // hardest flick's carry (sails past the back row)
const FLIGHT_MS = 620;
const SETTLE_MS = 620;
const NEXT_DELAY_MS = 1050;
const COUNT_STEP_MS = 800; // per digit of the "3, 2, 1" countdown
const GO_MS = 500;
const COUNTDOWN_MS = 3 * COUNT_STEP_MS + GO_MS;

// Landing bands, in neck-scale-normalized units (see resolveLanding).
// Generous on purpose: judging flick power is already the hard part, and at
// the original 8-unit band a ringer was a few-pixel bullseye per bottle —
// playtesting called it brutal.
const RINGER_D = 12; // near the neck: the ring drops around it
const CLOSE_D = 15; // "so close" whisker inside the rim band
const RIM_D = 20; // rim clink; anything wider bounces out between bottles

/** Map a flick (drag delta) to its landing spot, or null if it isn't a valid
 *  upward toss. Direction aims, length is power: short = front, hard = back. */
function landingFor(dx: number, dy: number): { land: Pt; ux: number } | null {
  const len = Math.hypot(dx, dy);
  if (len < 14) return null; // deadzone tap
  if (dy / len > -0.35) return null; // must be flicked up toward the bottles
  const power = Math.min(len / MAX_DRAG, 1);
  const d = MIN_D + power * (MAX_D - MIN_D);
  return {
    land: {
      x: clamp(START.x + (dx / len) * d, 14, W - 14),
      y: clamp(START.y + (dy / len) * d, 92, 400),
    },
    ux: dx / len,
  };
}

type Outcome = 'ringer' | 'rim' | 'wide';

/** Compare the landing point to the nearest bottle neck. Distances are divided
 *  by the bottle's scale so the bands feel the same at every depth, and depth
 *  error is weighted heavier than lateral error (the ring is a flat disc). */
function resolveLanding(land: Pt): { outcome: Outcome; bottle: number; soClose: boolean } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < BOTTLES.length; i++) {
    const n = neckPoint(BOTTLES[i]);
    const d = Math.hypot((land.x - n.x) / BOTTLES[i].s, ((land.y - n.y) * 1.15) / BOTTLES[i].s);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (bestD <= RINGER_D) return { outcome: 'ringer', bottle: best, soClose: false };
  if (bestD <= RIM_D) return { outcome: 'rim', bottle: best, soClose: bestD <= CLOSE_D };
  return { outcome: 'wide', bottle: best, soClose: false };
}

type Phase = 'ready' | 'countdown' | 'aim' | 'flight' | 'settle' | 'done';
type Drag = { active: boolean; sx: number; sy: number; dx: number; dy: number };
type Throw = {
  land: Pt;
  arc: number; // apogee height (px) of the flight arc
  ux: number; // flick x-direction — the wide bounce continues along it
  hopDir: number; // rim clink hop side (deterministic: away from the neck)
  outcome: Outcome;
  bottle: number;
  stack: number; // rings already on that bottle when this one was thrown
  pts: number;
  soClose: boolean;
  startedAt: number;
  settleAt: number;
};
type GS = {
  phase: Phase;
  ringNo: number; // 0-based
  total: number;
  drag: Drag;
  thr: Throw | null;
  ringed: number[]; // bottle index per landed ringer, in throw order
  lastPts: number | null;
  soClose: boolean;
  countStart: number;
};

function freshGS(): GS {
  return {
    phase: 'ready',
    ringNo: 0,
    total: 0,
    drag: { active: false, sx: 0, sy: 0, dx: 0, dy: 0 },
    thr: null,
    ringed: [],
    lastPts: null,
    soClose: false,
    countStart: 0,
  };
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the deterministic sim is never touched; they're
// advanced per animation frame with a real dt and only ever paint pixels. Built
// on the shared ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent flying-ring positions → motion streak
  particles: Particle[]; // glass-glint / spark bursts on landing
  floaters: Floater[]; // "+2" / "So close!" popups
  shake: number; // impact shake magnitude (px), decays to 0
  flash: number; // red-bottle flash 0..1, decays to 0
  flashColor: string;
};

function freshFX(): FX {
  return { trail: [], particles: [], floaters: [], shake: 0, flash: 0, flashColor: '#f87171' };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, dt: number) {
  fx.particles = stepParticles(fx.particles, dt, 0.02, 240); // gravity so glints fall
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** A plastic toss ring as a perspective-flattened torus: thick dark ellipse
 *  with a lit top arc. `rot` tilts it (spin in flight, wobble on landing). */
function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  rot: number,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.lineWidth = 4.5 * s;
  ctx.strokeStyle = '#c2410c';
  ctx.beginPath();
  ctx.ellipse(0, 0, 13 * s, 5.2 * s, 0, 0, TWO_PI);
  ctx.stroke();
  // Lit top edge so the plastic reads as a lip catching the booth lights.
  ctx.lineWidth = 2.2 * s;
  ctx.strokeStyle = '#fb923c';
  ctx.beginPath();
  ctx.ellipse(0, -0.8 * s, 12.6 * s, 4.9 * s, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();
}

/** One glass soda bottle — green glass (or a red neck for the 5-pointers),
 *  with glassy highlight streaks. Deterministic art, no RNG. */
function drawBottle(ctx: CanvasRenderingContext2D, b: Bottle) {
  const s = b.s;
  const x = b.x;
  const base = b.y;
  const bw = BODY_W * s;
  const bh = BODY_H * s;
  const nw = NECK_W * s;
  const nh = NECK_H * s;
  const top = base - bh - nh;

  drawShadow(ctx, x, base, bw * 0.62, 3.5 * s, 0.3);

  // Neck (red band on the 5-pointers) — drawn first so the shoulder overlaps it.
  const ng = ctx.createLinearGradient(x - nw / 2, 0, x + nw / 2, 0);
  if (b.red) {
    ng.addColorStop(0, '#7f1d1d');
    ng.addColorStop(0.4, '#ef4444');
    ng.addColorStop(1, '#991b1b');
  } else {
    ng.addColorStop(0, '#0c3d22');
    ng.addColorStop(0.4, '#2f9e57');
    ng.addColorStop(1, '#0a2e1a');
  }
  ctx.fillStyle = ng;
  ctx.fillRect(x - nw / 2, top, nw, nh + 6 * s);
  // Cap lip.
  ctx.fillStyle = b.red ? '#dc2626' : '#d6d3d1';
  ctx.fillRect(x - nw / 2 - 1.5 * s, top, nw + 3 * s, 3.5 * s);

  // Shoulder — glass curving from the body's top edge into the neck.
  const sg = ctx.createLinearGradient(x - bw / 2, 0, x + bw / 2, 0);
  sg.addColorStop(0, '#0c3d22');
  sg.addColorStop(0.3, '#2f9e57');
  sg.addColorStop(0.55, '#1a6b3a');
  sg.addColorStop(1, '#0a2e1a');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(x - bw / 2, base - bh + 1);
  ctx.quadraticCurveTo(x - bw / 2 + 1 * s, base - bh - 8 * s, x - nw / 2, base - bh - nh * 0.55);
  ctx.lineTo(x + nw / 2, base - bh - nh * 0.55);
  ctx.quadraticCurveTo(x + bw / 2 - 1 * s, base - bh - 8 * s, x + bw / 2, base - bh + 1);
  ctx.closePath();
  ctx.fill();

  // Body.
  roundRectPath(ctx, x - bw / 2, base - bh, bw, bh, 4 * s);
  ctx.fillStyle = sg;
  ctx.fill();

  // Glassy highlight streaks.
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(x - bw * 0.26, base - bh + 4 * s, 2.4 * s, bh - 8 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x - nw * 0.3, top + 4.5 * s, 1.4 * s, nh);
}

/** The midway booth: striped awning, string lights, felt table, wood counter.
 *  All offsets are index-derived (no RNG in the draw path). */
function drawBooth(ctx: CanvasRenderingContext2D) {
  // Dusky booth interior.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#231018');
  bg.addColorStop(0.5, '#180b10');
  bg.addColorStop(1, '#0d0608');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // String lights across the backwall.
  ctx.save();
  const bulbColors = ['#fbbf24', '#f87171', '#4ade80', '#60a5fa'];
  for (let i = 0; i < 9; i++) {
    const bx = 22 + i * 37;
    const by = 78 + (i % 2) * 6;
    const col = bulbColors[i % 4];
    ctx.beginPath();
    ctx.arc(bx, by, 3, 0, TWO_PI);
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 9;
    ctx.fill();
  }
  ctx.restore();

  // Booth sign — the house logo, hung between the awning's scalloped hem (~71)
  // and the felt table (150). The game's own name isn't lost: the screen's
  // TopBar already reads "Ring Toss", so this slot is free for the venue.
  // Warm amber tint to sit under the same string lights as the rest of the
  // booth, rather than reading as a white sticker pasted on the scene.
  drawLogo(ctx, W / 2, 114, { width: 118, tint: '#fbbf24' });

  // Felt table (perspective trapezoid) the bottles stand on.
  const felt = ctx.createLinearGradient(0, 150, 0, 372);
  felt.addColorStop(0, '#8c2424');
  felt.addColorStop(0.6, '#6b1717');
  felt.addColorStop(1, '#490f0f');
  ctx.beginPath();
  ctx.moveTo(46, 150);
  ctx.lineTo(W - 46, 150);
  ctx.lineTo(W - 6, 372);
  ctx.lineTo(6, 372);
  ctx.closePath();
  ctx.fillStyle = felt;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Table front face + floor gap.
  const face = ctx.createLinearGradient(0, 372, 0, 412);
  face.addColorStop(0, '#4a2f18');
  face.addColorStop(1, '#2b1a0c');
  ctx.fillStyle = face;
  ctx.fillRect(0, 372, W, 40);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 372, W, 1.5);
  ctx.fillStyle = '#120a06';
  ctx.fillRect(0, 412, W, 56);

  // Player's counter along the bottom.
  const counter = ctx.createLinearGradient(0, 468, 0, H);
  counter.addColorStop(0, '#54371c');
  counter.addColorStop(1, '#311d0e');
  ctx.fillStyle = counter;
  ctx.fillRect(0, 468, W, H - 468);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, 468, W, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let px = 44; px < W; px += 62) ctx.fillRect(px, 470, 1.5, H - 470);

  // Striped awning with scalloped edge, drawn last so it overlaps the wall.
  for (let sx = 0, i = 0; sx < W; sx += 34, i++) {
    ctx.fillStyle = i % 2 ? '#fef3c7' : '#b91c1c';
    ctx.fillRect(sx, 0, 34, 54);
    ctx.beginPath();
    ctx.arc(sx + 17, 54, 17, 0, Math.PI);
    ctx.fill();
  }
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);
  drawBooth(ctx);

  // Corner vignette for depth.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // —— Dynamic layer (shaken on a ringer) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const sh = shakeOffset(fx.shake);
    ctx.translate(sh.x, sh.y);
  }

  // Bottles back-to-front, each with any rings already settled on it (drawn
  // right after their bottle so nearer bottles overlap them correctly).
  for (let i = 0; i < BOTTLES.length; i++) {
    const b = BOTTLES[i];
    drawBottle(ctx, b);
    let stack = 0;
    for (const r of gs.ringed) {
      if (r !== i) continue;
      drawRing(ctx, b.x, ringRestY(b, stack), b.s, 0);
      stack++;
    }
  }

  // Aim preview while dragging — dots that fade out well before the bottle
  // field, so the landing spot is never given away.
  if (gs.phase === 'aim' && gs.drag.active) {
    const v = landingFor(gs.drag.dx, gs.drag.dy);
    if (v) {
      ctx.save();
      ctx.fillStyle = '#fed7aa';
      ctx.shadowColor = 'rgba(251,146,60,0.8)';
      ctx.shadowBlur = 6;
      for (let i = 1; i <= 10; i++) {
        const f = i / 10;
        const a = clamp((0.55 - f) / 0.55, 0, 1) * 0.8;
        if (a <= 0.03) continue;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(START.x + (v.land.x - START.x) * f, START.y + (v.land.y - START.y) * f, 2.6, 0, TWO_PI);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // The held ring waiting on the counter.
  if (gs.phase === 'countdown' || gs.phase === 'aim') {
    drawShadow(ctx, START.x, START.y + 4, 15, 5, 0.35);
    drawRing(ctx, START.x, START.y, 1.1, 0);
  }

  // Motion streak behind the flying ring.
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 2 + k * 5, 0, TWO_PI);
    ctx.fillStyle = `rgba(251,146,60,${0.03 + k * 0.15})`;
    ctx.fill();
  }

  // Flying ring: arcs up while its ground shadow tracks the flat trajectory,
  // and its scale follows height + table depth (SkeeBall-style depth cues).
  if (gs.phase === 'flight' && gs.thr) {
    const thr = gs.thr;
    const p = clamp((now - thr.startedAt) / FLIGHT_MS, 0, 1);
    const gx = START.x + (thr.land.x - START.x) * p;
    const gy = START.y + (thr.land.y - START.y) * p;
    const lift = Math.sin(Math.PI * p) * thr.arc;
    const sg = fieldScale(gy) * (1 - p) + fieldScale(thr.land.y) * p;
    drawShadow(ctx, gx, gy, 12 * sg, 4.6 * sg, 0.32 - 0.18 * Math.sin(Math.PI * p));
    drawRing(ctx, gx, gy - lift, sg * (1 + 0.45 * Math.sin(Math.PI * p)), 0.3 * Math.sin(p * 7));
  }

  // Landing resolution animations (all deterministic functions of progress).
  if (gs.phase === 'settle' && gs.thr) {
    const thr = gs.thr;
    const q = clamp((now - thr.settleAt) / SETTLE_MS, 0, 1);
    const b = BOTTLES[thr.bottle];
    if (thr.outcome === 'ringer') {
      // Drop down the neck, then wobble as it settles on the shoulder.
      const n = neckPoint(b);
      const from = n.y - 6 * b.s;
      const rest = ringRestY(b, thr.stack);
      const dp = Math.min(q * 2.6, 1);
      drawRing(ctx, b.x, from + (rest - from) * dp, b.s, 0.5 * (1 - q) * Math.sin(q * 26));
    } else if (thr.outcome === 'rim') {
      // Clink off the rim: hop to the side away from the neck, and die.
      const a = q < 0.65 ? 1 : Math.max(0, 1 - (q - 0.65) / 0.35);
      const hx = thr.land.x + thr.hopDir * 44 * b.s * q;
      const hy = thr.land.y - Math.abs(Math.sin(q * Math.PI * 2)) * 16 * (1 - q);
      drawRing(ctx, hx, hy, fieldScale(thr.land.y), thr.hopDir * q * 1.8, a);
    } else {
      // Wide: skitter on along the flick line between the bottles, and die.
      const a = q < 0.65 ? 1 : Math.max(0, 1 - (q - 0.65) / 0.35);
      const wx = clamp(thr.land.x + thr.ux * 64 * q, 10, W - 10);
      const wy = thr.land.y - Math.abs(Math.sin(q * Math.PI * 3)) * 12 * (1 - q);
      drawRing(ctx, wx, wy, fieldScale(thr.land.y), thr.ux * q * 2.4, a);
    }
  }

  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
  ctx.restore();

  // —— Red-ringer flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }

  // "3, 2, 1, GO!" countdown before the first toss.
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
}

export default function RingToss() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());
  const nextTimer = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('ready');
  const [ringNo, setRingNo] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastPts, setLastPts] = useState<number | null>(null);
  const [lastOutcome, setLastOutcome] = useState<Outcome | null>(null);
  const [soClose, setSoClose] = useState(false);
  // One id per played round — the ticket award's idempotency key.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const active = phase !== 'done';
  useFitCanvas(canvasRef, W, H, active);

  const loadNext = useCallback(() => {
    const gs = gsRef.current;
    // A settled ringer becomes part of the field now, so the draw pass layers
    // it behind nearer bottles from here on.
    if (gs.thr && gs.thr.outcome === 'ringer') gs.ringed = [...gs.ringed, gs.thr.bottle];
    gs.thr = null;
    if (gs.ringNo + 1 >= RING_COUNT) {
      gs.phase = 'done';
      setPhase('done');
      playFanfare();
      return;
    }
    gs.ringNo += 1;
    gs.phase = 'aim';
    setRingNo(gs.ringNo);
    setPhase('aim');
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
    let last = performance.now();
    // Pause the countdown/flight clocks via visibilitychange, not a hidden-rAF
    // branch: mobile browsers can fully suspend requestAnimationFrame while
    // backgrounded, so a hidden frame may never run. Shift the time bases by
    // the away span on resume so nothing skips or completes instantly.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const away = performance.now() - hiddenAt;
        hiddenAt = 0;
        const gs = gsRef.current;
        if (gs.phase === 'countdown') gs.countStart += away;
        if (gs.thr) {
          gs.thr.startedAt += away;
          gs.thr.settleAt += away;
        }
        last = performance.now();
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
      const dt = Math.min(now - last, 100); // clamp so a stall doesn't spike effects
      last = now;

      if (gs.phase === 'countdown' && now - gs.countStart >= COUNTDOWN_MS) {
        gs.phase = 'aim';
        setPhase('aim');
      }

      // Feed the motion streak while the ring is in the air (arc included).
      if (gs.phase === 'flight' && gs.thr) {
        const thr = gs.thr;
        const p = clamp((now - thr.startedAt) / FLIGHT_MS, 0, 1);
        const gx = START.x + (thr.land.x - START.x) * p;
        const gy = START.y + (thr.land.y - START.y) * p;
        pushTrail(fx.trail, gx, gy - Math.sin(Math.PI * p) * thr.arc, 14);
      }

      // Touchdown: resolve the toss the flick already decided.
      if (gs.phase === 'flight' && gs.thr && now - gs.thr.startedAt >= FLIGHT_MS) {
        const thr = gs.thr;
        gs.phase = 'settle';
        thr.settleAt = now;
        gs.total += thr.pts;
        gs.lastPts = thr.pts;
        gs.soClose = thr.soClose;
        setTotal(gs.total);
        setLastPts(thr.pts);
        setLastOutcome(thr.outcome);
        setSoClose(thr.soClose);
        setPhase('settle');
        fx.trail.length = 0;
        const b = BOTTLES[thr.bottle];
        const n = neckPoint(b);
        if (thr.outcome === 'ringer') {
          if (b.red) {
            playFanfare();
            fx.flash = 1;
            fx.flashColor = '#f87171';
            fx.shake = 6;
            spawnBurst(fx.particles, n.x, n.y, 26, 300, '#fca5a5');
            spawnBurst(fx.particles, n.x, n.y, 12, 160, '#fde68a');
          } else {
            playCup();
            fx.shake = 3.5;
            spawnBurst(fx.particles, n.x, n.y, 14, 190, '#86efac');
          }
          spawnFloater(fx.floaters, n.x, n.y - 26, `+${thr.pts}`, b.red ? '#f87171' : '#4ade80', {
            size: b.red ? 26 : 20,
            life: 900,
          });
        } else if (thr.outcome === 'rim') {
          playPinClack(1);
          spawnBurst(fx.particles, thr.land.x, thr.land.y, 8, 130, '#fdba74');
          if (thr.soClose)
            spawnFloater(fx.floaters, thr.land.x, thr.land.y - 20, 'So close!', '#fdba74', {
              size: 16,
              life: 800,
            });
        } else {
          playUndo();
          spawnBurst(fx.particles, thr.land.x, thr.land.y, 6, 90, '#94a3b8');
        }
        nextTimer.current = window.setTimeout(loadNext, NEXT_DELAY_MS);
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
  }, [active, loadNext]);

  useEffect(() => {
    return () => {
      if (nextTimer.current) clearTimeout(nextTimer.current);
    };
  }, []);

  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
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
    const v = landingFor(gs.drag.dx, gs.drag.dy);
    if (!v) return; // not a valid toss — ring not consumed
    const res = resolveLanding(v.land);
    const b = BOTTLES[res.bottle];
    const dist = Math.hypot(v.land.x - START.x, v.land.y - START.y);
    gs.thr = {
      land: v.land,
      arc: 58 + dist * 0.16,
      ux: v.ux,
      hopDir: v.land.x >= b.x ? 1 : -1,
      outcome: res.outcome,
      bottle: res.bottle,
      stack: gs.ringed.filter((i) => i === res.bottle).length,
      pts: res.outcome === 'ringer' ? (b.red ? 5 : 2) : 0,
      soClose: res.soClose,
      startedAt: performance.now(),
      settleAt: 0,
    };
    gs.phase = 'flight';
    setPhase('flight');
    // Rendering-only release puff off the counter.
    const fx = fxRef.current;
    fx.trail.length = 0;
    spawnBurst(fx.particles, START.x, START.y, 7, 120, '#fdba74');
    playStroke();
  }, []);

  const start = useCallback(() => {
    if (nextTimer.current) clearTimeout(nextTimer.current);
    const now = performance.now();
    const gs = freshGS();
    gs.phase = 'countdown';
    gs.countStart = now;
    gsRef.current = gs;
    fxRef.current = freshFX();
    setPhase('countdown');
    setRingNo(0);
    setTotal(0);
    setLastPts(null);
    setLastOutcome(null);
    setSoClose(false);
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    const remark =
      total >= 20 ? 'Midway legend! 🎪' : total >= 12 ? 'Carnival sharp! 🎯' : total >= 5 ? 'Nice tossing! 👍' : 'Keep flicking! 🎮';
    return (
      <Screen>
        <TopBar title="Ring Toss" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🎪</span>
            <div className="text-5xl font-black text-fairway-50">{total}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">across {RING_COUNT} rings</p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (2 tickets per point — a green ringer pays 4, a red-neck 10). */}
          <GameTicketAward game="ringtoss" tickets={total * 2} sessionId={sessionId} />
          <GameHighScore game="ringtoss" score={total} sessionId={sessionId} />
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
      ? 'Flick the ring onto a bottle — red necks pay 5.'
      : phase === 'countdown'
        ? 'Get ready…'
        : phase === 'aim'
          ? lastPts !== null
            ? lastPts > 0
              ? `+${lastPts}! Flick the next one.`
              : soClose
                ? 'So close! Flick the next one.'
                : 'Missed — flick the next one.'
            : 'Flick up — soft for the front row, hard for the back.'
          : phase === 'flight'
            ? 'It’s in the air…'
            : lastOutcome === 'ringer'
              ? `Ringer! +${lastPts}!`
              : lastOutcome === 'rim'
                ? soClose
                  ? 'SO close — rattled the rim!'
                  : 'Clink — off the rim!'
                : 'Bounced out!';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Ring Toss" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Ring <span className="text-fairway-100">{Math.min(ringNo + 1, RING_COUNT)}</span>
          <span className="font-normal text-fairway-400"> / {RING_COUNT}</span>
        </span>
        <span className="text-fairway-300">
          Score <span className="font-bold text-fairway-100">{total}</span>
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
            <span className="text-5xl">🎪</span>
            <p className="text-sm text-fairway-100">
              Flick the ring onto a bottle — soft for the front row, hard for the back. {RING_COUNT} rings; red
              necks pay 5.
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
