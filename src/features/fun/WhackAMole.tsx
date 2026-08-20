import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameAwards from './GameAwards';
import GameHighScore from './GameHighScore';
import { useFitCanvas } from './useFitCanvas';
import { drawLogo } from './logo';
import { playBump, playCup, playBuzz, playStroke, playTick, playFanfare } from '../../lib/sound';
import type { Particle, Floater } from './fx';
import Icon from '../../ui/Icon';
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
  decay,
  shakeOffset,
} from './fx';

// §12 Whack-a-Mole — the arcade classic. Gophers pop out of nine holes on the
// fairway; tap them before they duck back down. Golden gophers are worth extra,
// bombs cost you points — 30 seconds, moles get faster as the clock runs.
// Pure tap reflexes, canvas-rendered, client-side, offline.

// —— Playfield geometry (logical units; the canvas scales to fit) —————————————
const W = 340;
const H = 560;

// 3×3 hole grid. Rows scale up slightly toward the bottom for a hint of depth.
const COLS_X = [64, 170, 276];
const ROWS: Array<{ y: number; s: number }> = [
  { y: 190, s: 0.86 },
  { y: 320, s: 0.96 },
  { y: 452, s: 1.06 },
];
const HOLES: Array<{ x: number; y: number; s: number }> = ROWS.flatMap((row) =>
  COLS_X.map((x) => ({ x, y: row.y, s: row.s })),
);

const HOLE_RX = 40; // hole ellipse radii (pre-scale)
const HOLE_RY = 14;
const RISE_H = 58; // how far the head rises out of the hole
const HIT_R = 42; // generous tap radius around the head

const GAME_MS = 30_000;
const COUNT_STEP_MS = 800; // per digit of the "3, 2, 1" countdown
const GO_MS = 500; // beat of "GO!" after the digits, before play starts
const COUNTDOWN_MS = 3 * COUNT_STEP_MS + GO_MS;
const RISE_MS = 150;
const SINK_MS = 150;
const WHACK_MS = 300; // squashed-with-stars linger before the mole is removed
const MAX_ACTIVE = 4;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Difficulty ramp 0→1 across the round. */
const ramp = (elapsed: number) => Math.min(1, Math.max(0, elapsed / GAME_MS));

/** Ms between spawns — quickens as the round runs. */
const spawnInterval = (p: number) => lerp(820, 380, p);

/** Ms a mole holds at the top before sinking — shrinks as the round runs. */
const upDuration = (p: number) => lerp(950, 520, p);

type MoleKind = 'mole' | 'gold' | 'bomb';
type MolePhase = 'rising' | 'up' | 'sinking' | 'whacked';
type Mole = {
  hole: number; // index into HOLES
  kind: MoleKind;
  phase: MolePhase;
  phaseAt: number; // timestamp the current phase began
  upMs: number; // hold time at the top (rolled at spawn)
  whackH: number; // height when whacked (so the squash lands where it was hit)
};

const POINTS: Record<MoleKind, number> = { mole: 1, gold: 3, bomb: -3 };

/** Roll a spawn kind — bombs only enter after a grace period, golds stay rare. */
function rollKind(elapsed: number): MoleKind {
  const r = Math.random();
  if (r < 0.12) return 'gold';
  if (elapsed > 4000 && r < 0.12 + 0.1 + 0.1 * ramp(elapsed)) return 'bomb';
  return 'mole';
}

type Phase = 'ready' | 'countdown' | 'playing' | 'done';
type GS = {
  phase: Phase;
  countStart: number; // timestamp the countdown began
  startAt: number; // timestamp play began
  score: number;
  hits: number; // moles + golds bopped (bombs excluded)
  streak: number; // current run of clean bops
  bestStreak: number; // longest run this round — the Mole Patrol achievement
  moles: Mole[];
  nextSpawnAt: number;
  lastTickSec: number; // last whole second we played the countdown tick for
};

