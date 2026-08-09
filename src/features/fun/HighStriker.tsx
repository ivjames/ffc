import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameTicketAward from './GameTicketAward';
import { useFitCanvas } from './useFitCanvas';
import { playStroke, playSoClose, playUndo, playDing, playLand, playFanfare } from '../../lib/sound';
import type { Particle, Floater, Vec as FxVec } from './fx';
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
} from './fx';

// §12 High Striker — the carnival strength-tower mini-game. A power meter
// beside the striker pad sweeps fast; one tap swings the mallet and launches
// the puck up the tower to a height set by the meter at that instant. The puck
// stalls where your power runs out (that's your 0–100 score), then falls back
// and bounces. Hit a perfect 100 to ring the bell. Five swings; your BEST swing
// is the headline. Pure timing skill, canvas-rendered, client-side, offline.

// —— Tower geometry (logical units; the canvas scales to fit) —————————————————
const W = 340;
const H = 560;
const BELL = { x: W / 2, y: 64, r: 24 };
const PUCK_R = 9;
const REST_Y = 456; // puck-center resting height on the pad lever
const BELL_HIT_Y = BELL.y + BELL.r + PUCK_R; // puck center at bell contact
const RISE_MAX = REST_Y - BELL_HIT_Y; // full-power climb in px
const POST_DX = 46; // tower side posts at W/2 ± POST_DX
const PAD = { x: W / 2, y: 472 }; // striker pad the mallet lands on
const METER = { x: 296, y: 336, w: 20, h: 156 }; // power meter beside the pad
const MALLET = { x: 92, y: 500, len: 56 }; // pivot + handle length

// Painted score zones up the tower, bottom → top.
const ZONES: Array<{ min: number; label: string; color: string }> = [
  { min: 0, label: 'Soggy Noodle', color: '#94a3b8' },
  { min: 25, label: 'Warm-Up', color: '#60a5fa' },
  { min: 50, label: 'Solid Hit', color: '#4ade80' },
  { min: 75, label: 'Heavy Hitter', color: '#fbbf24' },
  { min: 90, label: 'RING THE BELL!', color: '#ef4444' },
];

const SWINGS = 5;
const METER_MS = 1050; // full triangle-wave period (0→100→0) — brisk but hittable
// The meter renders ~1 value per frame, so an exact rendered 100 is nearly
// unreachable; a tap in the top sliver of the sweep counts as the perfect 100
// (≈one rendered frame per sweep), like a batting "perfect" window.
const PERFECT_T = 0.97;
const STRIKE_MS = 110; // mallet tap → pad impact (puck launches on impact)
const RETURN_MS = 380; // mallet settling back to rest
const NEXT_DELAY_MS = 750; // hold after the puck settles before the next swing
const GRAV = 0.00145; // px/ms² — full-power apex ≈700ms up
const COUNT_STEP_MS = 800; // per digit of the "3, 2, 1" countdown
const GO_MS = 500; // beat of "GO!" after the digits, before the meter starts
const COUNTDOWN_MS = 3 * COUNT_STEP_MS + GO_MS;

