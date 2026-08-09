import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useFitCanvas } from './useFitCanvas';
import { playTick, playPinClack, playScore, playCup, playUndo, playFanfare, playDing } from '../../lib/sound';
import type { Particle, Floater } from './fx';
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
  decay,
  shakeOffset,
} from './fx';

// §12 Coin Pusher — the arcade coin-shelf machine as a Fun Zone mini-game.
// Looking down the tray: the pusher bar sweeps forward/back on a steady cycle,
// the tray opens on a RANDOM jammed pile — like the real machine, never a neat
// spaced grid: every coin held up by its neighbors, a few teetering half over
// the lip — and the glowing payout edge at the bottom is where they tip over
// and score. Tap along the top strip to drop one of your 20 coins at that x —
// timing drops against the pusher stroke (deep behind a retracted bar = a long
// shove) is the whole skill. Side gutters eat strays. Simple 2D disc physics
// on a fixed timestep, all client-side, offline.

// —— Machine geometry (logical units; the canvas scales to fit) ———————————————
const W = 340;
const H = 560;
const R = 11; // coin radius

const TOP_STRIP = 56; // tap-to-drop panel
const TAP_MAX = 140; // taps above this y count as drops
const HOLD_REPEAT_MS = 220; // press-and-hold auto-drop interval
const BACK_Y = 94; // mirrored back wall's bottom edge (bar emerges beneath it)
const P_MIN = 118; // pusher front face, retracted
const P_MAX = 190; // pusher front face, extended
const P_CYCLE = 2200; // ms per full sweep
const EDGE = 478; // payout lip — a coin center past this tips over and scores
const WALL_L = 16; // inner faces of the side rails
const WALL_R = W - 16;
const GUT_Y0 = 250; // below this y the side walls open into loss gutters

const STARTING_COINS = 20;
const TOPUP_COINS = 10; // "+ more coins" batch size — free and unlimited for now
const GOLD_ODDS = 1 / 6; // dropped coins only; pays ×5
const FIXED = 1000 / 120; // physics substep (ms)
const DT = FIXED / 1000;
const FR_PER_S = 0.12; // per-second velocity multiplier (tray friction)
const OVER_MS = 340; // payout tip-over flip animation
const LOST_MS = 260; // gutter drop-in animation
const COMBO_MS = 1000; // payouts this close together escalate as one stroke
const CLINK_GAP_MS = 85; // min gap between clink sounds (no machine-gunning)

// Real coin pushers are never freshly reset when you walk up — other players
// already fed it. A cold random jam commonly takes 80-120+ real drops before
// anything pays out (measured), so a fresh round "pre-plays" ~110 phantom
// drops (this game's own measured median time-to-first-payout) through the
// SAME physics before the player's first tap, landing them roughly where a
// typical round already would be — a head start, not a guarantee. Runs
// compressed (not in real time) in small chunks; see the priming effect.
const PRIME_DROPS = 110;
const PRIME_CADENCE_MS = 150; // internal phantom-drop spacing — not real-time pacing
const PRIME_SUBSTEPS_PER_CHUNK = 400; // budget per animation frame while priming

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Pusher front-face y at sim time `t` — a smooth forward/back sweep. */
function pusherFront(t: number): number {
  return P_MIN + (P_MAX - P_MIN) * (0.5 - 0.5 * Math.cos((TWO_PI * t) / P_CYCLE));
}

type CoinState = 'drop' | 'tray' | 'over' | 'lost';
type Coin = {
  id: number;
  x: number;
  y: number;
  vx: number; // px/s
  vy: number;
  gold: boolean;
  state: CoinState;
  t: number; // ms in current animation state ('over' / 'lost')
  landY: number; // where a 'drop' coin touches down
  tipAt: number; // this coin's personal tipping line past EDGE: the pack holds
  //               a few px of overhang, so lip coins teeter instead of marching
  //               off the moment their center crosses a fixed line
};

/** A coin's personal tipping line: 2..10px of overhang the pack can hold. */
function rollTipAt(): number {
  return EDGE + 2 + Math.random() * 8;
}