function freshGS(): GS {
  return {
    phase: 'ready',
    countStart: 0,
    startAt: 0,
    score: 0,
    hits: 0,
    streak: 0,
    bestStreak: 0,
    moles: [],
    nextSpawnAt: 0,
    lastTickSec: -1,
  };
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// Advanced per animation frame with a real dt; they only ever paint pixels.
// Built on the shared ./fx toolkit so every Fun Zone game shares one visual
// language.
type FX = {
  particles: Particle[]; // dirt / spark bursts on whacks
  floaters: Floater[]; // rising "+1" / "−3" score popups
  mallet: { x: number; y: number; t0: number } | null; // brief swing at the tap point
  shake: number; // bomb-impact shake magnitude (px), decays to 0
  flash: number; // full-screen flash 0..1, decays to 0
  flashColor: string;
};

function freshFX(): FX {
  return { particles: [], floaters: [], mallet: null, shake: 0, flash: 0, flashColor: '#f87171' };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, dt: number) {
  fx.particles = stepParticles(fx.particles, dt, 0.02, 260); // gravity so dirt falls
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** Current head-rise 0..1 for a mole (0 = fully in the hole, 1 = fully up). */
function moleHeight(m: Mole, now: number): number {
  const t = now - m.phaseAt;
  if (m.phase === 'rising') return Math.min(1, t / RISE_MS);
  if (m.phase === 'up') return 1;
  if (m.phase === 'sinking') return Math.max(0, 1 - t / SINK_MS);
  return m.whackH; // whacked — squash in place
}

/** The gopher itself, head center at (x, hy), pre-scaled by the caller. */
function drawGopher(ctx: CanvasRenderingContext2D, x: number, hy: number, kind: MoleKind) {
  if (kind === 'bomb') {
    // Round black bomb with a lit fuse — unmistakably "don't hit me". (Except
    // you do get to decide the hard way.)
    drawSphere(ctx, x, hy + 6, 26, '#64748b', '#1f2937', '#020617', { rim: true });
    ctx.strokeStyle = '#8b5a2b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 2, hy - 19);
    ctx.quadraticCurveTo(x + 12, hy - 30, x + 18, hy - 26);
    ctx.stroke();
    // Fuse spark.
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + 19, hy - 26, 4, 0, TWO_PI);
    ctx.fillStyle = '#fde68a';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();
    return;
  }

  const gold = kind === 'gold';
  const fur: [string, string, string] = gold
    ? ['#fef3c7', '#f59e0b', '#92400e']
    : ['#c8a06a', '#8b5e34', '#4a2f18'];

  // Ears behind the head.
  drawSphere(ctx, x - 17, hy - 18, 7, fur[0], fur[1], fur[2], { specular: false });
  drawSphere(ctx, x + 17, hy - 18, 7, fur[0], fur[1], fur[2], { specular: false });
  // Body below the head (mostly hidden by the hole clip at low heights).
  drawSphere(ctx, x, hy + 26, 22, fur[0], fur[1], fur[2], { specular: false });
  // Head.
  drawSphere(ctx, x, hy, 24, fur[0], fur[1], fur[2], { rim: gold });
  // Muzzle.
  drawSphere(ctx, x, hy + 9, 11, '#fbe8cf', '#e7c8a0', '#b08a5e', { specular: false });
  // Eyes.
  for (const dx of [-9, 9]) {
    ctx.beginPath();
    ctx.arc(x + dx, hy - 5, 3.4, 0, TWO_PI);
    ctx.fillStyle = '#1c1007';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + dx + 1.1, hy - 6.1, 1.1, 0, TWO_PI);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
  }
  // Nose + buck teeth.
  ctx.beginPath();
  ctx.arc(x, hy + 5, 3, 0, TWO_PI);
  ctx.fillStyle = '#d16d8a';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 3.6, hy + 9, 3.2, 5.5);
  ctx.fillRect(x + 0.4, hy + 9, 3.2, 5.5);
  // The gold gopher wears an actual crown. (It replaced a single amber glint
  // by the ear that sat almost exactly where the bomb draws its lit fuse
  // spark — gold gophers were being read as bombs. Royalty is unambiguous.)
  if (gold) {
    const cy = hy - 22; // band bottom rests on the crown of the head
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - 11, cy);
    ctx.lineTo(x - 13, cy - 12);
    ctx.lineTo(x - 6.5, cy - 5);
    ctx.lineTo(x, cy - 15);
    ctx.lineTo(x + 6.5, cy - 5);
    ctx.lineTo(x + 13, cy - 12);
    ctx.lineTo(x + 11, cy);
    ctx.closePath();
    const cg = ctx.createLinearGradient(x, cy - 15, x, cy);
    cg.addColorStop(0, '#fde68a');
    cg.addColorStop(1, '#d97706');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // A ruby on the band.
    ctx.beginPath();
    ctx.arc(x, cy - 2.5, 2.2, 0, TWO_PI);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    // Two white twinkles flanking the crown — clear of the ears, and cool
    // white so nothing near the head shares the fuse spark's amber glow.
    ctx.fillStyle = '#fffbeb';
    ctx.shadowColor = '#fde68a';
    ctx.shadowBlur = 5;
    ctx.textAlign = 'center';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillText('✦', x - 20, hy - 33);
    ctx.fillText('✦', x + 20, hy - 33);
    ctx.restore();
  }
}