/** Triangle wave 0→1→0 over `period` ms, for the sweeping power meter. */
function triWave(now: number, period: number): number {
  const u = (now % period) / period;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

function zoneFor(score: number): (typeof ZONES)[number] {
  let z = ZONES[0];
  for (const zone of ZONES) if (score >= zone.min) z = zone;
  return z;
}

/** Puck-center y for a 0–100 score (where that power stalls on the tower). */
const scoreToY = (s: number) => REST_Y - (RISE_MAX * s) / 100;

type Phase = 'ready' | 'countdown' | 'aim' | 'flight' | 'done';
type GS = {
  phase: Phase;
  swingNo: number; // 0-based
  best: number;
  last: number | null;
  score: number; // current swing, locked at tap
  power: number; // meter value locked at tap (for the frozen meter display)
  meterBase: number; // sweep clock base
  countStart: number; // timestamp the countdown began
  strikeAt: number; // tap time (drives the mallet swing anim); 0 = at rest
  launchAt: number; // strikeAt + STRIKE_MS — the pad impact that launches
  launched: boolean;
  puckY: number; // px above REST_Y (0 = resting)
  vy: number; // px/ms, positive = climbing
  apexDone: boolean;
  bellHit: boolean;
  bounced: boolean;
  settledAt: number; // 0 until the puck comes to rest after the fall
};

function freshGS(): GS {
  return {
    phase: 'ready',
    swingNo: 0,
    best: 0,
    last: null,
    score: 0,
    power: 0,
    meterBase: 0,
    countStart: 0,
    strikeAt: 0,
    launchAt: 0,
    launched: false,
    puckY: 0,
    vy: 0,
    apexDone: false,
    bellHit: false,
    bounced: false,
    settledAt: 0,
  };
}

/** Reset the per-swing fields for the next swing (meter resumes sweeping). */
function nextSwing(gs: GS, now: number) {
  gs.phase = 'aim';
  gs.meterBase = now;
  gs.score = 0;
  gs.power = 0;
  gs.strikeAt = 0;
  gs.launchAt = 0;
  gs.launched = false;
  gs.puckY = 0;
  gs.vy = 0;
  gs.apexDone = false;
  gs.bellHit = false;
  gs.bounced = false;
  gs.settledAt = 0;
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the timing sim is never touched; they're advanced per
// animation frame with a real dt and only ever paint pixels. Built on the shared
// ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent puck positions → climbing motion streak
  particles: Particle[]; // pad-impact sparks / bell confetti
  floaters: Floater[]; // score + zone-label popups at the stall point
  shake: number; // impact shake magnitude (px), decays to 0
  flash: number; // bell flash 0..1, decays to 0
  flashColor: string;
  bellSwing: number; // bell wobble amplitude 0..1 after a clang, decays to 0
};

function freshFX(): FX {
  return { trail: [], particles: [], floaters: [], shake: 0, flash: 0, flashColor: '#ffffff', bellSwing: 0 };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, dt: number) {
  fx.particles = stepParticles(fx.particles, dt, 0.02, 240); // gravity → confetti falls
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
  fx.bellSwing = decay(fx.bellSwing, dt, 0.0009);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** Carnival night backdrop: dusk gradient, index-derived stars + bulb string,
 *  dark midway ground. No RNG in the draw path — identical every frame. */
function drawBackdrop(ctx: CanvasRenderingContext2D) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#221338');
  bg.addColorStop(0.55, '#150e26');
  bg.addColorStop(1, '#0a0716');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Sparse stars, positions derived from the index so they never twinkle-jitter.
  for (let i = 0; i < 26; i++) {
    const x = (i * 97 + 13) % W;
    const y = (i * 61 + 29) % Math.floor(H * 0.45);
    ctx.beginPath();
    ctx.arc(x, y, 0.9 + (i % 3) * 0.4, 0, TWO_PI);
    ctx.fillStyle = `rgba(255,255,255,${0.1 + (i % 4) * 0.06})`;
    ctx.fill();
  }

  // Carnival bulb string across the top edge, alternating warm colors.
  const bulbColors = ['#fbbf24', '#ef4444', '#4ade80', '#60a5fa'];
  for (let i = 0, x = 10; x < W; i++, x += 24) {
    const c = bulbColors[i % bulbColors.length];
    ctx.beginPath();
    ctx.arc(x, 12 + (i % 2) * 5, 3, 0, TWO_PI);
    ctx.fillStyle = c;
    ctx.save();
    ctx.shadowColor = c;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }

  // Midway ground under the machine.
  const ground = ctx.createLinearGradient(0, 500, 0, H);
  ground.addColorStop(0, '#241a10');
  ground.addColorStop(1, '#120d08');
  ctx.fillStyle = ground;
  ctx.fillRect(0, 500, W, H - 500);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 500, W, 2);

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.74);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

/** The graduated tower: wood side posts with rivets, painted zone bands with
 *  their labels, and the center puck rail. All offsets index-derived. */
