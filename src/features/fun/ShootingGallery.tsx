import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameTicketAward from './GameTicketAward';
import { useFitCanvas } from './useFitCanvas';
import { drawLogo } from './logo';
import {
  playStroke,
  playPinClack,
  playCup,
  playTick,
  playDing,
  playFanfare,
} from '../../lib/sound';
import type { Particle, Floater } from './fx';
import {
  TWO_PI,
  withAlpha,
  roundRectPath,
  spawnBurst,
  stepParticles,
  drawParticles,
  spawnFloater,
  stepFloaters,
  drawFloaters,
  decay,
  shakeOffset,
} from './fx';

// §12 Shooting Gallery — the carnival booth classic. Tin ducks glide across
// three shelves (rows alternate direction); tap anywhere to fire at that point.
// Small fast ducks up top pay the most, a rare gold duck streaks across a wire
// for 25, and a six-shell magazine with an auto-reload makes spray-and-pray
// costly. 45 seconds, speeds ramp with the clock. Canvas-rendered, client-side,
// offline.

// —— Booth geometry (logical units; the canvas scales to fit) —————————————————
const W = 340;
const H = 560;

// Shelves top→bottom: small/fast/high-value up top, big/slow/cheap at the
// bottom. `dir` alternates so neighboring rows cross each other.
const SHELVES: Array<{
  y: number;
  dir: 1 | -1;
  count: number;
  s: number; // duck scale
  speed: number; // px/s before the round ramp
  pts: number;
  body: string;
  shade: string;
  wing: string;
}> = [
  { y: 205, dir: 1, count: 4, s: 0.6, speed: 112, pts: 15, body: '#7dd3fc', shade: '#0c4a6e', wing: '#38bdf8' },
  { y: 315, dir: -1, count: 3, s: 0.8, speed: 72, pts: 10, body: '#fdba74', shade: '#7c2d12', wing: '#fb923c' },
  { y: 425, dir: 1, count: 3, s: 1.02, speed: 46, pts: 5, body: '#fde047', shade: '#854d0e', wing: '#facc15' },
];

// The gold duck crosses on a high wire above the shelves.
const GOLD_Y = 132;
const GOLD_S = 0.55;
const GOLD_SPEED = 205;
const GOLD_PTS = 25;

const OFF = 70; // how far offscreen ducks travel before wrapping
const GAME_MS = 45_000;
const COUNT_STEP_MS = 800; // per digit of the "3, 2, 1" countdown
const GO_MS = 500; // beat of "GO!" after the digits, before play starts
const COUNTDOWN_MS = 3 * COUNT_STEP_MS + GO_MS;
const FLIP_MS = 200; // hinge-down (and pop-back-up) animation time
const RESPAWN_MS = 2600; // how long a hit duck stays down
const MAG = 6;
const RELOAD_MS = 800;
const MUZZLE_MS = 130;
const CROSS_MS = 260;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Duck speed multiplier — ramps up across the round. */
const speedMul = (elapsed: number) => lerp(1, 1.55, Math.min(1, Math.max(0, elapsed / GAME_MS)));

type DuckState = 'up' | 'flipping' | 'down' | 'rising';
type Duck = { shelf: number; x: number; state: DuckState; stateAt: number };
type Gold = { x: number; dir: 1 | -1; state: DuckState; stateAt: number };

/** How far a duck is hinged down, 0 (standing) .. 1 (flat). */
function flipAmount(state: DuckState, stateAt: number, now: number): number {
  const t = now - stateAt;
  if (state === 'up') return 0;
  if (state === 'flipping') return Math.min(1, t / FLIP_MS);
  if (state === 'down') return 1;
  return 1 - Math.min(1, t / FLIP_MS); // rising
}