/** Dizzy stars over a just-whacked mole. */
function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const a = Math.max(0, 1 - t / WHACK_MS);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#fde68a';
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur = 8;
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const spin = t * 0.006;
  for (let i = 0; i < 3; i++) {
    const ang = spin + (i * TWO_PI) / 3;
    ctx.fillText('★', x + Math.cos(ang) * 22, y - 16 + Math.sin(ang) * 7);
  }
  ctx.restore();
}

/** One hole + its occupant, clipped so the mole rises out of the ground. */
function drawHole(ctx: CanvasRenderingContext2D, hi: number, mole: Mole | null, now: number) {
  const { x, y, s } = HOLES[hi];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  // Dirt rim + dark opening.
  ctx.beginPath();
  ctx.ellipse(0, 1.5, HOLE_RX + 5, HOLE_RY + 4, 0, 0, TWO_PI);
  ctx.fillStyle = '#3f2c17';
  ctx.fill();
  const pit = ctx.createRadialGradient(0, 0, 3, 0, 0, HOLE_RX);
  pit.addColorStop(0, '#06080d');
  pit.addColorStop(1, '#1a1208');
  ctx.beginPath();
  ctx.ellipse(0, 0, HOLE_RX, HOLE_RY, 0, 0, TWO_PI);
  ctx.fillStyle = pit;
  ctx.fill();

  if (mole) {
    const h = moleHeight(mole, now);
    // Clip to the column above the hole's midline so the body reads as
    // emerging from underground rather than standing on it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-HOLE_RX - 8, -130, (HOLE_RX + 8) * 2, 130);
    ctx.ellipse(0, 0, HOLE_RX, HOLE_RY, 0, 0, TWO_PI);
    ctx.clip();
    const hy = 10 - h * RISE_H; // head center: buried → proud of the hole
    if (mole.phase === 'whacked') {
      // Squashed flat where it was hit.
      const t = now - mole.phaseAt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / WHACK_MS);
      ctx.translate(0, hy + 10);
      ctx.scale(1.25, 0.55);
      ctx.translate(0, -(hy + 10));
      drawGopher(ctx, 0, hy, mole.kind);
      ctx.restore();
    } else {
      drawGopher(ctx, 0, hy, mole.kind);
    }
    ctx.restore();
    if (mole.phase === 'whacked' && mole.kind !== 'bomb') {
      drawStars(ctx, 0, 10 - mole.whackH * RISE_H, now - mole.phaseAt);
    }
  }

  // Front lip of the hole over the mole to sell the depth.
  ctx.beginPath();
  ctx.ellipse(0, 0, HOLE_RX, HOLE_RY, 0, 0, Math.PI);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#54401f';
  ctx.stroke();

  ctx.restore();
}

