import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameTicketAward from './GameTicketAward';
import { useFitCanvas } from './useFitCanvas';
import { playStroke, playPinClack, playCup, playDing, playUndo, playFanfare } from '../../lib/sound';
import type { Particle, Floater, Vec as FxVec } from './fx';
import {
  TWO_PI,
  withAlpha,
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

// §12 Darts — a nine-dart high-score mini-game. The same two-tap timing aim as
// Axe Throwing: a vertical guide sweeps left↔right (tap to lock), a horizontal
// guide sweeps up↕down (tap again), and the dart flies in and sticks at the
// crossing. Real dartboard, real rules — sector values, doubles, trebles,
// 25/50 bulls. Nine darts as three visits of three, with a visit-total beat
// while the darts are pulled. Canvas-rendered, client-side, offline.

// —— Board geometry (logical units; the canvas scales to fit) —————————————————
const W = 340;
const H = 560;
const CX = 170;
const CY = 218;

// Standard number order clockwise from the top (20 at 12 o'clock).
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const D2R = Math.PI / 180;
const SEG = 18 * D2R; // each sector spans 18°

// Radii, proportioned like a real board but with slightly fatter double/treble
// bands so timing skill (not pixel luck) decides the score.
const R_SURROUND = 160; // black number surround
const R_NUMBERS = 145;
const R_DOUBLE_OUT = 130; // playable edge — beyond this is a MISS
const R_DOUBLE_IN = 118;
const R_TREBLE_OUT = 82; // ~60% radius, like the real thing
const R_TREBLE_IN = 70;
const R_BULL = 15; // outer bull (green, 25)
const R_BULL_IN = 7; // inner bull (red, 50)

const SECTOR_BLACK = '#1a1a20';
const SECTOR_CREAM = '#e9dab2';
const RING_RED = '#c22f2f';
const RING_GREEN = '#2c8a52';

// Sweep ranges cover the whole board plus a margin, so misses are possible.
const SWEEP_X0 = 26;
const SWEEP_X1 = W - 26;
const SWEEP_Y0 = 74;
const SWEEP_Y1 = 362;
// Slower than AxeThrow's sweeps: the board's doubles/trebles are only a few
// pixels tall, so the guides need more dwell time to aim at a specific bed.
const SWEEP_X_MS = 1750;
const SWEEP_Y_MS = 1500;

const DARTS = 9;
const VISIT_SIZE = 3;
const FLIGHT_MS = 420;
const SCORE_MS = 850; // beat on the stuck dart before the next one loads
const VISIT_MS = 1600; // "visit total" beat while darts are pulled
const COUNT_STEP_MS = 800; // per digit of the "3, 2, 1" countdown
const GO_MS = 500; // beat of "GO!" after the digits, before the first sweep
const COUNTDOWN_MS = 3 * COUNT_STEP_MS + GO_MS;

// Flight (feather) colors cycle within a visit so the three darts read apart.
const FLIGHT_COLORS = ['#ef4444', '#60a5fa', '#facc15'];

/** Triangle wave 0→1→0 over `period` ms, for a guide that sweeps and returns. */
function triWave(now: number, period: number): number {
  const u = (now % period) / period;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

// —— Scoring — exact dart rules ———————————————————————————————————————————————
type Ring = 'S' | 'D' | 'T' | 'B25' | 'B50' | 'M';
type Hit = { points: number; ring: Ring; sector: number };

function scoreAt(x: number, y: number): Hit {
  const d = Math.hypot(x - CX, y - CY);
  if (d > R_DOUBLE_OUT) return { points: 0, ring: 'M', sector: 0 };
  if (d <= R_BULL_IN) return { points: 50, ring: 'B50', sector: 0 };
  if (d <= R_BULL) return { points: 25, ring: 'B25', sector: 0 };
  // Clockwise angle from 12 o'clock; +9° so sector 20 straddles the top.
  const deg = (Math.atan2(x - CX, CY - y) / D2R + 369) % 360;
  const sector = ORDER[Math.floor(deg / 18) % 20];
  if (d >= R_DOUBLE_IN) return { points: sector * 2, ring: 'D', sector };
  if (d >= R_TREBLE_IN && d <= R_TREBLE_OUT) return { points: sector * 3, ring: 'T', sector };
  return { points: sector, ring: 'S', sector };
}

function hitLabel(hit: Hit): string {
  switch (hit.ring) {
    case 'T':
      return `T${hit.sector}!`;
    case 'D':
      return `D${hit.sector}!`;
    case 'B25':
      return 'BULL!';
    case 'B50':
      return '50!!';
    default:
      return '';
  }
}

const HIT_COLOR: Record<Ring, string> = {
  B50: '#fbbf24',
  B25: '#f87171',
  T: '#4ade80',
  D: '#60a5fa',
  S: '#fde68a',
  M: '#94a3b8',
};

type Phase = 'ready' | 'countdown' | 'aimX' | 'aimY' | 'flying' | 'scored' | 'visit' | 'done';
type Mark = { x: number; y: number; i: number }; // i = index within the visit
type GS = {
  phase: Phase;
  dartNo: number; // 0-based, 0..8
  total: number;
  visitTotal: number;
  lockX: number;
  land: { x: number; y: number } | null;
  hit: Hit | null;
  flyStart: number;
  scoreAtTs: number; // when the current result was locked in
  visitStart: number; // when the visit-total beat began
  marks: Mark[]; // darts stuck this visit
  sweepBase: number; // now-offset so each sweep starts at its left/top
  countStart: number; // timestamp the countdown began
};

function freshGS(now: number): GS {
  return {
    phase: 'ready',
    dartNo: 0,
    total: 0,
    visitTotal: 0,
    lockX: CX,
    land: null,
    hit: null,
    flyStart: 0,
    scoreAtTs: 0,
    visitStart: 0,
    marks: [],
    sweepBase: now,
    countStart: 0,
  };
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
type FX = {
  trail: FxVec[]; // recent flying-dart positions → motion streak
  particles: Particle[]; // sisal-puff / spark bursts on stick
  floaters: Floater[]; // "T20!" / "+60" popups
  shake: number; // impact shake magnitude (px), decays to 0
  flash: number; // big-hit flash 0..1, decays to 0
  flashColor: string;
};

function freshFX(): FX {
  return { trail: [], particles: [], floaters: [], shake: 0, flash: 0, flashColor: '#fbbf24' };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, dt: number) {
  fx.particles = stepParticles(fx.particles, dt, 0.02, 200);
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** Annular wedge path between radii r0..r1 over canvas angles a0..a1. */
function wedgePath(ctx: CanvasRenderingContext2D, r0: number, r1: number, a0: number, a1: number) {
  ctx.beginPath();
  ctx.arc(CX, CY, r1, a0, a1);
  ctx.arc(CX, CY, r0, a1, a0, true);
  ctx.closePath();
}

/** A dart with its tip at (x, y), tail extending along `tailAngle`. */
function drawDart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tailAngle: number,
  scale: number,
  flightColor: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tailAngle);
  ctx.scale(scale, scale);
  // Steel needle.
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(6, 0);
  ctx.stroke();
  // Brass barrel — lit metal gradient across its width.
  const bg = ctx.createLinearGradient(0, -2.2, 0, 2.2);
  bg.addColorStop(0, '#f0d078');
  bg.addColorStop(0.5, '#c79a2e');
  bg.addColorStop(1, '#7d5f1a');
  ctx.fillStyle = bg;
  ctx.fillRect(6, -2.2, 11, 4.4);
  // Dark shaft.
  ctx.fillStyle = '#2a2a33';
  ctx.fillRect(17, -1.3, 10, 2.6);
  // Flight — two swept vanes.
  ctx.beginPath();
  ctx.moveTo(27, 0);
  ctx.lineTo(37, -7);
  ctx.lineTo(33.5, 0);
  ctx.lineTo(37, 7);
  ctx.closePath();
  ctx.fillStyle = flightColor;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
}

/** The dark pub wall behind the board — deterministic panel seams, no RNG. */
function drawWall(ctx: CanvasRenderingContext2D) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#25222b');
  bg.addColorStop(0.55, '#1a1720');
  bg.addColorStop(1, '#0e0c12');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Horizontal panel seams with an index-derived stagger (identical every frame).
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  for (let row = 0, y = 0; y < H; row++, y += 56) {
    ctx.fillRect(0, y + 54.5, W, 1.5);
    ctx.fillRect((row * 137) % W, y, 1.5, 56);
  }
  // Warm spotlight pooled on the board.
  const spot = ctx.createRadialGradient(CX, CY, 30, CX, CY, 230);
  spot.addColorStop(0, 'rgba(255,214,150,0.12)');
  spot.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);
}