type Phase = 'ready' | 'countdown' | 'playing' | 'done';
type GS = {
  phase: Phase;
  countStart: number; // timestamp the countdown began
  startAt: number; // timestamp play began
  score: number;
  hits: number;
  shots: number;
  shells: number;
  reloadStart: number; // 0 when not reloading
  ducks: Duck[];
  gold: Gold | null;
  nextGoldAt: number;
  lastTickSec: number; // last whole second we played the countdown tick for
};

function freshGS(): GS {
  const ducks: Duck[] = [];
  SHELVES.forEach((sh, si) => {
    // Evenly spaced across the wrap span so a full parade is visible at start.
    const span = W + OFF * 2;
    for (let i = 0; i < sh.count; i++) {
      ducks.push({ shelf: si, x: -OFF + (span / sh.count) * i + 30, state: 'up', stateAt: 0 });
    }
  });
  return {
    phase: 'ready',
    countStart: 0,
    startAt: 0,
    score: 0,
    hits: 0,
    shots: 0,
    shells: MAG,
    reloadStart: 0,
    ducks,
    gold: null,
    nextGoldAt: 0,
    lastTickSec: -1,
  };
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// Advanced per animation frame with a real dt; they only ever paint pixels.
// Built on the shared ./fx toolkit so every Fun Zone game shares one visual
// language.
type FX = {
  particles: Particle[]; // tin-shard / sparkle bursts on hits
  floaters: Floater[]; // rising "+5" … "+25" score popups
  cross: { x: number; y: number; t0: number } | null; // brief crosshair at the shot point
  muzzle: number; // timestamp of the last shot (bottom muzzle-flash vignette)
  shake: number; // recoil/impact shake magnitude (px), decays to 0
  flash: number; // gold-hit flash 0..1, decays to 0
  flashColor: string;
};

function freshFX(): FX {
  return { particles: [], floaters: [], cross: null, muzzle: 0, shake: 0, flash: 0, flashColor: '#fbbf24' };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, dt: number) {
  fx.particles = stepParticles(fx.particles, dt, 0.02, 240); // gravity so shards fall
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** A flat painted tin duck cutout on its stick, base pivot at (x, baseY).
 *  All texture is index/param-derived — no RNG in the draw path. */
function drawDuck(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  s: number,
  dir: 1 | -1,
  body: string,
  shade: string,
  wing: string,
  flip: number,
  gold: boolean,
  now: number,
) {
  ctx.save();
  ctx.translate(x, baseY);
  // Hinge the cutout down around its base when hit; dim as it falls.
  if (flip > 0) {
    ctx.rotate(flip * 1.9 * dir);
    ctx.globalAlpha = 1 - flip * 0.5;
  }
  ctx.scale(dir * s, s); // face the direction of travel

  // Stick (mostly hidden behind the shelf's front board).
  ctx.fillStyle = '#3b2a15';
  ctx.fillRect(-2, -16, 4, 18);

  if (gold) {
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 10;
  }

  // Body — a flat painted ellipse with a tail kick.
  ctx.beginPath();
  ctx.ellipse(0, -30, 24, 16, 0, 0, TWO_PI);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-18, -36);
  ctx.lineTo(-28, -48);
  ctx.lineTo(-12, -42);
  ctx.closePath();
  ctx.fill();
  // Head + beak.
  ctx.beginPath();
  ctx.arc(13, -47, 10.5, 0, TWO_PI);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(22, -50);
  ctx.lineTo(31, -46.5);
  ctx.lineTo(22, -43);
  ctx.closePath();
  ctx.fillStyle = '#f97316';
  ctx.fill();

  // Painted wing + a carnival target ring on the flank.
  ctx.beginPath();
  ctx.ellipse(-4, -29, 12, 7.5, -0.2, 0, TWO_PI);
  ctx.fillStyle = wing;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-4, -29, 5, 0, TWO_PI);
  ctx.strokeStyle = withAlpha(shade, 0.7);
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Eye.
  ctx.beginPath();
  ctx.arc(15.5, -49, 1.8, 0, TWO_PI);
  ctx.fillStyle = '#1c1007';
  ctx.fill();

  // Flat-paint shading: a dark under-edge + one subtle sheen streak, so the
  // cutout reads as glossy painted tin, not a lit 3D object.
  ctx.beginPath();
  ctx.ellipse(0, -30, 24, 16, 0, Math.PI * 0.15, Math.PI * 0.85);
  ctx.strokeStyle = withAlpha(shade, 0.55);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-3, -37, 13, 4.5, -0.35, 0, TWO_PI);
  ctx.fillStyle = 'rgba(255,255,255,0.20)';
  ctx.fill();

  // Gold duck sparkle — time-derived positions (deterministic, no RNG).
  if (gold) {
    const a = now * 0.004;
    ctx.fillStyle = '#fef9c3';
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✦', Math.cos(a) * 16, -40 + Math.sin(a * 1.3) * 10);
    ctx.fillText('✦', Math.cos(a + 2.6) * 20, -32 + Math.sin(a * 1.7 + 1) * 8);
  }
  ctx.restore();
}