/** Brief mallet swing at the tap point (rendering only). */
function drawMallet(ctx: CanvasRenderingContext2D, m: NonNullable<FX['mallet']>, now: number) {
  const MALLET_MS = 150;
  const t = now - m.t0;
  if (t > MALLET_MS) return;
  const p = t / MALLET_MS;
  // Swing in fast, hold, lift: angle eases -70° → -6°.
  const ang = (-70 + 64 * Math.min(1, p * 1.6)) * (Math.PI / 180);
  ctx.save();
  ctx.globalAlpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
  ctx.translate(m.x + 30, m.y - 34);
  ctx.rotate(ang);
  // Handle.
  const hg = ctx.createLinearGradient(-2.5, 0, 2.5, 0);
  hg.addColorStop(0, '#4a2f18');
  hg.addColorStop(0.5, '#a06a34');
  hg.addColorStop(1, '#3d2713');
  ctx.fillStyle = hg;
  ctx.fillRect(-3, -4, 6, 44);
  // Head — a side-on cylinder.
  const mg = ctx.createLinearGradient(0, -22, 0, 2);
  mg.addColorStop(0, '#fca5a5');
  mg.addColorStop(0.5, '#dc2626');
  mg.addColorStop(1, '#7f1d1d');
  roundRectPath(ctx, -20, -24, 40, 22, 9);
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, -20, -24, 40, 22, 9);
  ctx.stroke();
  ctx.restore();
}