/** An accurate dartboard: 20 sectors, double + treble rings, bulls, numbers. */
function drawBoard(ctx: CanvasRenderingContext2D) {
  // Black surround with a metal rim.
  const sg = ctx.createRadialGradient(CX, CY - 30, 40, CX, CY, R_SURROUND);
  sg.addColorStop(0, '#1f1f26');
  sg.addColorStop(1, '#0a0a0e');
  ctx.beginPath();
  ctx.arc(CX, CY, R_SURROUND, 0, TWO_PI);
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Sectors — base fill, then treble and double bands on top.
  for (let i = 0; i < 20; i++) {
    const a0 = -Math.PI / 2 + i * SEG - SEG / 2;
    const a1 = a0 + SEG;
    const black = i % 2 === 0; // sector 20 (top) is black on a real board
    wedgePath(ctx, R_BULL, R_DOUBLE_OUT, a0, a1);
    ctx.fillStyle = black ? SECTOR_BLACK : SECTOR_CREAM;
    ctx.fill();
    ctx.fillStyle = black ? RING_RED : RING_GREEN;
    wedgePath(ctx, R_TREBLE_IN, R_TREBLE_OUT, a0, a1);
    ctx.fill();
    wedgePath(ctx, R_DOUBLE_IN, R_DOUBLE_OUT, a0, a1);
    ctx.fill();
  }

  // Bulls: green 25 ring, red 50 center.
  ctx.beginPath();
  ctx.arc(CX, CY, R_BULL, 0, TWO_PI);
  ctx.fillStyle = RING_GREEN;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(CX, CY, R_BULL_IN, 0, TWO_PI);
  ctx.fillStyle = RING_RED;
  ctx.fill();

  // Faint top-to-bottom falloff so the face reads matte, top-lit.
  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, R_DOUBLE_OUT, 0, TWO_PI);
  ctx.clip();
  const lit = ctx.createLinearGradient(0, CY - R_DOUBLE_OUT, 0, CY + R_DOUBLE_OUT);
  lit.addColorStop(0, 'rgba(255,255,255,0.07)');
  lit.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = lit;
  ctx.fillRect(CX - R_DOUBLE_OUT, CY - R_DOUBLE_OUT, R_DOUBLE_OUT * 2, R_DOUBLE_OUT * 2);
  ctx.restore();

  // Spider wire: ring circles + radial sector boundaries.
  ctx.strokeStyle = 'rgba(203,213,225,0.55)';
  ctx.lineWidth = 1;
  for (const r of [R_DOUBLE_OUT, R_DOUBLE_IN, R_TREBLE_OUT, R_TREBLE_IN, R_BULL, R_BULL_IN]) {
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, TWO_PI);
    ctx.stroke();
  }
  for (let i = 0; i < 20; i++) {
    const a = -Math.PI / 2 + i * SEG - SEG / 2;
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(a) * R_BULL, CY + Math.sin(a) * R_BULL);
    ctx.lineTo(CX + Math.cos(a) * R_DOUBLE_OUT, CY + Math.sin(a) * R_DOUBLE_OUT);
    ctx.stroke();
  }

  // Numbers around the rim, clockwise from 20 at the top.
  ctx.save();
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e5e7eb';
  for (let i = 0; i < 20; i++) {
    const a = i * SEG;
    ctx.fillText(String(ORDER[i]), CX + Math.sin(a) * R_NUMBERS, CY - Math.cos(a) * R_NUMBERS);
  }
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);

  drawWall(ctx);

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  drawBoard(ctx);

  // —— Dynamic layer (shaken on impact) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Motion streak behind the flying dart.
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 1.5 + k * 4, 0, TWO_PI);
    ctx.fillStyle = `rgba(251,191,36,${0.03 + k * 0.15})`;
    ctx.fill();
  }

  // Darts stuck this visit (tail tilt varies by slot — deterministic).
  for (const m of gs.marks) drawDart(ctx, m.x, m.y, 0.55 + m.i * 0.14, 1, FLIGHT_COLORS[m.i]);

  // Aiming guides — glowing amber sweep lines.
  if (gs.phase === 'aimX') {
    const x = SWEEP_X0 + (SWEEP_X1 - SWEEP_X0) * triWave(now - gs.sweepBase, SWEEP_X_MS);
    neonLine(ctx, x, 54, x, 386, '#fbbf24', 2.5, 12);
  } else if (gs.phase === 'aimY') {
    const y = SWEEP_Y0 + (SWEEP_Y1 - SWEEP_Y0) * triWave(now - gs.sweepBase, SWEEP_Y_MS);
    // Locked vertical + sweeping horizontal; their crossing is the target point.
    ctx.save();
    ctx.strokeStyle = 'rgba(251,191,36,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gs.lockX, 54);
    ctx.lineTo(gs.lockX, 386);
    ctx.stroke();
    ctx.restore();
    neonLine(ctx, 20, y, W - 20, y, '#fbbf24', 2.5, 12);
    ctx.save();
    ctx.beginPath();
    ctx.arc(gs.lockX, y, 5, 0, TWO_PI);
    ctx.fillStyle = '#fde68a';
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.restore();
  }

  // Flying dart — shrinks as it travels "away" into the board.
  if (gs.phase === 'flying' && gs.land) {
    const p = Math.min((now - gs.flyStart) / FLIGHT_MS, 1);
    const sx = W / 2;
    const sy = H - 16;
    const x = sx + (gs.land.x - sx) * p;
    const y = sy + (gs.land.y - sy) * p;
    const tail = Math.atan2(sy - y, sx - x);
    drawDart(ctx, x, y, tail, 2 - p, FLIGHT_COLORS[gs.dartNo % VISIT_SIZE]);
  }

  // Next dart at the ready in the thrower's hand.
  if (gs.phase === 'countdown' || gs.phase === 'aimX' || gs.phase === 'aimY') {
    drawDart(ctx, W / 2, H - 68, Math.PI / 2, 1.6, FLIGHT_COLORS[gs.dartNo % VISIT_SIZE]);
  }

  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
  ctx.restore();

  // —— Big-hit flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }

  // Visit-total beat while the darts are pulled from the board.
  if (gs.phase === 'visit') {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fde68a';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(`VISIT ${Math.floor(gs.dartNo / VISIT_SIZE) + 1}`, W / 2, H / 2 - 44);
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = 'rgba(251,191,36,0.7)';
    ctx.shadowBlur = 16;
    ctx.font = 'bold 56px system-ui, sans-serif';
    ctx.fillText(String(gs.visitTotal), W / 2, H / 2 + 12);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(gs.dartNo >= DARTS - 1 ? 'game shot!' : 'pulling darts…', W / 2, H / 2 + 44);
    ctx.restore();
  }

  // "3, 2, 1, GO!" countdown before the first sweep starts.
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
}

