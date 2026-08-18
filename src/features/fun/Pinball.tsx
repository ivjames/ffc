import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameTicketAward from './GameTicketAward';
import { useFitCanvas } from './useFitCanvas';
import { drawLogo } from './logo';
import {
  playStroke,
  playCup,
  playUndo,
  playDing,
  playBuzz,
  playTick,
  playBump,
  playPinClack,
  playFanfare,
} from '../../lib/sound';
import type { Particle, Vec as FxVec, Floater } from './fx';
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
  pushTrail,
  decay,
  shakeOffset,
} from './fx';

import {
  W,
  H,
  BALL_R,
  PF_L,
  PF_R,
  OUT_R,
  PF_CX,
  BALLS,
  FIXED,
  FLIP_LEN,
  FLIP_R,
  INLANE_X,
  INLANE_Y,
  PLUNGE_X,
  RACK_Y,
  SAVE_S,
  PLUNGE_HEAD_Y,
  PLUNGE_SQUASH,
  ARCH_Y,
  ARCH_PTS,
  DRAIN_Y,
  BUMPERS,
  SLINGS,
  TIP_L,
  TIP_R,
  BANKS,
  BANK_PTS,
  BANK_BONUS,
  LAMPS,
  OUT_BOT_Y,
  OUT_MOUTH_X,
  OUT_TOP_Y,
  OUT_X,
  mirrorX,
  freshGS,
  launchBall,
  step,
} from './pinballTable';
import type { Flipper, GS, Phase, Sling } from './pinballTable';

// §12 Pinball — the flagship Fun Zone mini-game. A real pop-bumper table:
// press-and-hold to charge the spring plunger and launch up the shooter lane,
// then flip with the left/right halves of the screen (multi-touch, both
// flippers at once). Pop bumpers, slingshots and rollover lanes score across
// 3 balls, with a 4-second ball-saver budget per ball. This file is the shell
// — rendering, input and the frame loop; the table geometry and the
// 240 Hz physics sim live in ./pinballTable so they can also run headless
// (scripts/pinball-sim.ts) when the table's balance is being tuned.

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the fixed-timestep sim is never touched; they're
// advanced per animation frame with a real dt and only ever paint pixels.
type FX = {
  trail: FxVec[]; // recent ball positions → motion streak
  particles: Particle[]; // spark bursts on bumpers/slings/launch
  floaters: Floater[]; // rising "+100" score popups
  shake: number; // impact shake magnitude (px), decays to 0
  flash: number; // LANES-bonus flash 0..1, decays to 0
  flashColor: string;
  bumperGlow: number[]; // per-bumper hit glow 0..1
  slingGlow: number[]; // per-sling face flash 0..1
  plungerPop: number; // launch recoil of the plunger head 0..1
};

function freshFX(): FX {
  return {
    trail: [],
    particles: [],
    floaters: [],
    shake: 0,
    flash: 0,
    flashColor: '#fde68a',
    bumperGlow: [0, 0, 0, 0, 0],
    slingGlow: [0, 0],
    plungerPop: 0,
  };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, gs: GS, dt: number) {
  if (gs.live && Math.hypot(gs.ball.vx, gs.ball.vy) > 140) {
    pushTrail(fx.trail, gs.ball.x, gs.ball.y, 12);
  } else if (!gs.live) {
    fx.trail.length = 0;
  }
  fx.particles = stepParticles(fx.particles, dt, 0.02, 500);
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
  fx.plungerPop = decay(fx.plungerPop, dt, 0.006);
  for (let i = 0; i < fx.bumperGlow.length; i++) fx.bumperGlow[i] = decay(fx.bumperGlow[i], dt, 0.004);
  for (let i = 0; i < fx.slingGlow.length; i++) fx.slingGlow[i] = decay(fx.slingGlow[i], dt, 0.005);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** Stroke a wall path twice: a dark body then a glowing neon core. */
function rails(ctx: CanvasRenderingContext2D, trace: (c: CanvasRenderingContext2D) => void) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#2c2452';
  trace(ctx);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#8b7bd8';
  ctx.shadowColor = 'rgba(139,123,216,0.8)';
  ctx.shadowBlur = 7;
  trace(ctx);
  ctx.stroke();
  ctx.restore();
}