// Fixed grass-tuft decorations (deterministic — no RNG in the draw path).
const TUFTS: Array<[number, number]> = [
  [34, 148], [140, 132], [252, 150], [308, 214], [22, 262], [220, 250],
  [116, 268], [318, 356], [40, 390], [150, 386], [260, 396], [86, 508],
  [206, 512], [304, 500],
];

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);

  // —— Fairway backdrop: sky strip → sunlit green + vignette ——————————————————
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#173a2a');
  bg.addColorStop(0.45, '#1d4d33');
  bg.addColorStop(1, '#12331f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const sheen = ctx.createRadialGradient(W / 2, 300, 30, W / 2, 300, H * 0.62);
  sheen.addColorStop(0, 'rgba(163,230,53,0.10)');
  sheen.addColorStop(1, 'rgba(163,230,53,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  // Grass tufts.
  ctx.strokeStyle = 'rgba(163,230,53,0.28)';
  ctx.lineWidth = 1.5;
  for (const [tx, ty] of TUFTS) {
    for (const dx of [-3, 0, 3]) {
      ctx.beginPath();
      ctx.moveTo(tx + dx, ty);
      ctx.lineTo(tx + dx * 1.6, ty - 7);
      ctx.stroke();
    }
  }

  // Mowed into the fairway across the top, between the clock bar (ends 22) and
  // the top-row moles (heads peak ~110 when fully risen). Wordmark, not the
  // lockup: the lockup tall enough to read here would run into the mole heads.
  drawLogo(ctx, W / 2, 58, { variant: 'wordmark', width: 150, tint: '#a3e635', alpha: 0.35 });

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // —— Clock bar across the top ———————————————————————————————————————————————
  if (gs.phase === 'playing' || gs.phase === 'done') {
    const left = gs.phase === 'done' ? 0 : Math.max(0, GAME_MS - (now - gs.startAt));
    const frac = left / GAME_MS;
    const col = frac > 0.5 ? '#4ade80' : frac > 0.2 ? '#fbbf24' : '#f87171';
    roundRectPath(ctx, 16, 14, W - 32, 8, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    if (frac > 0) {
      ctx.save();
      roundRectPath(ctx, 16, 14, (W - 32) * frac, 8, 4);
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }
  }

  // —— Dynamic layer (shaken on bomb hits) ————————————————————————————————————
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Holes back-to-front so lower rows overlap upper ones.
  const byHole: Array<Mole | null> = new Array(HOLES.length).fill(null);
  for (const m of gs.moles) byHole[m.hole] = m;
  for (let hi = 0; hi < HOLES.length; hi++) {
    // Soft contact shadow under each hole mound.
    const { x, y, s } = HOLES[hi];
    drawShadow(ctx, x, y + 6 * s, (HOLE_RX + 8) * s, (HOLE_RY + 3) * s, 0.22);
    drawHole(ctx, hi, byHole[hi], now);
  }

  // Additive dirt / spark particles.
  drawParticles(ctx, fx.particles);

  // Rising score popups.
  drawFloaters(ctx, fx.floaters);

  // The mallet swing rides above everything it hits.
  if (fx.mallet) drawMallet(ctx, fx.mallet, now);
  ctx.restore();

  // —— Bomb flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.25);
    ctx.fillRect(0, 0, W, H);
  }

  // "3, 2, 1, GO!" countdown before the round starts. The digits run first;
  // the last GO_MS of the phase shows "GO!" so the cue is actually visible
  // before the frame loop flips to 'playing'.
  if (gs.phase === 'countdown') {
    const left = COUNTDOWN_MS - (now - gs.countStart);
    const n = Math.ceil((left - GO_MS) / COUNT_STEP_MS);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = '#a3e635';
    ctx.shadowColor = 'rgba(163,230,53,0.7)';
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

export default function WhackAMole() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_MS / 1000);
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
    // Pause via visibilitychange, not a hidden-rAF branch: mobile browsers can
    // fully suspend requestAnimationFrame while backgrounded, so a hidden frame
    // may never run. Shift every absolute timestamp by the away span on resume
    // so the clock, spawns, and mole phases all freeze rather than skip.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const away = performance.now() - hiddenAt;
        hiddenAt = 0;
        const gs = gsRef.current;
        gs.countStart += away;
        gs.startAt += away;
        gs.nextSpawnAt += away;
        for (const m of gs.moles) m.phaseAt += away;
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
      const dt = Math.min(now - last, 100);
      last = now;

      if (gs.phase === 'countdown' && now - gs.countStart >= COUNTDOWN_MS) {
        gs.phase = 'playing';
        gs.startAt = now;
        gs.nextSpawnAt = now + 350;
        setPhase('playing');
      }

      if (gs.phase === 'playing') {
        const elapsed = now - gs.startAt;

        // Round over?
        if (elapsed >= GAME_MS) {
          gs.phase = 'done';
          setPhase('done');
          playFanfare();
        } else {
          // HUD clock (whole seconds) + urgency ticks for the last three.
          const secs = Math.ceil((GAME_MS - elapsed) / 1000);
          if (secs !== gs.lastTickSec) {
            gs.lastTickSec = secs;
            setTimeLeft(secs);
            if (secs <= 3) playTick();
          }

          // Spawns — pick a free hole; density and pace ramp with the clock.
          const p = ramp(elapsed);
          if (now >= gs.nextSpawnAt) {
            const occupied = new Set(gs.moles.map((m) => m.hole));
            const activeCount = gs.moles.filter((m) => m.phase !== 'whacked').length;
            const cap = Math.min(MAX_ACTIVE, 2 + Math.floor(p * 3));
            if (activeCount < cap && occupied.size < HOLES.length) {
              const free: number[] = [];
              for (let i = 0; i < HOLES.length; i++) if (!occupied.has(i)) free.push(i);
              const hole = free[Math.floor(Math.random() * free.length)];
              gs.moles.push({
                hole,
                kind: rollKind(elapsed),
                phase: 'rising',
                phaseAt: now,
                upMs: upDuration(p) * (0.8 + Math.random() * 0.4),
                whackH: 0,
              });
            }
            gs.nextSpawnAt = now + spawnInterval(p) * (0.75 + Math.random() * 0.5);
          }

          // Advance mole lifecycles.
          gs.moles = gs.moles.filter((m) => {
            const t = now - m.phaseAt;
            if (m.phase === 'rising' && t >= RISE_MS) {
              m.phase = 'up';
              m.phaseAt = now;
            } else if (m.phase === 'up' && t >= m.upMs) {
              m.phase = 'sinking';
              m.phaseAt = now;
            } else if (m.phase === 'sinking' && t >= SINK_MS) {
              return false; // got away
            } else if (m.phase === 'whacked' && t >= WHACK_MS) {
              return false;
            }
            return true;
          });
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

  const onTap = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const gs = gsRef.current;
    const fx = fxRef.current;
    if (gs.phase !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const now = performance.now();

    fx.mallet = { x, y, t0: now };

    // Nearest hittable mole under the tap (rising, up, or just starting to sink).
    let best: Mole | null = null;
    let bestD = Infinity;
    for (const m of gs.moles) {
      if (m.phase === 'whacked') continue;
      const h = moleHeight(m, now);
      if (h < 0.25) continue; // barely out — not fair game yet/anymore
      const { x: hx, y: hy, s } = HOLES[m.hole];
      const headY = hy + (10 - h * RISE_H) * s;
      const d = Math.hypot(x - hx, y - headY);
      if (d <= HIT_R * s && d < bestD) {
        best = m;
        bestD = d;
      }
    }

    if (!best) {
      // Whiff — a swish and a puff of turf where the mallet landed.
      spawnBurst(fx.particles, x, y + 6, 6, 110, '#3f6212');
      playStroke();
      return;
    }

    const h = moleHeight(best, now);
    best.whackH = h;
    best.phase = 'whacked';
    best.phaseAt = now;
    const { x: hx, y: hy, s } = HOLES[best.hole];
    const headY = hy + (10 - h * RISE_H) * s;
    const pts = POINTS[best.kind];
    gs.score = Math.max(0, gs.score + pts);
    setScore(gs.score);

    if (best.kind === 'bomb') {
      gs.streak = 0; // a bomb ends the run
      spawnBurst(fx.particles, hx, headY, 26, 320, '#fca5a5');
      fx.shake = 7;
      fx.flash = 1;
      fx.flashColor = '#f87171';
      spawnFloater(fx.floaters, hx, headY - 30, `${pts}`, '#f87171', { life: 750 });
      playBuzz();
    } else {
      gs.hits += 1;
      gs.streak += 1;
      gs.bestStreak = Math.max(gs.bestStreak, gs.streak);
      setHits(gs.hits);
      const gold = best.kind === 'gold';
      spawnBurst(fx.particles, hx, headY, gold ? 20 : 12, gold ? 260 : 180, gold ? '#fde68a' : '#c8963e');
      if (gold) {
        fx.flash = 0.6;
        fx.flashColor = '#fbbf24';
      }
      spawnFloater(fx.floaters, hx, headY - 30, `+${pts}`, gold ? '#fde68a' : '#bef264');
      if (gold) playCup();
      else playBump(1);
    }
  }, []);

  const start = useCallback(() => {
    const now = performance.now();
    const gs = freshGS();
    gs.phase = 'countdown';
    gs.countStart = now;
    gsRef.current = gs;
    fxRef.current = freshFX();
    setPhase('countdown');
    setScore(0);
    setHits(0);
    setTimeLeft(GAME_MS / 1000);
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    // The clean-run tally lives in the canvas game state, not React state.
    const gs = gsRef.current;
    const remark =
      score >= 38
        ? 'Mole mayhem master! 🔨'
        : score >= 26
          ? 'Gopher buster! 💥'
          : score >= 14
            ? 'Nice bopping! 👍'
            : 'Keep whacking! 🎮';
    return (
      <Screen>
        <TopBar title="Whack-a-Mole" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <Icon name="game.whack-a-mole" className="text-6xl" />
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">
              {hits} gopher{hits === 1 ? '' : 's'} bopped in {GAME_MS / 1000} seconds
            </p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (3 tickets per 2 points, clamped at 0 and capped at 100). */}
          <GameAwards
            game="whackamole"
            tickets={Math.min(100, Math.max(0, Math.round(score * 1.5)))}
            sessionId={sessionId}
            feat={gs.bestStreak >= 10 ? 'mole-streak' : undefined}
          />
          <GameHighScore game="whackamole" score={score} sessionId={sessionId} />
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
      ? 'Tap the gophers before they duck back down.'
      : phase === 'countdown'
        ? 'Get ready…'
        : 'Bop gophers! Gold is +3 — don’t hit the bombs!';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Whack-a-Mole" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Score <span className="text-fairway-100">{score}</span>
        </span>
        <span className="text-fairway-300">
          Time{' '}
          <span className={`font-bold ${phase === 'playing' && timeLeft <= 5 ? 'text-danger' : 'text-fairway-100'}`}>
            {phase === 'playing' ? timeLeft : GAME_MS / 1000}s
          </span>
        </span>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onTap}
          className="col-start-1 row-start-1 block touch-none rounded-2xl arcade-screen"
        />
        {phase === 'ready' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <Icon name="game.whack-a-mole" className="text-5xl" />
            <p className="text-sm text-fairway-100">
              Gophers pop out of the fairway — tap them before they vanish. Gold gophers are +3,
              bombs are −3. {GAME_MS / 1000} seconds on the clock!
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