type Phase = 'ready' | 'priming' | 'play' | 'done';
type GS = {
  phase: Phase;
  coins: Coin[];
  coinsLeft: number;
  coinsDropped: number; // cumulative — the "buy more" batches can outrun a fixed budget
  score: number;
  simTime: number; // accumulated fixed-step time; freezes while hidden for free
  nextId: number;
  lastClinkSim: number;
  lastPayoutSim: number;
  comboCount: number; // payouts inside the current COMBO_MS window
  comboPay: number; // their summed value, for the "+4!!" popup
  endRequested: boolean; // player tapped Cash Out — end once nothing's mid-animation
};

/** The randomized jam: never the same pile twice, and never a neat spaced
 *  grid. Jittered, gappy, clumpy rows are seeded slightly overlapping from
 *  just ahead of the pusher's full extension down to the lip, then relaxed by
 *  the sim's own separation rule — so the game opens on a settled mass where
 *  every coin is held up by its neighbors, including a teasing few hanging
 *  part-way over the edge (held below their personal tipAt, so nothing falls
 *  for free). The pile still starts clear of the bar's sweep — dropped coins
 *  are what bridge the shove into it, same as ever — and it must still reach
 *  the lip: a sparser pile leaves a dead zone the 20 droppable coins could
 *  never bridge, and the game couldn't pay out at all. Seeded coins are all
 *  silver (gold only comes from drops). */
