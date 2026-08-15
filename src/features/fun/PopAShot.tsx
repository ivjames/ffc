import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameTicketAward from './GameTicketAward';
import { useFitCanvas } from './useFitCanvas';
import {
  playStroke,
  playCup,
  playUndo,
  playDing,
  playTick,
  playBump,
  playFanfare,
} from '../../lib/sound';
import type { Particle, Floater, Vec as FxVec } from './fx';
import {
  TWO_PI,
  withAlpha,
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

// §12 Pop-a-Shot — arcade basketball on a 45-second shot clock. Flick the racked
// ball up at the hoop: direction + power come from the swipe, the ball arcs away
// (shrinking into the lane's perspective) and can swish, rattle around the rim,
// or bank in off the glass for 2 points. In the final 15 seconds the hoop slides
// side-to-side and every make is worth 3. Endless balls — the next one racks
// moments after each shot leaves. All client-side canvas; works offline.

// —— Court + physics (logical units; the canvas scales to fit) ————————————————
const W = 340;
const H = 560;
const START = { x: W / 2, y: 486 };
const BALL_R = 24;

// The hoop assembly. The rim sits in front of the backboard; the backboard is a
// slight trapezoid (narrower on top) for a light perspective read.
const RIM_Y = 176;
const RIM_RX = 27; // rim ellipse x-radius (y-radius is squashed for perspective)
const RIM_RY = 9;
const BB_TOP = 84;
const BB_BOT = 164;
const BB_HALF = 58; // backboard half-width at its bottom edge
const BB_HALF_TOP = 50;
const NET_LEN = 34;

// Flick → launch. Same parabola parameterization as Skee-Ball: constant vx,
// gravity on vy, with the apex of the arc treated as the "landing" depth at the
// hoop plane — power controls how far up the lane the ball peaks.
const GRAV = 0.5;
const MIN_V = 13;
const MAX_V = 25;
const MAX_DRAG = 300;
const FLIGHT_MS = 620;

// Arrival classification bands (all about the apex point vs the rim center).
const SWISH_TOL = 9; // |dx| for a clean swish
const RIM_TOL = 22; // |dx| for a rim rattle
const DEPTH_TOL = 26; // |apexY - RIM_Y| that still catches the rim

const RATTLE_MS = 520;
const BANK_MS = 260;
const DROP_MS = 280;
const OUT_MS = 650;

const CLOCK_MS = 45_000;
const BONUS_MS = 15_000; // final stretch: hoop slides, makes are ×3
const HOOP_SLIDE_AMP = 62; // keeps the sliding backboard fully on-canvas
const HOOP_SLIDE_T = 380; // ms per radian of the slide sine

const COUNT_STEP_MS = 800; // per digit of the "3, 2, 1" countdown
const GO_MS = 500;
const COUNTDOWN_MS = 3 * COUNT_STEP_MS + GO_MS;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

type Vel = { vx0: number; vy0: number };

/** Map a swipe (drag delta) to a launch velocity, or null if it isn't a valid
 *  upward flick. */
function launchVelocity(dx: number, dy: number): Vel | null {
  const len = Math.hypot(dx, dy);
  if (len < 12) return null; // deadzone tap
  if (dy / len > -0.35) return null; // not aimed up at the hoop
  const power = Math.min(len / MAX_DRAG, 1);
  const speed = MIN_V + power * (MAX_V - MIN_V);
  return { vx0: (dx / len) * speed, vy0: (dy / len) * speed };
}

/** Ball position along its parabola at time t (constant vx, gravity on vy). */
function trajectory(v: Vel, t: number): { x: number; y: number } {
  return { x: START.x + v.vx0 * t, y: START.y + v.vy0 * t + 0.5 * GRAV * t * t };
}

/** Time to the apex — the shot's depth at the hoop plane. */
function apexTime(v: Vel): number {
  return -v.vy0 / GRAV;
}

type Phase = 'ready' | 'countdown' | 'play' | 'done';
type ShotState = 'flight' | 'rattle' | 'bank' | 'drop' | 'out';
type Shot = {
  state: ShotState;
  v: Vel;
  land: { x: number; y: number }; // the arc's apex — where it meets the hoop plane
  start: number; // flight start timestamp
  stateStart: number;
  // Current draw pose (updated by the sim each frame).
  x: number;
  y: number;
  scale: number;
  alpha: number;
  relOff: number; // lateral offset from the hoop center (tracks a sliding hoop)
  willIn: boolean; // rattle/bank resolution, rolled on contact
  bumped2: boolean; // second rim clack fired mid-rattle
  ox: number; // bounce-out origin + velocity
  oy: number;
  outVx: number;
  outVy: number;
  dead: boolean;
};
type Drag = { active: boolean; sx: number; sy: number; dx: number; dy: number };
type GS = {
  phase: Phase;
  score: number;
  clockStart: number;
  countStart: number;
  bonus: boolean;
  bonusStart: number;
  hoopX: number;
  racked: boolean;
  rackAt: number; // when the next ball racks after a shot leaves
  drag: Drag;
  shots: Shot[];
  lastMsg: string;
  secsShown: number; // last value mirrored to React (avoids per-frame setState)
};

function freshGS(): GS {
  return {
    phase: 'ready',
    score: 0,
    clockStart: 0,
    countStart: 0,
    bonus: false,
    bonusStart: 0,
    hoopX: W / 2,
    racked: false,
    rackAt: 0,
    drag: { active: false, sx: 0, sy: 0, dx: 0, dy: 0 },
    shots: [],
    lastMsg: '',
    secsShown: Math.ceil(CLOCK_MS / 1000),
  };
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the flick sim is never touched; they're advanced per
// animation frame with a real dt and only ever paint pixels. Built on the shared
// ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent in-flight ball positions → motion streak
  particles: Particle[]; // sparks on rim clangs and makes
  floaters: Floater[]; // "+2" / "BONUS ×3" popups at the rim
  shake: number; // impact shake magnitude (px), decays to 0
  flash: number; // big-moment flash 0..1, decays to 0
  flashColor: string;
  netRipple: number; // net swish ripple 0..1, decays to 0
};

function freshFX(): FX {
  return { trail: [], particles: [], floaters: [], shake: 0, flash: 0, flashColor: '#fbbf24', netRipple: 0 };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, dt: number) {
  fx.particles = stepParticles(fx.particles, dt, 0.02, 260); // gravity so sparks fall
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
  fx.netRipple = decay(fx.netRipple, dt, 0.002);
}

// —— drawing —————————————————————————————————————————————————————————————————
function drawBasketball(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  drawSphere(ctx, x, y, r, '#fdba74', '#ea580c', '#7c2d12');
  // Seams, clipped to the ball.
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.clip();
  ctx.strokeStyle = 'rgba(64,22,4,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - r * 1.5, y, r * 1.1, -0.62, 0.62);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + r * 1.5, y, r * 1.1, Math.PI - 0.62, Math.PI + 0.62);
  ctx.stroke();
  ctx.restore();
}

/** Arcade booth backdrop: dark wall, warm court floor with converging boards,
 *  overhead sheen on the hoop end. All offsets are index-derived (no RNG in the
 *  draw path), so the scene is identical every frame. */
function drawBooth(ctx: CanvasRenderingContext2D) {
  const FLOOR_Y = 400;
  // Back wall.
  const wall = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  wall.addColorStop(0, '#131022');
  wall.addColorStop(1, '#0b0a14');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, FLOOR_Y);
  // Court floor.
  const floor = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
  floor.addColorStop(0, '#4a2c14');
  floor.addColorStop(0.4, '#6b3f1d');
  floor.addColorStop(1, '#3a2210');
  ctx.fillStyle = floor;
  ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  // Floorboards converging toward the hoop.
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const xb = t * W; // at the bottom edge
    const xt = W / 2 + (xb - W / 2) * 0.45; // pinched at the floor's horizon
    ctx.beginPath();
    ctx.moveTo(xb, H);
    ctx.lineTo(xt, FLOOR_Y);
    ctx.stroke();
  }
  // Cross seams, spacing compressing with distance.
  for (let i = 1; i <= 4; i++) {
    const t = Math.pow(i / 4, 1.7);
    const y = FLOOR_Y + (H - FLOOR_Y) * (1 - t) + 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  // Overhead sheen over the hoop end.
  const sheen = ctx.createRadialGradient(W / 2, RIM_Y, 20, W / 2, RIM_Y, 260);
  sheen.addColorStop(0, 'rgba(251,146,60,0.12)');
  sheen.addColorStop(1, 'rgba(251,146,60,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);
  // Corner vignette for depth.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

/** Backboard + rim glow ring (the rim color telegraphs the bonus round). */
function drawHoop(ctx: CanvasRenderingContext2D, hx: number, bonus: boolean) {
  const rimColor = bonus ? '#fbbf24' : '#f97316';
  // Hanger pole from the booth ceiling.
  const pole = ctx.createLinearGradient(hx - 4, 0, hx + 4, 0);
  pole.addColorStop(0, '#1f2937');
  pole.addColorStop(0.5, '#4b5563');
  pole.addColorStop(1, '#111827');
  ctx.fillStyle = pole;
  ctx.fillRect(hx - 4, 0, 8, BB_TOP - 2);
  // Backboard — a light trapezoid (narrower up top) for perspective.
  ctx.beginPath();
  ctx.moveTo(hx - BB_HALF_TOP, BB_TOP);
  ctx.lineTo(hx + BB_HALF_TOP, BB_TOP);
  ctx.lineTo(hx + BB_HALF, BB_BOT);
  ctx.lineTo(hx - BB_HALF, BB_BOT);
  ctx.closePath();
  const glass = ctx.createLinearGradient(0, BB_TOP, 0, BB_BOT);
  glass.addColorStop(0, 'rgba(226,232,240,0.9)');
  glass.addColorStop(1, 'rgba(148,163,184,0.75)');
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,23,42,0.8)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // Shooter's square above the rim — flips to the bonus color too.
  ctx.strokeStyle = withAlpha(rimColor, 0.9);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(hx - 17, RIM_Y - 36, 34, 26);
  // Rim (drawn with a glow in the bonus round so the switch reads instantly).
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(hx, RIM_Y, RIM_RX, RIM_RY, 0, 0, TWO_PI);
  ctx.strokeStyle = rimColor;
  ctx.lineWidth = 4;
  if (bonus) {
    ctx.shadowColor = rimColor;
    ctx.shadowBlur = 14;
  }
  ctx.stroke();
  ctx.restore();
}

/** Net strands hanging off the rim; `ripple` (0..1) makes the whole net kick
 *  and sway after a swish. Strand offsets derive from strand index + the ripple
 *  value itself, so the draw is deterministic per frame. */
function drawNet(ctx: CanvasRenderingContext2D, hx: number, ripple: number) {
  const botY = RIM_Y + NET_LEN;
  const kick = ripple * 5;
  ctx.save();
  ctx.strokeStyle = 'rgba(241,245,249,0.75)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const topX = hx - RIM_RX + t * RIM_RX * 2;
    const sway = Math.sin(i * 2.1 + ripple * 14) * kick;
    const botX = hx - 14 + t * 28 + sway;
    ctx.beginPath();
    ctx.moveTo(topX, RIM_Y + 2);
    ctx.quadraticCurveTo((topX + botX) / 2 + sway * 0.6, RIM_Y + NET_LEN * 0.55, botX, botY);
    ctx.stroke();
  }
  // Two horizontal net rings, bulging with the ripple.
  for (let k = 1; k <= 2; k++) {
    const q = k / 3;
    const y = RIM_Y + NET_LEN * q + 2;
    const rx = RIM_RX * (1 - 0.45 * q) + ripple * 4 * (1 - q);
    ctx.beginPath();
    ctx.ellipse(hx + Math.sin(k * 3.7 + ripple * 12) * kick * 0.5, y, rx, 4, 0, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);
  drawBooth(ctx);

  // —— Dynamic layer (shaken on impact) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  drawHoop(ctx, gs.hoopX, gs.bonus);

  // Balls dropping through the net go behind the strands so they read as inside.
  for (const shot of gs.shots) {
    if (shot.state !== 'drop') continue;
    ctx.save();
    ctx.globalAlpha = shot.alpha;
    drawBasketball(ctx, shot.x, shot.y, BALL_R * shot.scale);
    ctx.restore();
  }

  drawNet(ctx, gs.hoopX, fx.netRipple);

  // Motion streak under the in-flight ball.
  if (fx.trail.length > 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < fx.trail.length; i++) {
      const t = fx.trail[i];
      const k = i / fx.trail.length;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 3 + k * 8, 0, TWO_PI);
      ctx.fillStyle = `rgba(253,186,116,${0.02 + k * 0.08})`;
      ctx.fill();
    }
    ctx.restore();
  }

  // In-flight / rattling / bouncing-out balls.
  for (const shot of gs.shots) {
    if (shot.state === 'drop') continue;
    ctx.save();
    ctx.globalAlpha = shot.alpha;
    drawBasketball(ctx, shot.x, shot.y, BALL_R * shot.scale);
    ctx.restore();
  }

  // The racked ball + flick aim dots.
  const showRack = gs.racked && (gs.phase === 'play' || gs.phase === 'countdown');
  if (showRack) {
    drawShadow(ctx, START.x, START.y + BALL_R * 0.7, BALL_R * 0.95, BALL_R * 0.4, 0.35);
    drawBasketball(ctx, START.x, START.y, BALL_R);
    if (gs.drag.active) {
      const v = launchVelocity(gs.drag.dx, gs.drag.dy);
      if (v) {
        const len = Math.hypot(gs.drag.dx, gs.drag.dy);
        const power = Math.min(len / MAX_DRAG, 1);
        const ux = gs.drag.dx / len;
        const uy = gs.drag.dy / len;
        ctx.save();
        ctx.fillStyle = '#fde68a';
        ctx.shadowColor = 'rgba(253,230,138,0.8)';
        ctx.shadowBlur = 6;
        for (let i = 1; i <= 6; i++) {
          const d = BALL_R + i * 16 * (0.4 + power);
          ctx.globalAlpha = (1 - i / 7) * 0.7;
          ctx.beginPath();
          ctx.arc(START.x + ux * d, START.y + uy * d, 3, 0, TWO_PI);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
  ctx.restore();

  // —— Big-moment flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }

  // "3, 2, 1, GO!" countdown before the clock starts.
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

export default function PopAShot() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(CLOCK_MS / 1000));
  const [bonus, setBonus] = useState(false);
  const [lastMsg, setLastMsg] = useState('');
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
    // Pause every clock via visibilitychange, not a hidden-rAF branch: mobile
    // browsers can fully suspend requestAnimationFrame while backgrounded, so a
    // hidden frame may never run. Shift all time bases by the away span on
    // resume so the shot clock / countdown / in-flight balls can't skip ahead.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const away = performance.now() - hiddenAt;
        hiddenAt = 0;
        const gs = gsRef.current;
        gs.countStart += away;
        gs.clockStart += away;
        gs.bonusStart += away;
        gs.rackAt += away;
        for (const shot of gs.shots) {
          shot.start += away;
          shot.stateStart += away;
        }
        last = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const report = (msg: string) => {
      gsRef.current.lastMsg = msg;
      setLastMsg(msg);
    };

    // A made basket: award points (×3 in the bonus round), pop the net.
    const makeShot = (shot: Shot, now: number, label: string) => {
      const gs = gsRef.current;
      const fx = fxRef.current;
      const pts = gs.bonus ? 3 : 2;
      gs.score += pts;
      setScore(gs.score);
      shot.state = 'drop';
      shot.stateStart = now;
      shot.relOff = clamp(shot.x - gs.hoopX, -8, 8);
      fx.netRipple = 1;
      spawnFloater(fx.floaters, gs.hoopX, RIM_Y - 26, `+${pts}`, gs.bonus ? '#fbbf24' : '#4ade80', { size: 22 });
      spawnBurst(fx.particles, gs.hoopX, RIM_Y, gs.bonus ? 24 : 16, 230, gs.bonus ? '#fde68a' : '#86efac');
      if (gs.bonus) {
        fx.flash = Math.max(fx.flash, 0.7);
        fx.flashColor = '#fbbf24';
      }
      playCup();
      report(`${label} +${pts}`);
    };

    // A miss that leaves the play: launch the ball on a fading bounce-out arc.
    const missOut = (shot: Shot, now: number, vx: number, vy: number, msg: string) => {
      shot.state = 'out';
      shot.stateStart = now;
      shot.ox = shot.x;
      shot.oy = shot.y;
      shot.outVx = vx;
      shot.outVy = vy;
      report(msg);
    };

    // Classify the shot the moment its arc reaches the hoop plane. Uses the
    // hoop's position NOW — in the bonus round you have to lead the slide.
    const arrive = (shot: Shot, now: number) => {
      const gs = gsRef.current;
      const fx = fxRef.current;
      const dx = shot.land.x - gs.hoopX;
      const dy = shot.land.y;
      if (Math.abs(dy - RIM_Y) <= DEPTH_TOL) {
        if (Math.abs(dx) <= SWISH_TOL) {
          makeShot(shot, now, 'Swish!');
        } else if (Math.abs(dx) <= RIM_TOL) {
          shot.state = 'rattle';
          shot.stateStart = now;
          shot.relOff = dx;
          shot.willIn = Math.random() < (Math.abs(dx) <= SWISH_TOL + 5 ? 0.8 : 0.42);
          playBump(0.9);
          fx.shake = Math.max(fx.shake, 2.5);
          spawnBurst(fx.particles, shot.x, shot.y, 6, 130, '#fdba74');
        } else {
          playUndo();
          missOut(shot, now, clamp(shot.v.vx0 * 6, -130, 130), 20, 'Wide!');
        }
      } else if (dy < RIM_Y - DEPTH_TOL && dy > BB_TOP - 10 && Math.abs(dx) <= BB_HALF) {
        // Off the glass — a bank can still drop.
        shot.state = 'bank';
        shot.stateStart = now;
        shot.relOff = dx;
        shot.willIn = Math.random() < (Math.abs(dx) <= 24 ? 0.72 : 0.25);
        playBump(1);
        fx.shake = Math.max(fx.shake, 3);
        spawnBurst(fx.particles, shot.x, shot.y, 8, 150, '#cbd5e1');
      } else {
        playUndo();
        missOut(
          shot,
          now,
          clamp(shot.v.vx0 * 6, -130, 130),
          20,
          dy > RIM_Y + DEPTH_TOL ? 'Short!' : 'Long!',
        );
      }
    };

    const stepShot = (shot: Shot, now: number) => {
      const gs = gsRef.current;
      if (shot.state === 'flight') {
        const p = Math.min((now - shot.start) / FLIGHT_MS, 1);
        const t = p * apexTime(shot.v);
        const pos = trajectory(shot.v, t);
        shot.x = pos.x;
        shot.y = pos.y;
        shot.scale = 1 - 0.45 * p; // shrink "away" into the lane
        if (p >= 1) arrive(shot, now);
      } else if (shot.state === 'rattle') {
        const q = Math.min((now - shot.stateStart) / RATTLE_MS, 1);
        const damp = 1 - q;
        const sign = shot.relOff >= 0 ? 1 : -1;
        shot.x = gs.hoopX + Math.cos(q * Math.PI * 3) * sign * RIM_RX * 0.7 * damp;
        shot.y = RIM_Y - 6 - Math.abs(Math.sin(q * Math.PI * 3)) * 6 * damp;
        shot.scale = 0.55;
        if (!shot.bumped2 && q >= 0.55) {
          shot.bumped2 = true;
          playBump(0.5);
        }
        if (q >= 1) {
          if (shot.willIn) makeShot(shot, now, 'Rattled in!');
          else {
            playUndo();
            missOut(shot, now, sign * 110, -160, 'Rimmed out!');
          }
        }
      } else if (shot.state === 'bank') {
        const q = Math.min((now - shot.stateStart) / BANK_MS, 1);
        const e = q * q;
        const targetOff = clamp(shot.relOff * 0.3, -12, 12);
        shot.x = gs.hoopX + shot.relOff + (targetOff - shot.relOff) * e;
        shot.y = shot.land.y + (RIM_Y - 6 - shot.land.y) * e;
        shot.scale = 0.55;
        if (q >= 1) {
          if (shot.willIn) makeShot(shot, now, 'Off the glass!');
          else {
            playBump(0.6);
            missOut(shot, now, (shot.relOff >= 0 ? 1 : -1) * -100, -120, 'Clanged off the glass!');
          }
        }
      } else if (shot.state === 'drop') {
        const q = Math.min((now - shot.stateStart) / DROP_MS, 1);
        shot.x = gs.hoopX + shot.relOff * (1 - q);
        shot.y = RIM_Y - 4 + (NET_LEN + 6) * q * q;
        shot.scale = 0.55 - 0.1 * q;
        shot.alpha = 1 - 0.6 * q;
        if (q >= 1) shot.dead = true;
      } else {
        // 'out' — a simple ballistic bounce-away that fades.
        const tq = (now - shot.stateStart) / 1000;
        shot.x = shot.ox + shot.outVx * tq;
        shot.y = shot.oy + shot.outVy * tq + 300 * tq * tq;
        shot.alpha = Math.max(0, 1 - (now - shot.stateStart) / OUT_MS);
        if (now - shot.stateStart >= OUT_MS || shot.y > H + 30) shot.dead = true;
      }
    };

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
        gs.phase = 'play';
        gs.clockStart = now;
        gs.racked = true;
        gs.rackAt = now;
        setPhase('play');
      }

      if (gs.phase === 'play') {
        const remaining = CLOCK_MS - (now - gs.clockStart);

        // Bonus round switch: rim goes gold, hoop starts sliding, makes are ×3.
        if (!gs.bonus && remaining <= BONUS_MS) {
          gs.bonus = true;
          gs.bonusStart = now;
          setBonus(true);
          playDing();
          spawnFloater(fx.floaters, gs.hoopX, RIM_Y - 48, 'BONUS ×3', '#fbbf24', { life: 1100, size: 24 });
          fx.flash = Math.max(fx.flash, 0.8);
          fx.flashColor = '#fbbf24';
          report('BONUS — makes are ×3!');
        }
        gs.hoopX = gs.bonus
          ? W / 2 + Math.sin((now - gs.bonusStart) / HOOP_SLIDE_T) * HOOP_SLIDE_AMP
          : W / 2;

        // Mirror whole seconds to React only when they change; tick the last 5.
        const secs = Math.max(0, Math.ceil(remaining / 1000));
        if (secs !== gs.secsShown) {
          gs.secsShown = secs;
          setSecondsLeft(secs);
          if (secs <= 5 && secs > 0) playTick();
        }

        // The next ball racks shortly after the previous shot leaves.
        if (!gs.racked && now >= gs.rackAt) gs.racked = true;

        for (const shot of gs.shots) stepShot(shot, now);
        gs.shots = gs.shots.filter((s) => !s.dead);

        // Feed the streak from the newest in-flight ball.
        let flying: Shot | null = null;
        for (const shot of gs.shots) if (shot.state === 'flight') flying = shot;
        if (flying) pushTrail(fx.trail, flying.x, flying.y, 12);
        else fx.trail.length = 0;

        if (remaining <= 0) {
          gs.phase = 'done';
          setPhase('done');
          playFanfare();
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
      if (gs.phase !== 'play' || !gs.racked) return;
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
    if (gs.phase !== 'play' || !gs.racked) return;
    const v = launchVelocity(gs.drag.dx, gs.drag.dy);
    if (!v) return; // not a valid flick — ball stays racked
    const now = performance.now();
    gs.racked = false;
    gs.rackAt = now + 500 + Math.random() * 200; // next ball racks ~500-700ms out
    gs.shots.push({
      state: 'flight',
      v,
      land: trajectory(v, apexTime(v)),
      start: now,
      stateStart: now,
      x: START.x,
      y: START.y,
      scale: 1,
      alpha: 1,
      relOff: 0,
      willIn: false,
      bumped2: false,
      ox: 0,
      oy: 0,
      outVx: 0,
      outVy: 0,
      dead: false,
    });
    // Rendering-only launch puff off the fingertips.
    const fx = fxRef.current;
    fx.trail.length = 0;
    spawnBurst(fx.particles, START.x, START.y, 8, 120, '#fdba74');
    playStroke();
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
    setSecondsLeft(Math.ceil(CLOCK_MS / 1000));
    setBonus(false);
    setLastMsg('');
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    const remark =
      score >= 35
        ? 'Downtown legend! 🏆'
        : score >= 20
          ? 'Hot hand! 🔥'
          : score >= 10
            ? 'Solid shooting! 👍'
            : 'Warm-up buckets! 🏀';
    return (
      <Screen>
        <TopBar title="Pop-a-Shot" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🏀</span>
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">in {Math.round(CLOCK_MS / 1000)} seconds</p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (3 tickets per 2 points, capped at 100). */}
          <GameTicketAward
            game="popashot"
            tickets={Math.min(100, Math.round(score * 1.5))}
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
      ? 'Flick the ball up at the hoop — swish for 2, moving hoop pays 3.'
      : phase === 'countdown'
        ? 'Get ready…'
        : lastMsg !== ''
          ? lastMsg
          : bonus
            ? 'BONUS — the hoop is moving, makes are ×3!'
            : 'Flick up to shoot!';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Pop-a-Shot" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className={`font-bold ${bonus ? 'text-warning' : 'text-fairway-50'}`}>
          ⏱ <span className="tabular-nums">{secondsLeft}</span>s
          {bonus && <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs font-black text-warning">×3</span>}
        </span>
        <span className="text-fairway-300">
          Score <span className="font-bold text-fairway-100">{score}</span>
        </span>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="col-start-1 row-start-1 block touch-none rounded-2xl border border-fairway-800"
        />
        {phase === 'ready' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <span className="text-5xl">🏀</span>
            <p className="text-sm text-fairway-100">
              Flick up to shoot — every make is 2 points. In the last 15 seconds the hoop slides and
              makes are worth 3. Beat the {Math.round(CLOCK_MS / 1000)}-second clock!
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