function traceOutline(c: CanvasRenderingContext2D) {
  c.beginPath();
  c.moveTo(PF_L, 462);
  c.lineTo(PF_L, ARCH_Y);
  for (const p of ARCH_PTS) c.lineTo(p.x, p.y);
  c.lineTo(OUT_R, H);
}

function traceInnerWalls(c: CanvasRenderingContext2D) {
  c.beginPath();
  c.moveTo(PF_R, 168);
  c.lineTo(PF_R, H);
  // Outlane dividers + inlane guides, straight off the same constants SEGS
  // uses — the dividers lean in at the top, pinching the outlane mouths.
  c.moveTo(OUT_MOUTH_X, OUT_TOP_Y);
  c.lineTo(OUT_X, OUT_BOT_Y);
  c.lineTo(INLANE_X, INLANE_Y);
  c.moveTo(mirrorX(OUT_MOUTH_X), OUT_TOP_Y);
  c.lineTo(mirrorX(OUT_X), OUT_BOT_Y);
  c.lineTo(mirrorX(INLANE_X), INLANE_Y);
  // Rollover lane fins — short guides around the lamps (matching SEGS).
  c.moveTo(94, 136);
  c.lineTo(94, 192);
  c.moveTo(136, 136);
  c.lineTo(136, 192);
  c.moveTo(178, 136);
  c.lineTo(178, 192);
  c.moveTo(220, 136);
  c.lineTo(220, 192);
}

function drawSlingShape(ctx: CanvasRenderingContext2D, s: Sling, glow: number) {
  // Control point that makes the quadratic pass through the bulge point `m`.
  const cpx = 2 * s.m.x - (s.a.x + s.c.x) / 2;
  const cpy = 2 * s.m.y - (s.a.y + s.c.y) / 2;
  ctx.beginPath();
  ctx.moveTo(s.a.x, s.a.y);
  ctx.lineTo(s.b.x, s.b.y);
  ctx.lineTo(s.c.x, s.c.y);
  ctx.quadraticCurveTo(cpx, cpy, s.a.x, s.a.y);
  ctx.closePath();
  const g = ctx.createLinearGradient(s.a.x, s.a.y, s.b.x, s.b.y);
  g.addColorStop(0, '#b91c1c');
  g.addColorStop(1, '#5f1414');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(10,7,25,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // The curved kicking face, lit hotter while it fires.
  ctx.save();
  ctx.strokeStyle = withAlpha('#fbbf24', 0.7 + glow * 0.3);
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur = 6 + glow * 16;
  ctx.lineWidth = 3 + glow * 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s.a.x, s.a.y);
  ctx.quadraticCurveTo(cpx, cpy, s.c.x, s.c.y);
  ctx.stroke();
  ctx.restore();
}

function drawBumper(
  ctx: CanvasRenderingContext2D,
  b: { x: number; y: number; r: number },
  glow: number,
) {
  drawShadow(ctx, b.x, b.y + 4, b.r * 0.95, b.r * 0.4, 0.35);
  if (glow > 0.02) {
    // Expanding hit ring.
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + (1 - glow) * 16, 0, TWO_PI);
    ctx.strokeStyle = withAlpha('#f0abfc', glow * 0.7);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  drawSphere(ctx, b.x, b.y, b.r, '#fbcfe8', '#db2777', '#701a38', { rim: true });
  drawSphere(ctx, b.x, b.y, b.r * 0.6, '#fdf2f8', '#f472b6', '#9d2458', { specular: false });
  ctx.save();
  ctx.font = 'bold 8px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(255,255,255,${0.85 + glow * 0.15})`;
  ctx.fillText('100', b.x, b.y + 3);
  ctx.restore();
}