function seedCoins(): Coin[] {
  const coins: Coin[] = [];
  let id = 0;
  const Y0 = P_MAX + R + 2; // just clear of the fully-extended pusher face
  let y = Y0 + Math.random() * 8;
  while (y < EDGE + 2) {
    const n = 9 + Math.floor(Math.random() * 3); // 9..11 per row
    const rowShift = (Math.random() - 0.5) * 18;
    for (let k = 0; k < n; k++) {
      if (Math.random() < 0.12) continue; // gaps — the pile is clumpy, not full
      const x = W / 2 + rowShift + (k - (n - 1) / 2) * 27 + (Math.random() - 0.5) * 10;
      coins.push({
        id: id++,
        x: clamp(x, WALL_L + R, WALL_R - R),
        y: y + (Math.random() - 0.5) * 6,
        vx: 0,
        vy: 0,
        gold: false,
        state: 'tray',
        t: 0,
        landY: 0,
        tipAt: rollTipAt(),
      });
    }
    y += 17 + Math.random() * 4; // under one diameter, so rows land in contact
  }
  // Relax the seeded overlaps out (positions only, walls and lip clamped) so
  // the pile opens settled and mutually supporting — the "all held up" start.
  for (let iter = 0; iter < 90; iter++) {
    for (let i = 0; i < coins.length; i++) {
      const a = coins[i];
      for (let j = i + 1; j < coins.length; j++) {
        const b = coins[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const half = (2 * R - d) / 2;
        a.x -= (dx / d) * half;
        a.y -= (dy / d) * half;
        b.x += (dx / d) * half;
        b.y += (dy / d) * half;
      }
    }
    for (const c of coins) {
      c.x = clamp(c.x, WALL_L + R, WALL_R - R);
      // Held at the lip, not over it: the pack supports overhang up to tipAt.
      c.y = clamp(c.y, Y0, c.tipAt - 0.5);
    }
  }
  return coins;
}

function freshGS(): GS {
  const coins = seedCoins();
  return {
    phase: 'ready',
    coins,
    coinsLeft: STARTING_COINS,
    coinsDropped: 0,
    score: 0,
    simTime: 0,
    nextId: coins.length,
    lastClinkSim: -9999,
    lastPayoutSim: 0,
    comboCount: 0,
    comboPay: 0,
    endRequested: false,
  };
}

// Per-frame sim events, drained once per animation frame so sounds/fx never
// fire per-substep (which would machine-gun at 120 Hz).
type Events = {
  clink: number; // loudest coin↔coin closing speed this frame (px/s)
  landed: number; // landing clack intensity (0 = none)
  payouts: Array<{ x: number; gold: boolean }>;
  lost: Array<{ x: number; y: number }>;
};

/** One fixed physics substep: pusher wall, tray friction/integration, walls,
 *  iterative coin↔coin relaxation, then payout / gutter transitions. */
function step(gs: GS, ev: Events): void {
  gs.simTime += FIXED;
  const t = gs.simTime;
  const front = pusherFront(t);
  // Bar speed on the forward stroke — coins it touches are driven at least this
  // fast, which is what makes the shove feel mechanical rather than springy.
  const barV = Math.max(0, (front - pusherFront(t - FIXED)) / DT);
  const k = Math.pow(FR_PER_S, DT);

  for (const c of gs.coins) {
    if (c.state === 'drop') {
      // Sliding down the slot: simple accelerated fall to its landing spot.
      c.vy += 1500 * DT;
      c.y += c.vy * DT;
      if (c.y >= c.landY) {
        c.y = c.landY;
        c.vy = 30; // tiny forward bounce on touchdown
        c.state = 'tray';
        ev.landed = Math.max(ev.landed, 0.45);
      }
      continue;
    }
    if (c.state !== 'tray') {
      c.t += FIXED;
      continue;
    }
    c.vx *= k;
    c.vy *= k;
    if (Math.hypot(c.vx, c.vy) < 2) {
      c.vx = 0;
      c.vy = 0;
    }
    c.x += c.vx * DT;
    c.y += c.vy * DT;
    // Pusher bar as a moving wall: shoves forward on the forward stroke, and
    // simply retracts behind settled coins on the back stroke (friction holds
    // them), opening the gap a well-timed drop lands in.
    if (c.y < front + R) {
      c.y = front + R;
      if (c.vy < barV) c.vy = barV;
    }
    // Side walls exist only above the gutter mouths; below, strays can tip in.
    if (c.y < GUT_Y0) {
      if (c.x < WALL_L + R) {
        c.x = WALL_L + R;
        c.vx = Math.abs(c.vx) * 0.4;
      } else if (c.x > WALL_R - R) {
        c.x = WALL_R - R;
        c.vx = -Math.abs(c.vx) * 0.4;
      }
    }
  }

  // Coin↔coin: positional relaxation (two passes) + one impulse pass, so packed
  // coins transmit the pusher's shove through the pile without jitter.
  const cs = gs.coins;
  const min = 2 * R;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (a.state !== 'tray') continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (b.state !== 'tray') continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const half = (min - d) / 2;
        a.x -= nx * half;
        a.y -= ny * half;
        b.x += nx * half;
        b.y += ny * half;
        if (pass === 0) {
          const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; // closing speed
          if (rel > 0) {
            const imp = (rel * 1.25) / 2; // restitution 0.25, equal masses
            a.vx -= imp * nx;
            a.vy -= imp * ny;
            b.vx += imp * nx;
            b.vy += imp * ny;
            if (rel > ev.clink) ev.clink = rel;
          }
        }
      }
    }
  }

  for (const c of cs) {
    if (c.state !== 'tray') continue;
    if (c.y > c.tipAt) {
      c.state = 'over';
      c.t = 0;
      ev.payouts.push({ x: c.x, gold: c.gold });
    } else if (c.y >= GUT_Y0 && (c.x < WALL_L - 3 || c.x > WALL_R + 3)) {
      c.state = 'lost';
      c.t = 0;
      ev.lost.push({ x: c.x, y: c.y });
    }
  }
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
type FX = {
  particles: Particle[];
  floaters: Floater[];
  shake: number;
  flash: number;
  flashColor: string;
};

function freshFX(): FX {
  return { particles: [], floaters: [], shake: 0, flash: 0, flashColor: '#fde047' };
}