/** One shelf: a lit top strip the ducks ride, then a wood front board that the
 *  caller draws AFTER the ducks so the stick bases disappear behind it. */
function drawShelfBoard(ctx: CanvasRenderingContext2D, y: number) {
  const g = ctx.createLinearGradient(0, y, 0, y + 16);
  g.addColorStop(0, '#8a5524');
  g.addColorStop(0.25, '#6b3f1b');
  g.addColorStop(1, '#3a220e');
  ctx.fillStyle = g;
  ctx.fillRect(0, y, W, 16);
  ctx.fillStyle = 'rgba(255,220,160,0.35)';
  ctx.fillRect(0, y, W, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, y + 16, W, 2);
  // Nail heads — index-derived spacing.
  ctx.fillStyle = 'rgba(20,12,4,0.6)';
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.arc(22 + i * 42, y + 10, 1.5, 0, TWO_PI);
    ctx.fill();
  }
}

// Fixed painted-star decorations on the backboard (deterministic).
const STARS: Array<[number, number, number]> = [
  [42, 165, 5], [140, 148, 4], [244, 170, 5], [310, 150, 4],
  [66, 262, 4], [188, 250, 5], [296, 272, 4],
  [36, 372, 5], [156, 360, 4], [268, 382, 5],
];

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(ang) * rr;
    const py = y + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** The carnival booth: night backdrop, striped awning, starry backboard,
 *  high wire, and the front counter. */