function drawTower(ctx: CanvasRenderingContext2D) {
  const top = scoreToY(100) - PUCK_R - 2;
  const bot = PAD.y - 2;

  // Recessed board behind the zones.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(W / 2 - POST_DX + 8, top, (POST_DX - 8) * 2, bot - top);

  // Painted zone bands, bottom → top, each with its label.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    const hi = i + 1 < ZONES.length ? ZONES[i + 1].min : 100;
    const yTop = scoreToY(hi);
    const yBot = scoreToY(z.min);
    ctx.fillStyle = withAlpha(z.color, 0.14);
    ctx.fillRect(W / 2 - POST_DX + 8, yTop, (POST_DX - 8) * 2, yBot - yTop);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(W / 2 - POST_DX + 8, yBot - 1, (POST_DX - 8) * 2, 1.5);
    const big = z.min >= 90;
    ctx.font = `bold ${big ? 9 : 10}px system-ui, sans-serif`;
    ctx.fillStyle = withAlpha(z.color, 0.85);
    ctx.fillText(z.label, W / 2, (yTop + yBot) / 2);
  }
  ctx.restore();

  // Side posts — warm wood with steel rivets every 26px (index-derived).
  for (const side of [-1, 1]) {
    const px = W / 2 + side * POST_DX - 4.5;
    const wood = ctx.createLinearGradient(px, 0, px + 9, 0);
    wood.addColorStop(0, side < 0 ? '#6b4a24' : '#3d2713');
    wood.addColorStop(0.5, '#8b5a2b');
    wood.addColorStop(1, side < 0 ? '#3d2713' : '#6b4a24');
    ctx.fillStyle = wood;
    ctx.fillRect(px, top - 6, 9, bot - top + 6);
    for (let r = 0, ry = top + 8; ry < bot - 4; r++, ry += 26) {
      ctx.beginPath();
      ctx.arc(px + 4.5, ry, 1.6, 0, TWO_PI);
      ctx.fillStyle = r % 2 ? '#cbd5e1' : '#94a3b8';
      ctx.fill();
    }
  }

  // Center rail the puck rides.
  const rail = ctx.createLinearGradient(W / 2 - 2, 0, W / 2 + 2, 0);
  rail.addColorStop(0, '#475569');
  rail.addColorStop(0.5, '#94a3b8');
  rail.addColorStop(1, '#334155');
  ctx.fillStyle = rail;
  ctx.fillRect(W / 2 - 1.5, top, 3, bot - top);
}

/** The bell at the tower crown, wobbling after a clang. */
function drawBell(ctx: CanvasRenderingContext2D, fx: FX, now: number) {
  ctx.save();
  // Wobble pivots around the mount, driven by the decaying bellSwing scalar.
  ctx.translate(BELL.x, BELL.y - BELL.r - 6);
  if (fx.bellSwing > 0.01) ctx.rotate(Math.sin(now * 0.02) * fx.bellSwing * 0.16);
  ctx.translate(0, BELL.r + 6);

  // Mount bracket.
  ctx.fillStyle = '#3f2d1a';
  ctx.fillRect(-8, -BELL.r - 10, 16, 8);
  // Gold dome.
  drawSphere(ctx, 0, 0, BELL.r, '#fef3c7', '#fbbf24', '#92600a', { rim: true });
  // Lip + clapper hint.
  ctx.fillStyle = '#b45309';
  ctx.fillRect(-BELL.r - 2, BELL.r - 5, BELL.r * 2 + 4, 5);
  ctx.beginPath();
  ctx.arc(0, BELL.r + 2, 3, 0, TWO_PI);
  ctx.fillStyle = '#78350f';
  ctx.fill();
  ctx.restore();
}