function updateFX(fx: FX, dt: number) {
  fx.particles = stepParticles(fx.particles, dt);
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
function drawCoinFace(ctx: CanvasRenderingContext2D, x: number, y: number, gold: boolean) {
  if (gold) drawSphere(ctx, x, y, R, '#fef3c7', '#fbbf24', '#a16207');
  else drawSphere(ctx, x, y, R, '#ffffff', '#d7dee8', '#7c8798');
  // Incised inner ring so it reads as a coin, not a ball.
  ctx.beginPath();
  ctx.arc(x, y, R * 0.66, 0, TWO_PI);
  ctx.strokeStyle = gold ? 'rgba(120,72,10,0.55)' : 'rgba(75,88,105,0.5)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawCoin(ctx: CanvasRenderingContext2D, c: Coin, simTime: number) {
  if (c.state === 'over') {
    // Tipping over the payout lip: slide down while squashing flat and fading.
    const p = Math.min(1, c.t / OVER_MS);
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.translate(c.x, c.y + p * 16);
    ctx.scale(1, Math.max(0.15, 1 - p));
    drawCoinFace(ctx, 0, 0, c.gold);
    ctx.restore();
    return;
  }
  if (c.state === 'lost') {
    const p = Math.min(1, c.t / LOST_MS);
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.translate(c.x, c.y);
    const s = 1 - p * 0.6;
    ctx.scale(s, s);
    drawCoinFace(ctx, 0, 0, c.gold);
    ctx.restore();
    return;
  }
  // Overhanging the lip: lean forward and rock a little — held up, for now.
  if (c.state === 'tray' && c.y > EDGE - 2) {
    const p = clamp((c.y - (EDGE - 2)) / (c.tipAt - EDGE + 2), 0, 1);
    const wobble = Math.sin(simTime * 0.008 + c.id * 2.1) * p * 1.4;
    ctx.save();
    ctx.translate(c.x, c.y + p * 3 + wobble);
    ctx.scale(1, 1 - p * 0.22);
    drawCoinFace(ctx, 0, 0, c.gold);
    ctx.restore();
    return;
  }
  if (c.state === 'tray') drawShadow(ctx, c.x, c.y + 4, R * 0.95, R * 0.5, 0.35);
  drawCoinFace(ctx, c.x, c.y, c.gold);
  // Gold sparkle — orbit angle and twinkle derived from simTime + id, so the
  // draw path stays deterministic per frame (no RNG).
  if (c.gold && c.state === 'tray') {
    const a = simTime * 0.003 + c.id * 1.7;
    const sx = c.x + Math.cos(a) * R * 0.5;
    const sy = c.y + Math.sin(a) * R * 0.5;
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(simTime * 0.01 + c.id));
    ctx.save();
    ctx.strokeStyle = `rgba(255,251,235,${tw})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sx - 3.5, sy);
    ctx.lineTo(sx + 3.5, sy);
    ctx.moveTo(sx, sy - 3.5);
    ctx.lineTo(sx, sy + 3.5);
    ctx.stroke();
    ctx.restore();
  }
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX) {
  ctx.clearRect(0, 0, W, H);

  // —— Cabinet base ——
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#101623');
  bg.addColorStop(0.6, '#0b101b');
  bg.addColorStop(1, '#080c14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // —— Tray floor (brushed metal, falling into shadow toward the lip) ——
  const tray = ctx.createLinearGradient(0, BACK_Y, 0, EDGE);
  tray.addColorStop(0, '#2c3a4e');
  tray.addColorStop(0.55, '#1c2636');
  tray.addColorStop(1, '#131b28');
  ctx.fillStyle = tray;
  ctx.fillRect(WALL_L, BACK_Y, WALL_R - WALL_L, EDGE - BACK_Y);
  // Faint brushed sheen lines (fixed spacing — identical every frame).
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let y = BACK_Y + 24; y < EDGE; y += 34) {
    ctx.beginPath();
    ctx.moveTo(WALL_L, y);
    ctx.lineTo(WALL_R, y);
    ctx.stroke();
  }

  // —— Side rails + loss gutters (dark slots the coins vanish into) ——
  ctx.fillStyle = '#0a0e16';
  ctx.fillRect(0, TOP_STRIP, WALL_L, EDGE - TOP_STRIP);
  ctx.fillRect(WALL_R, TOP_STRIP, W - WALL_R, EDGE - TOP_STRIP);
  ctx.fillStyle = '#03040a';
  ctx.fillRect(3, GUT_Y0, WALL_L - 4, EDGE - GUT_Y0);
  ctx.fillRect(WALL_R + 1, GUT_Y0, WALL_L - 4, EDGE - GUT_Y0);
  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(3, GUT_Y0, WALL_L - 4, EDGE - GUT_Y0);
  ctx.strokeRect(WALL_R + 1, GUT_Y0, WALL_L - 4, EDGE - GUT_Y0);

  // —— Payout chute + glowing lip ——
  const chute = ctx.createLinearGradient(0, EDGE, 0, H);
  chute.addColorStop(0, '#0a0d15');
  chute.addColorStop(1, '#04060b');
  ctx.fillStyle = chute;
  ctx.fillRect(0, EDGE, W, H - EDGE);
  neonLine(ctx, WALL_L, EDGE + 2, WALL_R, EDGE + 2, '#fbbf24', 4, 14);
  ctx.save();
  ctx.fillStyle = 'rgba(251,191,36,0.35)';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('P A Y O U T', W / 2, EDGE + 44);
  ctx.restore();

  // —— Mirrored back wall (faint reflections of the nearest coins) ——
  const wall = ctx.createLinearGradient(0, TOP_STRIP, 0, BACK_Y);
  wall.addColorStop(0, '#4a5a74');
  wall.addColorStop(0.5, '#33425c');
  wall.addColorStop(1, '#22304a');
  ctx.fillStyle = wall;
  ctx.fillRect(WALL_L, TOP_STRIP, WALL_R - WALL_L, BACK_Y - TOP_STRIP);
  ctx.save();
  ctx.beginPath();
  ctx.rect(WALL_L, TOP_STRIP, WALL_R - WALL_L, BACK_Y - TOP_STRIP);
  ctx.clip();
  for (const c of gs.coins) {
    if (c.state !== 'tray' || c.y > 300) continue;
    const ry = BACK_Y - (c.y - BACK_Y) * 0.18;
    ctx.beginPath();
    ctx.ellipse(c.x, ry, R * 0.9, R * 0.45, 0, 0, TWO_PI);
    ctx.fillStyle = withAlpha(c.gold ? '#fbbf24' : '#cbd5e1', 0.12);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(200,220,255,0.25)';
  ctx.fillRect(WALL_L, BACK_Y - 2, WALL_R - WALL_L, 2);

  // —— Top drop strip ——
  ctx.fillStyle = '#0d1420';
  ctx.fillRect(0, 0, W, TOP_STRIP);
  ctx.save();
  ctx.fillStyle = 'rgba(251,191,36,0.5)';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('T A P   T O   D R O P', W / 2, 20);
  for (let k = 0; k < 5; k++) {
    const x = 50 + k * 60;
    ctx.beginPath();
    ctx.moveTo(x - 6, 32);
    ctx.lineTo(x + 6, 32);
    ctx.lineTo(x, 44);
    ctx.closePath();
    ctx.fillStyle = 'rgba(251,191,36,0.4)';
    ctx.fill();
  }
  ctx.restore();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(251,191,36,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(WALL_L, TOP_STRIP - 2);
  ctx.lineTo(WALL_R, TOP_STRIP - 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // —— Dynamic layer (shaken on big payouts) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Pusher bar — metallic slab sliding out from under the back wall.
  const front = pusherFront(gs.simTime);
  const body = ctx.createLinearGradient(0, 70, 0, front);
  body.addColorStop(0, '#46587a');
  body.addColorStop(1, '#2c3a55');
  roundRectPath(ctx, 20, 70, W - 40, front - 70, 6);
  ctx.fillStyle = body;
  ctx.fill();
  const face = ctx.createLinearGradient(0, front - 8, 0, front);
  face.addColorStop(0, '#8ea6cc');
  face.addColorStop(1, '#5a6f96');
  ctx.fillStyle = face;
  ctx.fillRect(20, front - 8, W - 40, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(20, front, W - 40, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.arc(W / 2 - 60, (70 + front) / 2, 3, 0, TWO_PI);
  ctx.arc(W / 2 + 60, (70 + front) / 2, 3, 0, TWO_PI);
  ctx.fill();

  // Coins, painter-ordered so nearer coins overlap farther ones.
  const sorted = [...gs.coins].sort((a, b) => a.y - b.y);
  for (const c of sorted) drawCoin(ctx, c, gs.simTime);

  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
  ctx.restore();

  // —— Payout flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }
}

export default function CoinPusher() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('ready');
  const [coinsLeft, setCoinsLeft] = useState(STARTING_COINS);
  const [score, setScore] = useState(0);
  const [coinsDropped, setCoinsDropped] = useState(0); // for the done screen
  const [ending, setEnding] = useState(false); // cash-out tapped, waiting to settle

  const active = phase !== 'done';
  useFitCanvas(canvasRef, W, H, active);

  // Render + physics loop (fixed-timestep accumulator).
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
    // suspend requestAnimationFrame entirely while backgrounded, so a hidden
    // frame may never run to keep `last` fresh. All sim timing (pusher phase,
    // settle timer, combo windows) runs on gs.simTime, which only advances via
    // substeps — so dropping the accumulator on resume freezes everything.
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

      const ev: Events = { clink: 0, landed: 0, payouts: [], lost: [] };
      if (gs.phase === 'play') {
        while (acc >= FIXED) {
          step(gs, ev);
          acc -= FIXED;
        }
        // Cull finished tip-over / gutter animations once per frame.
        if (gs.coins.some((c) => (c.state === 'over' && c.t > OVER_MS) || (c.state === 'lost' && c.t > LOST_MS))) {
          gs.coins = gs.coins.filter(
            (c) => !((c.state === 'over' && c.t > OVER_MS) || (c.state === 'lost' && c.t > LOST_MS)),
          );
        }
      } else {
        acc = 0;
      }

      // —— Clinks: loudest impact this frame, rate-limited on the sim clock ——
      if (gs.simTime - gs.lastClinkSim > CLINK_GAP_MS) {
        if (ev.clink > 50) {
          gs.lastClinkSim = gs.simTime;
          playPinClack(clamp(ev.clink / 200, 0.3, 1.3));
        } else if (ev.landed > 0) {
          gs.lastClinkSim = gs.simTime;
          playPinClack(ev.landed);
        }
      }

      // —— Payouts ——
      if (ev.payouts.length) {
        let goldPaid = false;
        for (const p of ev.payouts) {
          const val = p.gold ? 5 : 1;
          if (gs.simTime - gs.lastPayoutSim <= COMBO_MS) {
            gs.comboCount += 1;
            gs.comboPay += val;
          } else {
            gs.comboCount = 1;
            gs.comboPay = val;
          }
          gs.lastPayoutSim = gs.simTime;
          gs.score += val;
          goldPaid = goldPaid || p.gold;
          const fxX = clamp(p.x, 40, W - 40);
          spawnFloater(fx.floaters, fxX, EDGE - 14, p.gold ? '+5' : '+1', p.gold ? '#fbbf24' : '#a7f3d0', {
            size: p.gold ? 24 : 18,
          });
          spawnBurst(fx.particles, p.x, EDGE, p.gold ? 22 : 10, p.gold ? 260 : 150, p.gold ? '#fde047' : '#bae6fd');
        }
        setScore(gs.score);
        playScore();
        fx.shake = Math.max(fx.shake, goldPaid ? 4 : 2);
        if (goldPaid) {
          playCup();
          fx.flash = 1;
          fx.flashColor = '#fbbf24';
        }
        // A multi-coin stroke escalates: one big popup for the window's total.
        if (gs.comboCount >= 2) {
          spawnFloater(fx.floaters, W / 2, EDGE - 52, `+${gs.comboPay}!!`, '#fde047', { size: 30, life: 900 });
          fx.shake = Math.max(fx.shake, Math.min(9, 2 + gs.comboCount * 1.6));
          if (gs.comboCount >= 3) {
            fx.flash = Math.max(fx.flash, 0.8);
            fx.flashColor = '#fde047';
          }
        }
      }

      // —— Gutter losses (subtle — it's a small sting, not a fail state) ——
      if (ev.lost.length) {
        playUndo();
        for (const l of ev.lost) spawnBurst(fx.particles, l.x, l.y, 6, 90, '#475569');
      }

      // —— End: player cashed out and nothing's still mid-animation ——
      // Coins are free to top up now (no fixed budget), so there's no natural
      // "ran out" ending anymore — the round only ends when the player says so.
      if (
        gs.phase === 'play' &&
        gs.endRequested &&
        !gs.coins.some((c) => c.state === 'drop' || c.state === 'over')
      ) {
        gs.phase = 'done';
        setPhase('done');
        playFanfare();
      }

      updateFX(fx, dt);
      draw(ctx, gs, fx);
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

  // Deep, dense, and lossy by design (see seedCoins above) — a real jam
  // routinely takes 80-120+ drops before anything reaches the lip, win or
  // lose on timing. Requiring that many individual taps is the tedious part,
  // not the physics: press-and-hold auto-drops at HOLD_REPEAT_MS, tracking
  // the pointer's x, so grinding through a jam takes a few seconds of holding
  // instead of 100+ individual taps. A brief tap still drops just one coin
  // (holdTimer never fires before release), so the original feel is unchanged.
  const holdTimer = useRef<number | null>(null);
  const holdX = useRef(0);

  const dropAt = useCallback((x: number) => {
    const gs = gsRef.current;
    if (gs.phase !== 'play' || gs.coinsLeft <= 0 || gs.endRequested) return;
    // Land just behind the pusher's CURRENT front — drop while it's retracted
    // and the coin sits deep in the gap, riding the whole forward stroke.
    const landY = pusherFront(gs.simTime) + R + 2;
    gs.coins.push({
      id: gs.nextId++,
      x,
      y: 30,
      vx: 0,
      vy: 120,
      gold: Math.random() < GOLD_ODDS,
      state: 'drop',
      t: 0,
      landY,
      tipAt: rollTipAt(),
    });
    gs.coinsLeft -= 1;
    gs.coinsDropped += 1;
    setCoinsLeft(gs.coinsLeft);
    setCoinsDropped(gs.coinsDropped);
    playTick();
  }, []);

  const stopHold = useCallback(() => {
    if (holdTimer.current != null) {
      window.clearInterval(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (gs.phase !== 'play' || gs.coinsLeft <= 0 || gs.endRequested) return;
      const p = toField(e);
      if (p.y > TAP_MAX) return;
      const x = clamp(p.x, WALL_L + R + 1, WALL_R - R - 1);
      canvasRef.current?.setPointerCapture(e.pointerId);
      holdX.current = x;
      dropAt(x);
      stopHold();
      holdTimer.current = window.setInterval(() => dropAt(holdX.current), HOLD_REPEAT_MS);
    },
    [toField, dropAt, stopHold],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (holdTimer.current == null) return; // only track while actively holding
      const p = toField(e);
      holdX.current = clamp(p.x, WALL_L + R + 1, WALL_R - R - 1);
    },
    [toField],
  );

  // Stop the repeat on release, drag-off-canvas, or a lost pointer (app
  // backgrounded mid-hold) — setPointerCapture below keeps move/up events
  // targeting the canvas even if the finger wanders outside it.
  useEffect(() => stopHold, [stopHold]);

  /** Free top-up — unlimited for now (a ticket cost is a later addition). */
  const buyMore = useCallback(() => {
    const gs = gsRef.current;
    if (gs.phase !== 'play' || gs.endRequested) return;
    gs.coinsLeft += TOPUP_COINS;
    setCoinsLeft(gs.coinsLeft);
    playDing();
  }, []);

  /** Ends the round once whatever's currently mid-flight settles. */
  const cashOut = useCallback(() => {
    const gs = gsRef.current;
    if (gs.phase !== 'play' || gs.endRequested) return;
    stopHold();
    gs.endRequested = true;
    setEnding(true);
  }, [stopHold]);

  const start = useCallback(() => {
    // Priming (below) builds the actual starting board; this just clears the
    // HUD and hands off to it. gsRef/fxRef are swapped in once priming
    // finishes — whatever they currently hold (a finished previous round, or
    // the untouched initial mount) just sits there, hidden behind the
    // priming overlay, until the swap.
    setPhase('priming');
    setCoinsLeft(STARTING_COINS);
    setScore(0);
    setCoinsDropped(0);
    setEnding(false);
  }, []);

  // Pre-play ~PRIME_DROPS phantom drops through the real physics before the
  // player's round starts (see PRIME_DROPS above for why), entirely on a
  // throwaway GS so the visible board never flickers mid-simulation — it
  // jump-cuts once from whatever was there before straight to the finished,
  // primed board. Runs in chunks across animation frames (not one blocking
  // call) since a phone can take noticeably longer than a dev machine to
  // grind through ~2000 physics substeps.
  useEffect(() => {
    if (phase !== 'priming') return;
    const gs = freshGS();
    let drops = 0;
    let nextDropAt = 0;
    let raf = 0;
    let cancelled = false;

    function chunk() {
      if (cancelled) return;
      for (let i = 0; i < PRIME_SUBSTEPS_PER_CHUNK && drops < PRIME_DROPS; i++) {
        if (gs.simTime >= nextDropAt) {
          const x = clamp(W / 2 + (Math.random() - 0.5) * 220, WALL_L + R + 1, WALL_R - R - 1);
          gs.coins.push({
            id: gs.nextId++,
            x,
            y: 30,
            vx: 0,
            vy: 120,
            gold: Math.random() < GOLD_ODDS,
            state: 'drop',
            t: 0,
            landY: pusherFront(gs.simTime) + R + 2,
            tipAt: rollTipAt(),
          });
          drops += 1;
          nextDropAt = gs.simTime + PRIME_CADENCE_MS;
        }
        step(gs, { clink: 0, landed: 0, payouts: [], lost: [] });
      }
      if (drops >= PRIME_DROPS) {
        // Any phantom payout/loss along the way is uncredited — as far as
        // the player's concerned, an earlier round already collected or
        // missed it. Only what's still on the tray (or mid-fall) carries over.
        gs.coins = gs.coins.filter((c) => c.state === 'tray' || c.state === 'drop');
        gs.simTime = 0;
        gs.phase = 'play';
        gsRef.current = gs;
        fxRef.current = freshFX();
        setPhase('play');
        return;
      }
      raf = requestAnimationFrame(chunk);
    }
    raf = requestAnimationFrame(chunk);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [phase]);

  if (phase === 'done') {
    const remark =
      score >= 26
        ? 'The house is worried. 🎰'
        : score >= 16
          ? 'Jackpot instincts! 💰'
          : score >= 8
            ? 'Nice cascade! 👍'
            : 'The machine always wins… 🪙';
    return (
      <Screen>
        <TopBar title="Coin Pusher" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🪙</span>
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">paid out from {coinsDropped} coins</p>
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

  const hint =
    phase === 'ready'
      ? 'Time your drops against the pusher — shove the pile over the glowing edge.'
      : phase === 'priming'
        ? 'Setting up the tray…'
        : ending
          ? 'Cashing out — letting the last coin settle…'
          : coinsLeft > 0
            ? 'Tap to drop a coin, or hold to keep feeding the pile — best just as the pusher pulls back.'
            : 'Out of coins — buy more, or cash out to see your payout.';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Coin Pusher" back="/fun" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Coins <span className="text-fairway-100">{coinsLeft}</span>
        </span>
        <span className="text-fairway-300">
          Payout <span className="font-bold text-amber-300">{score}</span>
        </span>
      </div>
      {phase === 'play' && (
        <div className="flex shrink-0 gap-2 px-4 pb-2">
          <Button variant="ghost" className="flex-1" disabled={ending} sound="none" onClick={buyMore}>
            🪙 +{TOPUP_COINS} coins
          </Button>
          <Button variant="ghost" className="flex-1" disabled={ending} onClick={cashOut}>
            Cash out
          </Button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopHold}
          onPointerCancel={stopHold}
          className="col-start-1 row-start-1 block touch-none rounded-2xl border border-fairway-800"
        />
        {phase === 'ready' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <span className="text-5xl">🪙</span>
            <p className="text-sm text-fairway-100">
              Tap the top strip to drop coins behind the pusher — or hold to keep feeding them in — and shove the
              pile over the glowing edge. Gold pays ×5. Start with {STARTING_COINS} — buy more anytime, there's no
              limit. Mind the side gutters.
            </p>
            <Button onClick={start}>Start</Button>
          </div>
        )}
        {phase === 'priming' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-3 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <span className="animate-pulse text-5xl">🪙</span>
            <p className="text-sm text-fairway-100">Setting up the tray…</p>
          </div>
        )}
      </div>

      <p className="flex h-16 shrink-0 items-center justify-center px-4 pb-4 pt-3 text-center text-sm text-fairway-100/80">
        <span className="line-clamp-2">{hint}</span>
      </p>
    </div>
  );
}