export default function Darts() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS(0));
  const fxRef = useRef<FX>(freshFX());
  // Last-rendered guide position (the sweep values actually painted this frame).
  // onTap reads these so the dart lands on the crosshair the player saw, closing
  // the sub-frame gap between the draw clock and a fresh clock read at tap time.
  const guideRef = useRef({ x: SWEEP_X0, y: SWEEP_Y0 });

  const [phase, setPhase] = useState<Phase>('ready');
  const [dartNo, setDartNo] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastHit, setLastHit] = useState<Hit | null>(null);
  // One id per played round — the ticket award's idempotency key.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

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
    // Freeze the game via visibilitychange, not a hidden-rAF branch: mobile
    // browsers can fully suspend requestAnimationFrame while backgrounded, so a
    // hidden frame may never run to catch the away span. Shift EVERY absolute
    // time base by the away span on resume — countdown, sweeps, flight, score
    // beat, and visit interlude — so no phase can skip ahead while hidden.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const away = performance.now() - hiddenAt;
        hiddenAt = 0;
        const gs = gsRef.current;
        gs.countStart += away;
        gs.sweepBase += away;
        gs.flyStart += away;
        gs.scoreAtTs += away;
        gs.visitStart += away;
        last = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const frame = (now: number) => {
      const gs = gsRef.current;
      const fx = fxRef.current;
      if (document.hidden) {
        // Time bases are shifted in onVisibility; just skip sim/draw work.
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(now - last, 100);
      last = now;

      if (gs.phase === 'countdown' && now - gs.countStart >= COUNTDOWN_MS) {
        gs.phase = 'aimX';
        gs.sweepBase = now;
        setPhase('aimX');
      }

      // Record the guide's *rendered* position this frame so a tap lands exactly
      // where the crosshair was last drawn — not where a freshly re-read clock in
      // onTap would place it a few ms later. Same `now` the draw below uses.
      if (gs.phase === 'aimX') {
        guideRef.current.x = SWEEP_X0 + (SWEEP_X1 - SWEEP_X0) * triWave(now - gs.sweepBase, SWEEP_X_MS);
      } else if (gs.phase === 'aimY') {
        guideRef.current.y = SWEEP_Y0 + (SWEEP_Y1 - SWEEP_Y0) * triWave(now - gs.sweepBase, SWEEP_Y_MS);
      }

      // Feed the motion trail while the dart is in flight.
      if (gs.phase === 'flying' && gs.land) {
        const p = Math.min((now - gs.flyStart) / FLIGHT_MS, 1);
        const sx = W / 2;
        const sy = H - 16;
        pushTrail(fx.trail, sx + (gs.land.x - sx) * p, sy + (gs.land.y - sy) * p, 14);
      }

      // Dart sticks: score it, spawn the juice, announce the hit.
      if (gs.phase === 'flying' && gs.land && gs.hit && now - gs.flyStart >= FLIGHT_MS) {
        const hit = gs.hit;
        const { x, y } = gs.land;
        gs.total += hit.points;
        gs.visitTotal += hit.points;
        gs.marks = [...gs.marks, { x, y, i: gs.dartNo % VISIT_SIZE }];
        gs.phase = 'scored';
        gs.scoreAtTs = now;
        setTotal(gs.total);
        setLastHit(hit);
        setPhase('scored');

        // Impact juice — burst and shake scale with the points scored.
        fx.trail.length = 0;
        const v = hit.points;
        const big = v >= 40;
        spawnBurst(
          fx.particles,
          x,
          y,
          v === 0 ? 6 : 8 + Math.min(24, Math.round(v * 0.6)),
          v === 0 ? 100 : 140 + Math.min(260, v * 4),
          big ? '#fde68a' : v > 0 ? HIT_COLOR[hit.ring] : '#94a3b8',
        );
        fx.shake = v === 0 ? 1.5 : 2 + Math.min(6, v * 0.12);
        if (big) {
          fx.flash = 1;
          fx.flashColor = hit.ring === 'B50' ? '#fbbf24' : '#4ade80';
        }
        const label = hitLabel(hit);
        if (label) spawnFloater(fx.floaters, x, y - 42, label, HIT_COLOR[hit.ring], { size: 22, life: 800 });
        spawnFloater(fx.floaters, x, y - 20, v > 0 ? `+${v}` : 'MISS', v > 0 ? '#fde68a' : '#94a3b8', {
          life: 750,
        });

        if (v === 0) {
          playPinClack(0.4); // dull thud into the surround/wall
          playUndo();
        } else {
          playPinClack(Math.min(1.4, 0.5 + v / 40));
        }
        if (hit.ring === 'B50') playFanfare();
        else if (hit.ring === 'T' || hit.ring === 'D') playCup();
        else if (hit.ring === 'B25') playDing();
      }

      // Beat on the stuck dart → next dart, or the visit-total interlude.
      if (gs.phase === 'scored' && now - gs.scoreAtTs >= SCORE_MS) {
        if (gs.dartNo % VISIT_SIZE === VISIT_SIZE - 1) {
          gs.phase = 'visit';
          gs.visitStart = now;
          setPhase('visit');
          playDing();
        } else {
          gs.dartNo += 1;
          gs.phase = 'aimX';
          gs.land = null;
          gs.hit = null;
          gs.sweepBase = now;
          setDartNo(gs.dartNo);
          setPhase('aimX');
        }
      }

      // Visit beat over: pull the darts, start the next visit — or finish.
      if (gs.phase === 'visit' && now - gs.visitStart >= VISIT_MS) {
        if (gs.dartNo >= DARTS - 1) {
          gs.phase = 'done';
          setPhase('done');
          playFanfare();
        } else {
          gs.dartNo += 1;
          gs.marks = [];
          gs.visitTotal = 0;
          gs.land = null;
          gs.hit = null;
          gs.phase = 'aimX';
          gs.sweepBase = now;
          setDartNo(gs.dartNo);
          setPhase('aimX');
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
  }, [active]);

  const onTap = useCallback(() => {
    const gs = gsRef.current;
    const now = performance.now();
    if (gs.phase === 'aimX') {
      // Lock to the last *rendered* sweep position, not a re-read of the clock,
      // so the dart lands exactly under the crosshair the player saw.
      gs.lockX = guideRef.current.x;
      gs.phase = 'aimY';
      gs.sweepBase = now;
      setPhase('aimY');
      playStroke();
    } else if (gs.phase === 'aimY') {
      const y = guideRef.current.y;
      gs.land = { x: gs.lockX, y };
      gs.hit = scoreAt(gs.lockX, y);
      gs.phase = 'flying';
      gs.flyStart = now;
      setPhase('flying');
      const fx = fxRef.current;
      fx.trail.length = 0;
      playStroke();
    }
  }, []);

  const start = useCallback(() => {
    const now = performance.now();
    const gs = freshGS(now);
    gs.phase = 'countdown';
    gs.countStart = now;
    gsRef.current = gs;
    fxRef.current = freshFX();
    guideRef.current = { x: SWEEP_X0, y: SWEEP_Y0 };
    setPhase('countdown');
    setDartNo(0);
    setTotal(0);
    setLastHit(null);
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    const remark =
      total >= 200
        ? 'One-hundred-and-EIGHTY energy! 🎯'
        : total >= 120
          ? 'Sharp arrows! 🎯'
          : total >= 60
            ? 'Solid darts! 👍'
            : 'Keep throwing! 🎮';
    return (
      <Screen>
        <TopBar title="Darts" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🎯</span>
            <div className="text-5xl font-black text-fairway-50">{total}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">across {DARTS} darts · 3 visits</p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (1 ticket per 4 points, capped at 100). */}
          <GameTicketAward game="darts" tickets={Math.min(100, Math.round(total / 4))} sessionId={sessionId} />
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
      ? 'Two-tap timing: tap to lock left–right, tap again to lock up–down.'
      : phase === 'countdown'
        ? 'Get ready…'
        : phase === 'aimX'
          ? 'Tap to lock your aim (left–right).'
          : phase === 'aimY'
            ? 'Tap to lock the height (up–down).'
            : phase === 'flying'
              ? 'Away it goes…'
              : phase === 'visit'
                ? 'Pulling darts from the board…'
                : lastHit && lastHit.points > 0
                  ? `${hitLabel(lastHit) || 'Single'} — +${lastHit.points}!`
                  : 'Off the board — no score!';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Darts" back="/fun" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Dart <span className="text-fairway-100">{Math.min(dartNo + 1, DARTS)}</span>
          <span className="font-normal text-fairway-400"> / {DARTS}</span>
          <span className="font-normal text-fairway-400"> · Visit {Math.floor(dartNo / VISIT_SIZE) + 1}</span>
        </span>
        <span className="text-fairway-300">
          Score <span className="font-bold text-fairway-100">{total}</span>
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
            <span className="text-5xl">🎯</span>
            <p className="text-sm text-fairway-100">
              Tap to lock left–right, tap again to lock up–down. {DARTS} darts in 3 visits — trebles, doubles and
              bulls score big.
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