function drawBooth(ctx: CanvasRenderingContext2D) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2a1230');
  bg.addColorStop(0.5, '#1c0d22');
  bg.addColorStop(1, '#120716');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Painted stars behind the shelves.
  ctx.fillStyle = 'rgba(250,204,21,0.16)';
  for (const [sx, sy, sr] of STARS) drawStar(ctx, sx, sy, sr);

  // Gold-duck high wire.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, GOLD_Y);
  ctx.quadraticCurveTo(W / 2, GOLD_Y + 5, W, GOLD_Y);
  ctx.stroke();

  // Striped awning with a scalloped edge.
  for (let i = 0, x = 0; x < W; i++, x += 34) {
    ctx.fillStyle = i % 2 === 0 ? '#b91c1c' : '#f4ead8';
    ctx.fillRect(x, 0, 34, 46);
    ctx.beginPath();
    ctx.arc(x + 17, 46, 17, 0, Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, W, 46);
  for (let x = 0; x < W; x += 34) {
    ctx.beginPath();
    ctx.arc(x + 17, 46, 17, 0, Math.PI);
    ctx.fill();
  }

  // Front counter the player "shoots over".
  const cg = ctx.createLinearGradient(0, 498, 0, H);
  cg.addColorStop(0, '#7c4a21');
  cg.addColorStop(0.12, '#5d3517');
  cg.addColorStop(1, '#2a1708');
  ctx.fillStyle = cg;
  ctx.fillRect(0, 498, W, H - 498);
  ctx.fillStyle = 'rgba(255,220,160,0.3)';
  ctx.fillRect(0, 498, W, 2);
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);
  drawBooth(ctx);

  // Painted on the backboard, in the band between the clock bar (ends 86) and
  // the gold duck's wire (132). Only ~46px of clearance, so the wordmark rather
  // than the lockup, at the same amber the booth's painted stars use so it
  // reads as part of the scenery.
  drawLogo(ctx, W / 2, 108, { variant: 'wordmark', width: 130, tint: '#facc15', alpha: 0.45 });

  // —— Clock bar across the top of the backboard ——
  if (gs.phase === 'playing' || gs.phase === 'done') {
    const left = gs.phase === 'done' ? 0 : Math.max(0, GAME_MS - (now - gs.startAt));
    const frac = left / GAME_MS;
    const col = frac > 0.5 ? '#4ade80' : frac > 0.2 ? '#fbbf24' : '#f87171';
    roundRectPath(ctx, 16, 78, W - 32, 8, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    if (frac > 0) {
      ctx.save();
      roundRectPath(ctx, 16, 78, (W - 32) * frac, 8, 4);
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }
  }

  // —— Dynamic layer (recoil/impact shake) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Gold duck rides the wire above everything on the shelves.
  if (gs.gold) {
    const g = gs.gold;
    drawDuck(
      ctx,
      g.x,
      GOLD_Y + 6,
      GOLD_S,
      g.dir,
      '#fde047',
      '#a16207',
      '#fbbf24',
      flipAmount(g.state, g.stateAt, now),
      true,
      now,
    );
  }

  // Shelves top→bottom; ducks first, then the front board hides their sticks.
  for (let si = 0; si < SHELVES.length; si++) {
    const sh = SHELVES[si];
    for (const d of gs.ducks) {
      if (d.shelf !== si) continue;
      drawDuck(
        ctx,
        d.x,
        sh.y + 6,
        sh.s,
        sh.dir,
        sh.body,
        sh.shade,
        sh.wing,
        flipAmount(d.state, d.stateAt, now),
        false,
        now,
      );
    }
    drawShelfBoard(ctx, sh.y);
  }

  // Additive shard / sparkle particles + rising score popups.
  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);

  // Crosshair at the last shot point — a ring + cross that snaps then fades.
  if (fx.cross) {
    const t = now - fx.cross.t0;
    if (t < CROSS_MS) {
      const p = t / CROSS_MS;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = '#fef3c7';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 2;
      const r = 10 + p * 6;
      ctx.beginPath();
      ctx.arc(fx.cross.x, fx.cross.y, r, 0, TWO_PI);
      ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        ctx.moveTo(fx.cross.x + dx * (r - 5), fx.cross.y + dy * (r - 5));
        ctx.lineTo(fx.cross.x + dx * (r + 5), fx.cross.y + dy * (r + 5));
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();

  // Muzzle-flash vignette rising from the counter on every shot.
  if (fx.muzzle > 0 && now - fx.muzzle < MUZZLE_MS) {
    const p = 1 - (now - fx.muzzle) / MUZZLE_MS;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const mg = ctx.createRadialGradient(W / 2, H + 30, 10, W / 2, H + 30, 210);
    mg.addColorStop(0, `rgba(255,214,110,${0.55 * p})`);
    mg.addColorStop(1, 'rgba(255,214,110,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(0, H - 210, W, 210);
    ctx.restore();
  }

  // —— Gold-hit flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }

  // "3, 2, 1, GO!" countdown before the round starts.
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

export default function ShootingGallery() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [shells, setShells] = useState(MAG);
  const [reloading, setReloading] = useState(false);
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
    // so the clock, reload, gold schedule, and duck flips freeze rather than skip.
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
        gs.nextGoldAt += away;
        if (gs.reloadStart > 0) gs.reloadStart += away;
        for (const d of gs.ducks) d.stateAt += away;
        if (gs.gold) gs.gold.stateAt += away;
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
      const dts = dt / 1000;

      if (gs.phase === 'countdown' && now - gs.countStart >= COUNTDOWN_MS) {
        gs.phase = 'playing';
        gs.startAt = now;
        gs.nextGoldAt = now + 5000 + Math.random() * 4000;
        setPhase('playing');
      }

      // The parade glides during the countdown too, so the booth feels alive.
      if (gs.phase === 'countdown' || gs.phase === 'playing') {
        const mul = gs.phase === 'playing' ? speedMul(now - gs.startAt) : 1;
        for (const d of gs.ducks) {
          const sh = SHELVES[d.shelf];
          d.x += sh.dir * sh.speed * mul * dts;
          // Respawn offscreen after exiting — a wrapped duck always pops back up.
          if (sh.dir > 0 && d.x > W + OFF) {
            d.x = -OFF - Math.random() * 50;
            d.state = 'up';
          } else if (sh.dir < 0 && d.x < -OFF) {
            d.x = W + OFF + Math.random() * 50;
            d.state = 'up';
          }
          const t = now - d.stateAt;
          if (d.state === 'flipping' && t >= FLIP_MS) {
            d.state = 'down';
            d.stateAt = now;
          } else if (d.state === 'down' && t >= RESPAWN_MS) {
            d.state = 'rising';
            d.stateAt = now;
          } else if (d.state === 'rising' && t >= FLIP_MS) {
            d.state = 'up';
            d.stateAt = now;
          }
        }
      }

      if (gs.phase === 'playing') {
        const elapsed = now - gs.startAt;

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

          // Auto-reload: shells refill one-by-one, each with a tick.
          if (gs.reloadStart > 0) {
            const filled = Math.min(MAG, Math.floor((now - gs.reloadStart) / (RELOAD_MS / MAG)));
            if (filled > gs.shells) {
              gs.shells = filled;
              setShells(filled);
              playTick();
            }
            if (now - gs.reloadStart >= RELOAD_MS) {
              gs.shells = MAG;
              gs.reloadStart = 0;
              setShells(MAG);
              setReloading(false);
              playDing();
            }
          }

          // Gold duck: one at a time, spawned on a randomized schedule.
          if (!gs.gold && now >= gs.nextGoldAt) {
            const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
            gs.gold = { x: dir > 0 ? -OFF : W + OFF, dir, state: 'up', stateAt: now };
          }
          if (gs.gold) {
            const g = gs.gold;
            g.x += g.dir * GOLD_SPEED * speedMul(elapsed) * dts;
            if (g.state === 'flipping' && now - g.stateAt >= FLIP_MS) {
              g.state = 'down';
              g.stateAt = now;
            }
            const gone = g.dir > 0 ? g.x > W + OFF : g.x < -OFF;
            if (gone || (g.state === 'down' && now - g.stateAt > 450)) {
              gs.gold = null;
              gs.nextGoldAt = now + 6000 + Math.random() * 6000;
            }
          }
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

  const onTap = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const gs = gsRef.current;
    const fx = fxRef.current;
    if (gs.phase !== 'playing') return;
    const now = performance.now();
    if (gs.reloadStart > 0) return; // can't fire mid-reload

    if (gs.shells === 0) return; // empty only while a reload is pending

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;

    gs.shells -= 1;
    gs.shots += 1;
    setShells(gs.shells);
    if (gs.shells === 0) {
      // The sixth shot empties the magazine — start the auto-reload right away
      // instead of charging the player a dry tap to kick it off.
      gs.reloadStart = now;
      setReloading(true);
    }
    fx.cross = { x, y, t0: now };
    fx.muzzle = now;
    fx.shake = Math.max(fx.shake, 1.5);
    playStroke();

    // Hit test: gold first (it pays the most), then shelves top→bottom;
    // within a row, the duck whose cutout center is nearest the shot.
    if (gs.gold && gs.gold.state === 'up') {
      const g = gs.gold;
      const cy = GOLD_Y + 6 - 36 * GOLD_S;
      if (Math.abs(x - g.x) <= 32 * GOLD_S + 8 && Math.abs(y - cy) <= 26 * GOLD_S + 10) {
        g.state = 'flipping';
        g.stateAt = now;
        gs.score += GOLD_PTS;
        gs.hits += 1;
        setScore(gs.score);
        setHits(gs.hits);
        spawnBurst(fx.particles, g.x, cy, 24, 300, '#fde68a');
        spawnFloater(fx.floaters, g.x, cy - 24, `+${GOLD_PTS}`, '#fde68a', { size: 24 });
        fx.flash = 0.8;
        fx.flashColor = '#fbbf24';
        fx.shake = 5;
        playCup();
        return;
      }
    }

    let best: Duck | null = null;
    let bestD = Infinity;
    for (const d of gs.ducks) {
      if (d.state !== 'up') continue;
      const sh = SHELVES[d.shelf];
      const cy = sh.y + 6 - 36 * sh.s;
      if (Math.abs(x - d.x) > 32 * sh.s + 6 || Math.abs(y - cy) > 26 * sh.s + 8) continue;
      const dist = Math.hypot(x - d.x, y - cy);
      if (dist < bestD) {
        best = d;
        bestD = dist;
      }
    }

    if (!best) return; // whiff — the shot fx already played
    const sh = SHELVES[best.shelf];
    const cy = sh.y + 6 - 36 * sh.s;
    best.state = 'flipping';
    best.stateAt = now;
    gs.score += sh.pts;
    gs.hits += 1;
    setScore(gs.score);
    setHits(gs.hits);
    spawnBurst(fx.particles, best.x, cy, sh.pts >= 15 ? 16 : 10, 200, sh.body);
    spawnFloater(fx.floaters, best.x, cy - 24, `+${sh.pts}`, sh.body);
    fx.shake = 3;
    playPinClack(1);
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
    setShells(MAG);
    setReloading(false);
    setTimeLeft(GAME_MS / 1000);
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    const remark =
      score >= 200
        ? 'Deadeye! 🎯'
        : score >= 120
          ? 'Sharpshooter! 🦆'
          : score >= 50
            ? 'Nice shooting! 👍'
            : 'Keep plinking! 🎮';
    return (
      <Screen>
        <TopBar title="Shooting Gallery" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🦆</span>
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">
              {hits} duck{hits === 1 ? '' : 's'} in {GAME_MS / 1000} seconds
            </p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (1 ticket per 4 points, capped at 100). */}
          <GameTicketAward
            game="shootinggallery"
            tickets={Math.min(100, Math.round(score / 4))}
            sessionId={sessionId}
          />
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
      ? 'Tap to shoot the tin ducks — small and fast pays more.'
      : phase === 'countdown'
        ? 'Get ready…'
        : reloading
          ? 'Reloading…'
          : shells === 0
            ? 'Magazine empty — tap to reload.'
            : 'Top shelf 15 · middle 10 · bottom 5 — gold pays 25!';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Shooting Gallery" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Score <span className="text-fairway-100">{score}</span>
        </span>
        <span className="flex items-center gap-1" aria-label={`${shells} of ${MAG} shells`}>
          {Array.from({ length: MAG }, (_, i) => (
            <span
              key={i}
              className={`inline-block h-3.5 w-1.5 rounded-full ${i < shells ? 'bg-warning' : 'bg-fairway-800'}`}
            />
          ))}
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
          className="col-start-1 row-start-1 block touch-none rounded-2xl border border-fairway-800"
        />
        {phase === 'ready' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <span className="text-5xl">🦆</span>
            <p className="text-sm text-fairway-100">
              Tin ducks glide across three shelves — tap to shoot. Six shells per magazine, then a
              quick reload. {GAME_MS / 1000} seconds on the clock!
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