/** Striker pad + pedestal at the tower base. */
function drawPad(ctx: CanvasRenderingContext2D) {
  drawShadow(ctx, PAD.x, PAD.y + 26, 44, 9, 0.4);
  // Pedestal block.
  const ped = ctx.createLinearGradient(0, PAD.y, 0, PAD.y + 26);
  ped.addColorStop(0, '#4b3320');
  ped.addColorStop(1, '#241910');
  ctx.fillStyle = ped;
  roundRectPath(ctx, PAD.x - 36, PAD.y, 72, 26, 5);
  ctx.fill();
  // Red rubber pad on top.
  const padG = ctx.createLinearGradient(0, PAD.y - 10, 0, PAD.y + 4);
  padG.addColorStop(0, '#f87171');
  padG.addColorStop(1, '#991b1b');
  ctx.beginPath();
  ctx.ellipse(PAD.x, PAD.y - 2, 32, 9, 0, 0, TWO_PI);
  ctx.fillStyle = padG;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** The strongman silhouette + mallet, mid-swing per `angle` (radians). */
function drawMallet(ctx: CanvasRenderingContext2D, angle: number) {
  // Stylized dark strongman behind the pivot: legs, torso, head.
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(MALLET.x - 22, MALLET.y - 14, 7, 22); // back leg
  ctx.fillRect(MALLET.x - 8, MALLET.y - 14, 7, 22); // front leg
  ctx.beginPath();
  ctx.ellipse(MALLET.x - 14, MALLET.y - 28, 13, 17, 0.18, 0, TWO_PI);
  ctx.fill(); // torso
  ctx.beginPath();
  ctx.arc(MALLET.x - 12, MALLET.y - 50, 7, 0, TWO_PI);
  ctx.fillStyle = '#374151';
  ctx.fill(); // head

  // Mallet: wooden handle out from the pivot, banded steel head at the end.
  ctx.save();
  ctx.translate(MALLET.x, MALLET.y);
  ctx.rotate(angle);
  const hg = ctx.createLinearGradient(0, -3, 0, 3);
  hg.addColorStop(0, '#a06a34');
  hg.addColorStop(1, '#4a2f18');
  ctx.fillStyle = hg;
  ctx.fillRect(0, -3, MALLET.len, 6);
  const head = ctx.createLinearGradient(MALLET.len - 9, -16, MALLET.len + 9, 16);
  head.addColorStop(0, '#e2e8f0');
  head.addColorStop(0.5, '#94a3b8');
  head.addColorStop(1, '#475569');
  roundRectPath(ctx, MALLET.len - 9, -16, 18, 32, 5);
  ctx.fillStyle = head;
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(MALLET.len - 9, -6, 18, 2); // head bands
  ctx.fillRect(MALLET.len - 9, 4, 18, 2);
  ctx.restore();
}

/** The power meter beside the pad: frame, zone-colored fill, threshold ticks. */
function drawMeter(ctx: CanvasRenderingContext2D, value: number) {
  const { x, y, w, h } = METER;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRectPath(ctx, x, y, w, h, 5);
  ctx.fill();
  // Fill from the bottom, colored by the zone that power would reach.
  const fh = (h - 4) * value;
  if (fh > 0.5) {
    const c = zoneFor(value * 100).color;
    ctx.save();
    roundRectPath(ctx, x + 2, y + 2 + (h - 4 - fh), w - 4, fh, 3);
    ctx.fillStyle = withAlpha(c, 0.9);
    ctx.shadowColor = c;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }
  // Zone-threshold ticks.
  for (const z of ZONES) {
    if (z.min === 0) continue;
    const ty = y + 2 + (h - 4) * (1 - z.min / 100);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(x + 2, ty, w - 4, 1);
  }
  ctx.strokeStyle = 'rgba(148,163,184,0.6)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, x, y, w, h, 5);
  ctx.stroke();
  ctx.save();
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(226,232,240,0.7)';
  ctx.fillText('POWER', x + w / 2, y + h + 12);
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number, meterVal: number) {
  ctx.clearRect(0, 0, W, H);
  drawBackdrop(ctx);

  // —— Dynamic layer (shaken on impacts) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  drawTower(ctx);
  drawBell(ctx, fx, now);
  drawPad(ctx);

  // Mallet swing: quick accelerating strike, then an eased return to rest.
  const REST_ANG = -2.45;
  const HIT_ANG = -0.5;
  let angle = REST_ANG;
  if (gs.strikeAt) {
    const t = now - gs.strikeAt;
    if (t < STRIKE_MS) {
      const p = t / STRIKE_MS;
      angle = REST_ANG + (HIT_ANG - REST_ANG) * p * p; // accelerate into the pad
    } else if (t < STRIKE_MS + RETURN_MS) {
      angle = HIT_ANG + (REST_ANG - HIT_ANG) * ((t - STRIKE_MS) / RETURN_MS);
    }
  }
  drawMallet(ctx, angle);

  // Meter: sweeping while aiming, frozen at the tapped power during the flight.
  const shown = gs.phase === 'aim' ? meterVal : gs.phase === 'flight' ? gs.power : 0;
  drawMeter(ctx, shown);

  // Climbing motion streak under the puck.
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 2 + k * 5, 0, TWO_PI);
    ctx.fillStyle = `rgba(248,113,113,${0.03 + k * 0.15})`;
    ctx.fill();
  }

  // The puck — a lit steel-red slider on the rail.
  const py = REST_Y - gs.puckY;
  drawSphere(ctx, W / 2, py, PUCK_R, '#fecaca', '#ef4444', '#7f1d1d', { rim: true });

  drawParticles(ctx, fx.particles);
  ctx.restore();

  drawFloaters(ctx, fx.floaters);

  // —— Bell flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.26);
    ctx.fillRect(0, 0, W, H);
  }

  // "3, 2, 1, GO!" countdown before the meter starts sweeping.
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