function drawFlipper(ctx: CanvasRenderingContext2D, f: Flipper) {
  const tx = f.px + Math.cos(f.angle) * FLIP_LEN;
  const ty = f.py + Math.sin(f.angle) * FLIP_LEN;
  drawShadow(ctx, (f.px + tx) / 2, (f.py + ty) / 2 + 5, FLIP_LEN * 0.55, 6, 0.3);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(f.px, f.py);
  ctx.lineTo(tx, ty);
  ctx.lineWidth = FLIP_R * 2 + 2;
  ctx.strokeStyle = '#7c2d12';
  ctx.stroke();
  const g = ctx.createLinearGradient(f.px, f.py, tx, ty);
  g.addColorStop(0, '#fcd34d');
  g.addColorStop(1, '#d97706');
  ctx.beginPath();
  ctx.moveTo(f.px, f.py);
  ctx.lineTo(tx, ty);
  ctx.lineWidth = FLIP_R * 2 - 2;
  ctx.strokeStyle = g;
  ctx.stroke();
  ctx.restore();
  drawSphere(ctx, f.px, f.py, 5.5, '#fef3c7', '#f59e0b', '#92400e', { specular: false });
}

function drawPlunger(ctx: CanvasRenderingContext2D, t: number, pop: number) {
  const headY = PLUNGE_HEAD_Y + t * PLUNGE_SQUASH - pop * 9;
  // Compressed spring coil.
  ctx.save();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PLUNGE_X, headY + 8);
  const coils = 5;
  for (let i = 0; i < coils; i++) {
    const yy = headY + 8 + ((546 - headY - 8) * (i + 0.5)) / coils;
    ctx.lineTo(PLUNGE_X + (i % 2 === 0 ? 6 : -6), yy);
  }
  ctx.lineTo(PLUNGE_X, 546);
  ctx.stroke();
  ctx.restore();
  // Plunger head.
  const g = ctx.createLinearGradient(0, headY, 0, headY + 9);
  g.addColorStop(0, '#fca5a5');
  g.addColorStop(1, '#7f1d1d');
  ctx.fillStyle = g;
  roundRectPath(ctx, PF_R + 4, headY, OUT_R - PF_R - 8, 9, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(10,7,25,0.7)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, PF_R + 4, headY, OUT_R - PF_R - 8, 9, 3);
  ctx.stroke();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);

  // —— Playfield: dark glossy deck with a soft overhead sheen ——
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#181239');
  bg.addColorStop(0.5, '#0f0a24');
  bg.addColorStop(1, '#080513');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const sheen = ctx.createRadialGradient(PF_CX, H * 0.3, 20, PF_CX, H * 0.3, H * 0.7);
  sheen.addColorStop(0, 'rgba(147,120,255,0.12)');
  sheen.addColorStop(1, 'rgba(147,120,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  // Cabinet mask outside the walls (sides + above the arch).
  ctx.fillStyle = '#04030c';
  ctx.fillRect(0, 0, PF_L, H);
  ctx.fillRect(OUT_R, 0, W - OUT_R, H);
  ctx.beginPath();
  ctx.moveTo(0, 170);
  ctx.lineTo(PF_L, ARCH_Y);
  for (const p of ARCH_PTS) ctx.lineTo(p.x, p.y);
  ctx.lineTo(W, 170);
  ctx.lineTo(W, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  // Shooter lane strip, slightly recessed.
  const lane = ctx.createLinearGradient(PF_R, 0, OUT_R, 0);
  lane.addColorStop(0, '#0a0718');
  lane.addColorStop(0.5, '#151030');
  lane.addColorStop(1, '#0a0718');
  ctx.fillStyle = lane;
  ctx.fillRect(PF_R, 119, OUT_R - PF_R, H - 119);

  // —— Deterministic decals (index-derived, identical every frame) ——
  for (let i = 0; i < 24; i++) {
    const x = 18 + ((i * 89) % 272);
    const y = 200 + ((i * 137) % 290);
    ctx.fillStyle = withAlpha('#c4b5fd', 0.05 + ((i * 31) % 4) * 0.015);
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.save();
  ctx.strokeStyle = withAlpha('#db2777', 0.14);
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(BUMPERS[0].x, BUMPERS[0].y);
  ctx.lineTo(BUMPERS[1].x, BUMPERS[1].y);
  ctx.lineTo(BUMPERS[2].x, BUMPERS[2].y);
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = withAlpha('#8b5cf6', 0.1);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(157, 260, 78, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();

  // Playfield art: the badge inside the bumper triangle's decal circle, the
  // way real tables print the theme art in the middle of the bumper cluster.
  // Part of the static backdrop, so the bumpers, ball, and flippers all draw
  // over it — it reads as printed on the deck, not floating above play.
  drawLogo(ctx, 157, 262, { variant: 'badge', width: 100, tint: '#a78bfa', alpha: 0.32 });

  // Vignette for depth.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // —— Dynamic layer (shaken on bumper hits) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  rails(ctx, traceOutline);
  rails(ctx, traceInnerWalls);

  // One-way gate wire at the lane top.
  ctx.save();
  ctx.strokeStyle = withAlpha('#fbbf24', 0.55);
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(PF_R, 121);
  ctx.lineTo(PF_R, 166);
  ctx.stroke();
  ctx.restore();

  // Rollover lamps (pulse while lit).
  for (let i = 0; i < LAMPS.length; i++) {
    const L = LAMPS[i];
    if (gs.lamps[i]) {
      const pulse = 0.65 + 0.35 * Math.sin(now / 150 + i);
      ctx.beginPath();
      ctx.arc(L.x, L.y, 11, 0, TWO_PI);
      ctx.fillStyle = withAlpha('#fde68a', 0.25 * pulse);
      ctx.fill();
      ctx.save();
      ctx.shadowColor = '#fde68a';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(L.x, L.y, 6, 0, TWO_PI);
      ctx.fillStyle = '#fde68a';
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(L.x, L.y, 6, 0, TWO_PI);
      ctx.fillStyle = '#2a2350';
      ctx.fill();
      ctx.strokeStyle = withAlpha('#fde68a', 0.35);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  for (let i = 0; i < SLINGS.length; i++) drawSlingShape(ctx, SLINGS[i], fx.slingGlow[i]);
  for (let i = 0; i < BUMPERS.length; i++) drawBumper(ctx, BUMPERS[i], fx.bumperGlow[i]);

  // Drop-target banks: standing targets glow amber; dropped ones leave a dim
  // socket line until the bank resets.
  for (let bi = 0; bi < BANKS.length; bi++) {
    for (let ti = 0; ti < BANKS[bi].length; ti++) {
      const t = BANKS[bi][ti];
      if (gs.banks[bi][ti]) {
        ctx.save();
        ctx.strokeStyle = withAlpha('#eab308', 0.18);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(t.ax, t.ay);
        ctx.lineTo(t.bx, t.by);
        ctx.stroke();
        ctx.restore();
      } else {
        neonLine(ctx, t.ax, t.ay, t.bx, t.by, '#fde047', 4, 10);
      }
    }
  }

  drawPlunger(ctx, gs.live ? 0 : gs.plunger.t, fx.plungerPop);

  // Charge meter up the shooter lane while the plunger is held.
  if (!gs.live && gs.plunger.pointerId !== null) {
    const t = gs.plunger.t;
    const color = t < 0.5 ? '#4ade80' : t < 0.8 ? '#fbbf24' : '#f87171';
    neonLine(ctx, PF_R + 5, 542, PF_R + 5, 542 - t * 360, color, 3, 10);
  }

  // Ball-saver lamp across the drain while the saver is armed.
  if (gs.live && gs.saveLeft > 0) {
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.4 * Math.sin(now / 120);
    neonLine(ctx, TIP_L - 4, 548, TIP_R + 4, 548, '#4ade80', 3, 12);
    ctx.restore();
  }

  drawFlipper(ctx, gs.fL);
  drawFlipper(ctx, gs.fR);

  // Ball motion streak.
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, BALL_R * (0.3 + k * 0.6), 0, TWO_PI);
    ctx.fillStyle = withAlpha('#bfdbfe', 0.03 + k * 0.12);
    ctx.fill();
  }

  // The ball (racked balls sit on the plunger, squashing down as it charges).
  drawShadow(ctx, gs.ball.x, gs.ball.y + 5, BALL_R * 0.95, BALL_R * 0.5, 0.4);
  drawSphere(ctx, gs.ball.x, gs.ball.y, BALL_R, '#ffffff', '#d7dee8', '#77828f', { rim: true });

  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
  ctx.restore();

  // —— LANES-bonus flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }
}

export default function Pinball() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());
  const scoreShownRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [ballNo, setBallNo] = useState(1);
  const [liveUI, setLiveUI] = useState(false); // mirrors gs.live for the hint line
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
    let acc = 0;
    // Pause via visibilitychange, not a hidden-rAF branch: mobile browsers
    // suspend requestAnimationFrame while backgrounded, so a hidden frame may
    // never run to keep `last` fresh. Everything time-based in the sim runs on
    // gs.time (which only advances in substeps), so resetting the accumulator
    // on resume is the whole pause story.
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

      while (acc >= FIXED) {
        if (gs.phase === 'play') step(gs);
        acc -= FIXED;
      }

      if (gs.phase === 'play') {
        const b = gs.ball;
        if (!gs.live) {
          // Racked: the ball rides the plunger head as the spring squashes.
          b.x = PLUNGE_X;
          b.y = RACK_Y + gs.plunger.t * PLUNGE_SQUASH;
          b.vx = 0;
          b.vy = 0;
        } else if (b.x > PF_R && b.y > 520 && Math.hypot(b.vx, b.vy) < 80) {
          // A weak launch fell back down the shooter lane: quietly re-rack.
          gs.live = false;
          gs.plunger.t = 0;
        } else if (b.y > DRAIN_Y) {
          // Drained.
          gs.live = false;
          gs.plunger.t = 0;
          fx.trail.length = 0;
          if (gs.saveLeft > 0) {
            playUndo();
            spawnFloater(fx.floaters, PF_CX, 470, 'BALL SAVED', '#4ade80', { size: 20, life: 1000 });
          } else if (gs.ballNo >= BALLS) {
            gs.phase = 'done';
            setPhase('done');
            playFanfare();
          } else {
            playBuzz();
            gs.ballNo += 1;
            gs.saveLeft = SAVE_S; // fresh saver budget for the new ball
            setBallNo(gs.ballNo);
            spawnFloater(fx.floaters, PF_CX, 470, 'DRAIN', '#94a3b8', { size: 18, life: 800 });
          }
        }

        for (const ev of gs.events) {
          if (ev.kind === 'bumper') {
            playBump(1.1);
            fx.shake = Math.min(6, fx.shake + 3);
            fx.bumperGlow[ev.i] = 1;
            spawnBurst(fx.particles, ev.x, ev.y, 10, 240, '#f0abfc');
            spawnFloater(fx.floaters, ev.x, ev.y - 10, '+100', '#f0abfc', { size: 15 });
          } else if (ev.kind === 'sling') {
            playPinClack(0.8);
            fx.slingGlow[ev.i] = 1;
            spawnBurst(fx.particles, ev.x, ev.y, 6, 170, '#fbbf24');
            spawnFloater(fx.floaters, ev.x, ev.y - 10, '+50', '#fcd34d', { size: 13 });
          } else if (ev.kind === 'lane') {
            playDing();
            spawnBurst(fx.particles, ev.x, ev.y, 8, 150, '#fde68a');
            spawnFloater(fx.floaters, ev.x, ev.y + 22, '+500', '#fde68a', { size: 16, life: 800 });
          } else if (ev.kind === 'nudge') {
            playTick();
            fx.shake = Math.min(4, fx.shake + 2.5);
            spawnFloater(fx.floaters, ev.x, ev.y - 14, 'NUDGE', '#94a3b8', { size: 12, life: 600 });
          } else if (ev.kind === 'target') {
            playPinClack(1.2);
            spawnBurst(fx.particles, ev.x, ev.y, 8, 190, '#fde047');
            spawnFloater(fx.floaters, ev.x, ev.y - 12, `+${BANK_PTS}`, '#fde047', { size: 14 });
          } else if (ev.kind === 'bank') {
            playCup();
            fx.flash = 1;
            fx.flashColor = '#fde047';
            fx.shake = Math.min(6, fx.shake + 4);
            spawnBurst(fx.particles, ev.x, ev.y, 20, 280, '#fde047');
            spawnFloater(fx.floaters, ev.x, ev.y - 18, `BANK! +${BANK_BONUS}`, '#fde047', { size: 18, life: 1000 });
          } else {
            playCup();
            fx.flash = 1;
            fx.flashColor = '#fde68a';
            fx.shake = Math.min(7, fx.shake + 5);
            spawnBurst(fx.particles, PF_CX, 200, 30, 320, '#fde68a');
            spawnFloater(fx.floaters, PF_CX, 230, 'LANES! +2000', '#fde68a', { size: 24, life: 1100 });
          }
        }
        gs.events.length = 0;

        if (gs.score !== scoreShownRef.current) {
          scoreShownRef.current = gs.score;
          setScore(gs.score);
        }
        setLiveUI(gs.live); // no-op re-render unless it actually changed
      }

      updateFX(fx, gs, dt);
      draw(ctx, gs, fx, now);
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

  const launch = useCallback(() => {
    const gs = gsRef.current;
    const t = gs.plunger.t;
    const b = gs.ball;
    launchBall(gs, t);
    fxRef.current.plungerPop = 1;
    playStroke();
    playBump(0.4 + t); // spring thunk scaled with the charge
    spawnBurst(fxRef.current.particles, b.x, b.y, 8, 160, '#a5f3fc');
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (gs.phase !== 'play') return;
      canvasRef.current?.setPointerCapture(e.pointerId);
      // While the ball is racked, the first touch anywhere charges the plunger;
      // additional touches (and all touches while live) work the flippers.
      if (!gs.live && gs.plunger.pointerId === null) {
        gs.plunger.pointerId = e.pointerId;
        gs.plunger.t = 0;
        return;
      }
      const side = toField(e).x < W / 2 ? 'L' : 'R';
      gs.pointers.set(e.pointerId, side);
      const f = side === 'L' ? gs.fL : gs.fR;
      if (!f.pressed) playTick();
      f.pressed = true;
    },
    [toField],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (e.pointerId === gs.plunger.pointerId) {
        gs.plunger.pointerId = null;
        if (gs.phase === 'play' && !gs.live) launch();
        return;
      }
      if (!gs.pointers.has(e.pointerId)) return;
      gs.pointers.delete(e.pointerId);
      let l = false;
      let r = false;
      gs.pointers.forEach((s) => {
        if (s === 'L') l = true;
        else r = true;
      });
      gs.fL.pressed = l;
      gs.fR.pressed = r;
    },
    [launch],
  );

  const start = useCallback(() => {
    const gs = freshGS();
    gs.phase = 'play';
    gsRef.current = gs;
    fxRef.current = freshFX();
    scoreShownRef.current = 0;
    setScore(0);
    setBallNo(1);
    setPhase('play');
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    const remark =
      score >= 10000
        ? 'Pinball Wizard! 🧙'
        : score >= 5000
          ? 'Flipper ace! 🔥'
          : score >= 2000
            ? 'Solid game! 👍'
            : 'Keep flipping! 🎮';
    return (
      <Screen>
        <TopBar title="Pinball" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🕹️</span>
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">across {BALLS} balls</p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (1 ticket per 200 points, capped at 100). */}
          <GameTicketAward game="pinball" tickets={Math.min(100, Math.round(score / 200))} sessionId={sessionId} />
          <div className="mt-8">
            <Button onClick={start} sound="none">
              Play again
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  const racked = phase === 'play' && !liveUI;
  const hint =
    phase === 'ready'
      ? 'Charge the plunger, flip with the screen halves — 3 balls.'
      : racked
        ? 'Hold anywhere to charge the plunger — release to launch!'
        : 'Left / right half = flippers. Light all 3 lanes for a bonus!';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Pinball" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Ball <span className="text-fairway-100">{Math.min(ballNo, BALLS)}</span>
          <span className="font-normal text-fairway-400"> / {BALLS}</span>
        </span>
        <span className="text-fairway-300">
          Score <span className="font-bold text-fairway-100">{score}</span>
        </span>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="col-start-1 row-start-1 block touch-none rounded-2xl border border-fairway-800"
        />
        {phase === 'ready' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <span className="text-5xl">🕹️</span>
            <p className="text-sm text-fairway-100">
              Hold to charge the plunger, release to launch. Tap the left / right halves to flip —
              both at once works. {BALLS} balls: bumpers 100, slings 50, lanes 500.
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