export default function HighStriker() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(null!);
  if (!gsRef.current) gsRef.current = freshGS();
  const fxRef = useRef<FX>(freshFX());
  // Last-rendered meter value (the sweep value actually painted this frame).
  // onTap reads this so the swing uses exactly the power bar the player saw,
  // closing the sub-frame gap between the draw clock and a fresh clock read.
  const meterRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('ready');
  const [swingNo, setSwingNo] = useState(0);
  const [best, setBest] = useState(0);
  const [last, setLast] = useState<number | null>(null);
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
    // may never run to record the pause. Shift every absolute time base by the
    // away span on resume so the countdown, meter sweep, and mallet anim all
    // freeze in place instead of skipping ahead.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const away = performance.now() - hiddenAt;
        hiddenAt = 0;
        const gs = gsRef.current;
        gs.countStart += away;
        gs.meterBase += away;
        if (gs.strikeAt) gs.strikeAt += away;
        if (gs.launchAt) gs.launchAt += away;
        if (gs.settledAt) gs.settledAt += away;
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
        gs.phase = 'aim';
        gs.meterBase = now;
        setPhase('aim');
      }

      // Record the meter's *rendered* value this frame so a tap locks exactly
      // the bar the player saw painted. Same `now` the draw below uses.
      if (gs.phase === 'aim') {
        meterRef.current = triWave(now - gs.meterBase, METER_MS);
      }

      if (gs.phase === 'flight') {
        if (!gs.launched) {
          // The puck waits for the mallet to actually land on the pad.
          if (now >= gs.launchAt) {
            gs.launched = true;
            fx.trail.length = 0;
            spawnBurst(fx.particles, PAD.x, PAD.y - 4, 10, 160, '#fca5a5');
            fx.shake = Math.max(fx.shake, 2 + gs.power * 3);
          }
        } else if (!gs.settledAt) {
          // Closed-form ballistic step (position uses the mid-step velocity) —
          // exact for constant gravity at any frame rate. Plain Euler falls
          // ~v·dt/2 short of the true apex, which at 60fps is more than the
          // perfect swing's headroom above the bell.
          gs.puckY += (gs.vy - 0.5 * GRAV * dt) * dt;
          gs.vy -= GRAV * dt;
          pushTrail(fx.trail, W / 2, REST_Y - gs.puckY, 12);

          // Bell contact — only a perfect 100 gets launch energy to reach it.
          // The score-100 apex fallback keeps the launch code's guarantee even
          // if the sampled positions straddle the bell line mid-frame.
          if (!gs.bellHit && (gs.puckY >= RISE_MAX || (gs.score >= 100 && gs.vy <= 0))) {
            gs.puckY = RISE_MAX;
            gs.vy = Math.min(-0.22, -Math.abs(gs.vy)); // knocked back down
            gs.bellHit = true;
            gs.apexDone = true;
            gs.last = 100;
            gs.best = Math.max(gs.best, 100);
            setLast(100);
            setBest(gs.best);
            fx.flash = 1;
            fx.flashColor = '#ffffff';
            fx.shake = 10;
            fx.bellSwing = 1;
            spawnBurst(fx.particles, BELL.x, BELL.y, 26, 340, '#fde68a');
            spawnBurst(fx.particles, BELL.x, BELL.y, 16, 260, '#f87171');
            spawnBurst(fx.particles, BELL.x, BELL.y, 16, 300, '#93c5fd');
            spawnFloater(fx.floaters, BELL.x, BELL.y - 34, 'DING!!!', '#fde68a', { size: 30, life: 1100 });
            spawnFloater(fx.floaters, W / 2, scoreToY(100) + 26, '100', '#fde68a', { size: 26, life: 1000 });
            playFanfare();
          }

          // Apex — the puck stalls here; that's the score moment for non-bells.
          if (!gs.apexDone && gs.vy <= 0) {
            gs.apexDone = true;
            gs.last = gs.score;
            gs.best = Math.max(gs.best, gs.score);
            setLast(gs.score);
            setBest(gs.best);
            const z = zoneFor(gs.score);
            const ay = REST_Y - gs.puckY;
            spawnFloater(fx.floaters, W / 2, ay - 10, String(gs.score), z.color, { size: 26, life: 1000 });
            if (gs.score >= 90) {
              spawnFloater(fx.floaters, W / 2, ay + 16, 'SO CLOSE!', '#fbbf24', { size: 16, life: 1000 });
              fx.shake = Math.max(fx.shake, 4);
              playSoClose();
            } else if (gs.score >= 50) {
              spawnFloater(fx.floaters, W / 2, ay + 16, z.label, z.color, { size: 14, life: 900 });
              playDing();
            } else {
              // The tower itself mocks a weak swing.
              spawnFloater(fx.floaters, W / 2, ay + 16, `"${z.label}"`, '#94a3b8', { size: 14, life: 900 });
              playUndo();
            }
          }

          // Back at the pad: one damped bounce, then settle.
          if (gs.apexDone && gs.puckY <= 0 && gs.vy < 0) {
            gs.puckY = 0;
            if (!gs.bounced) {
              gs.bounced = true;
              playLand();
              spawnBurst(fx.particles, PAD.x, PAD.y - 6, 6, 90, '#94a3b8');
              gs.vy = Math.abs(gs.vy) * 0.28;
              if (gs.vy < 0.06) {
                gs.vy = 0;
                gs.settledAt = now;
              }
            } else {
              gs.vy = 0;
              gs.settledAt = now;
            }
          }
        } else if (now - gs.settledAt >= NEXT_DELAY_MS) {
          if (gs.swingNo + 1 >= SWINGS) {
            gs.phase = 'done';
            setPhase('done');
            playFanfare();
          } else {
            gs.swingNo += 1;
            nextSwing(gs, now);
            setSwingNo(gs.swingNo);
            setPhase('aim');
          }
        }
      }

      updateFX(fx, dt);
      draw(ctx, gs, fx, now, meterRef.current);
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
    if (gs.phase !== 'aim') return;
    const now = performance.now();
    // Lock the last *rendered* meter value, not a re-read of the clock, so the
    // hit uses exactly the power bar the player saw. The top sliver of the
    // sweep counts as the perfect 100 (see PERFECT_T).
    const p = meterRef.current;
    gs.power = p;
    gs.score = p >= PERFECT_T ? 100 : Math.min(99, Math.round(p * 100));
    // Launch speed for the height that power stalls at: v = √(2g·h). A perfect
    // swing gets a hair extra so the puck is guaranteed to reach the bell.
    const hTarget = gs.score >= 100 ? RISE_MAX + 6 : Math.max(10, (RISE_MAX * gs.score) / 100);
    gs.vy = Math.sqrt(2 * GRAV * hTarget);
    gs.phase = 'flight';
    gs.strikeAt = now;
    gs.launchAt = now + STRIKE_MS;
    gs.launched = false;
    setPhase('flight');
    playStroke();
  }, []);

  const start = useCallback(() => {
    const gs = freshGS();
    gs.phase = 'countdown';
    gs.countStart = performance.now();
    gsRef.current = gs;
    fxRef.current = freshFX();
    meterRef.current = 0;
    setPhase('countdown');
    setSwingNo(0);
    setBest(0);
    setLast(null);
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    const remark =
      best >= 100
        ? 'You rang the bell! 🔔'
        : best >= 90
          ? 'So close it hurts! 😤'
          : best >= 70
            ? 'Heavy hitter! 💪'
            : best >= 40
              ? 'Warming up! 👍'
              : 'Soggy noodle arms! 🍜';
    return (
      <Screen>
        <TopBar title="High Striker" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🔨</span>
            <div className="text-5xl font-black text-fairway-50">{best}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">best of {SWINGS} swings</p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (half the best swing's 0–100 power, +10 for ringing the bell). */}
          <GameTicketAward
            game="highstriker"
            tickets={Math.round(best / 2) + (best >= 100 ? 10 : 0)}
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
      ? 'One-tap timing: swing the mallet when the power meter peaks.'
      : phase === 'countdown'
        ? 'Get ready…'
        : phase === 'aim'
          ? 'Tap to swing when the meter peaks!'
          : 'WHACK!';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="High Striker" back="/fun" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Swing <span className="text-fairway-100">{Math.min(swingNo + 1, SWINGS)}</span>
          <span className="font-normal text-fairway-400"> / {SWINGS}</span>
        </span>
        <span className="text-fairway-300">
          Best <span className="font-bold text-fairway-100">{best}</span>
          <span className="text-fairway-400"> · Last </span>
          <span className="font-bold text-fairway-100">{last ?? '—'}</span>
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
            <span className="text-5xl">🔨</span>
            <p className="text-sm text-fairway-100">
              Tap to swing the mallet — the higher the power meter, the higher the puck flies. {SWINGS} swings to
              ring the bell!
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
