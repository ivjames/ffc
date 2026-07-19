import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playStroke, playCup, playUndo, playFanfare } from '../../lib/sound';
import type { Particle, Vec as FxVec } from './fx';
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
  pushTrail,
  decay,
  shakeOffset,
} from './fx';

// §12 Bowling — the sixth attraction mini-game. Swipe up the lane to roll (aim
// with the angle, power with the length; an angled shot hooks a little). Real
// ball↔pin↔pin physics knock the rack down, scored with standard 10-frame rules
// (strikes, spares, 10th-frame fill balls). Canvas, client-side, offline.

// —— Lane + physics (logical units; the canvas scales to fit) ————————————————
const W = 340;
const H = 560;
const LANE_L = 40;
const LANE_R = W - 40;
const BALL_R = 12;
const PIN_R = 9;
const HEAD_Y = 150; // head pin (nearest the bowler)
const PIN_GAP_X = 22;
const PIN_GAP_Y = 24;
const START = { x: W / 2, y: H - 40 };

const FIXED = 1000 / 120;
const BALL_FRICTION = 0.996;
const PIN_FRICTION = 0.86;
const REST = 0.5; // collision restitution
const BALL_M = 4;
const PIN_M = 1;
const MIN_V = 4;
const MAX_V = 9;
const MAX_DRAG = 260;
const HOOK = 0.006; // lateral curve per step, in the aim's x direction
const DOWN_DIST = 6; // a pin moved this far from its spot is knocked down
const MAX_ROLL_MS = 2200; // hard stop for a roll's simulation
const SWEEP_MS = 950; // pause showing the fallen pins before the sweep clears them
const REST_SPEED = 0.5; // below this a ball/pin is parked so micro-jitter can't stall settle

type Pin = { x: number; y: number; vx: number; vy: number; ox: number; oy: number; down: boolean };
type Ball = { x: number; y: number; vx: number; vy: number; gutter: boolean; rolling: boolean };
type Vel = { vx0: number; vy0: number; spin: number };

/** The 10-pin rack: 4 rows receding from the head pin. */
function makePins(): Pin[] {
  const pins: Pin[] = [];
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i <= r; i++) {
      const x = W / 2 + (i - r / 2) * PIN_GAP_X;
      const y = HEAD_Y - r * PIN_GAP_Y;
      pins.push({ x, y, vx: 0, vy: 0, ox: x, oy: y, down: false });
    }
  }
  return pins;
}

function launch(dx: number, dy: number): Vel | null {
  const len = Math.hypot(dx, dy);
  if (len < 10) return null;
  if (dy / len > -0.3) return null; // must be aimed up the lane
  const power = Math.min(len / MAX_DRAG, 1);
  const speed = MIN_V + power * (MAX_V - MIN_V);
  return { vx0: (dx / len) * speed, vy0: (dy / len) * speed, spin: Math.max(-1, Math.min(1, dx / MAX_DRAG)) };
}

/** Standard 10-frame scoring over a flat list of pinfalls. Missing future
 *  bonus balls count as 0 so the running total updates as you play. */
function computeScore(rolls: number[]): number {
  let score = 0;
  let i = 0;
  const at = (k: number) => rolls[k] ?? 0;
  for (let frame = 0; frame < 10 && i < rolls.length; frame++) {
    if (at(i) === 10) {
      score += 10 + at(i + 1) + at(i + 2);
      i += 1;
    } else if (at(i) + at(i + 1) === 10) {
      score += 10 + at(i + 2);
      i += 2;
    } else {
      score += at(i) + at(i + 1);
      i += 2;
    }
  }
  return score;
}

type Phase = 'aim' | 'rolling' | 'sweep' | 'done';
type Drag = { active: boolean; sx: number; sy: number; dx: number; dy: number };
type GS = {
  phase: Phase;
  pins: Pin[];
  ball: Ball;
  drag: Drag;
  rolls: number[]; // flat pinfalls across the game
  frame: number; // 0..9
  rollInFrame: number; // balls thrown in the current frame
  standing: number; // pins up at the start of the current ball
  rollStart: number;
  note: string;
  sweepAt: number; // when the current sweep pause began
  afterSweep: 'rack' | 'clear' | 'done'; // what the sweep resolves to
};

function freshBall(): Ball {
  return { x: START.x, y: START.y, vx: 0, vy: 0, gutter: false, rolling: false };
}

function freshGS(): GS {
  return {
    phase: 'aim',
    pins: makePins(),
    ball: freshBall(),
    drag: { active: false, sx: 0, sy: 0, dx: 0, dy: 0 },
    rolls: [],
    frame: 0,
    rollInFrame: 0,
    standing: 10,
    rollStart: 0,
    note: '',
    sweepAt: 0,
    afterSweep: 'rack',
  };
}

const standingCount = (pins: Pin[]) => pins.reduce((n, p) => n + (p.down ? 0 : 1), 0);

/** One physics substep of a live roll. */
function step(gs: GS) {
  const ball = gs.ball;
  if (ball.rolling && !ball.gutter) {
    // Hook: a gentle lateral pull in the aim's x direction while moving.
    ball.vx += Math.sign(ball.vx) * HOOK * Math.min(Math.abs(ball.vx), 3);
  }
  ball.vx *= BALL_FRICTION;
  ball.vy *= BALL_FRICTION;
  ball.x += ball.vx;
  ball.y += ball.vy;
  // Once the ball has almost stopped (e.g. nestled among the pins) park it, so
  // it doesn't keep nudging the pins and stall the settle check.
  if (Math.hypot(ball.vx, ball.vy) < REST_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
  }

  // Gutters: once past the lane edge the ball drops in and can't hit pins.
  if (!ball.gutter) {
    if (ball.x < LANE_L + BALL_R) {
      ball.x = LANE_L + BALL_R - 2;
      ball.vx = 0;
      ball.gutter = true;
    } else if (ball.x > LANE_R - BALL_R) {
      ball.x = LANE_R - BALL_R + 2;
      ball.vx = 0;
      ball.gutter = true;
    }
  }

  // Pins: integrate + friction + keep on the lane.
  for (const p of gs.pins) {
    if (p.vx || p.vy) {
      p.vx *= PIN_FRICTION;
      p.vy *= PIN_FRICTION;
      p.x += p.vx;
      p.y += p.vy;
      p.x = Math.max(LANE_L + PIN_R, Math.min(LANE_R - PIN_R, p.x));
      if (Math.hypot(p.x - p.ox, p.y - p.oy) > DOWN_DIST) p.down = true;
      // Park a nearly-stopped pin so lingering micro-jitter doesn't stall settle.
      if (Math.hypot(p.vx, p.vy) < REST_SPEED) {
        p.vx = 0;
        p.vy = 0;
      }
    }
  }

  // Ball ↔ pin collisions (only pins still standing on the deck).
  if (!ball.gutter) {
    for (const p of gs.pins) {
      collide(ball, p, BALL_M, PIN_M);
    }
  }
  // Pin ↔ pin collisions.
  for (let a = 0; a < gs.pins.length; a++) {
    for (let b = a + 1; b < gs.pins.length; b++) {
      collide(gs.pins[a], gs.pins[b], PIN_M, PIN_M);
    }
  }
}

/** Resolve a circle↔circle collision with mass + restitution. */
function collide(
  a: { x: number; y: number; vx: number; vy: number },
  b: { x: number; y: number; vx: number; vy: number },
  ma: number,
  mb: number,
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const min = ma === BALL_M || mb === BALL_M ? BALL_R + PIN_R : PIN_R * 2;
  if (dist >= min) return;
  const nx = dx / dist;
  const ny = dy / dist;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  // Separate proportionally to inverse mass.
  const overlap = min - dist;
  const invA = 1 / ma;
  const invB = 1 / mb;
  const push = overlap / (invA + invB);
  a.x -= nx * push * invA;
  a.y -= ny * push * invA;
  b.x += nx * push * invB;
  b.y += ny * push * invB;
  if (rel < 0) {
    const j = (-(1 + REST) * rel) / (invA + invB);
    a.vx -= j * invA * nx;
    a.vy -= j * invA * ny;
    b.vx += j * invB * nx;
    b.vy += j * invB * ny;
  }
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the fixed-timestep sim is never touched; they're
// advanced per animation frame with a real dt and only ever paint pixels. Built
// on the shared ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent ball positions → rolling motion streak
  particles: Particle[]; // spark bursts on pin hits / strikes / spares
  shake: number; // camera shake magnitude (px), decays to 0
  flash: number; // strike/spare flash 0..1, decays to 0
  downSeen: Map<Pin, boolean>; // pins already spark-flashed (so each falls once)
  prevPhase: Phase; // for edge-detecting the roll → sweep transition
};

function freshFX(): FX {
  return { trail: [], particles: [], shake: 0, flash: 0, downSeen: new Map(), prevPhase: 'aim' };
}

const PURPLE_LIGHT = '#e9d5ff';
const PURPLE = '#a855f7';
const PURPLE_DEEP = '#6b21a8';

/** Advance the visual-only effects by `dt` ms (framerate-correct). Reads gs but
 *  never mutates it — every event it reacts to (pin down, strike, spare) has
 *  already happened in the sim. */
function updateFX(fx: FX, gs: GS, dt: number) {
  // Rolling ball leaves a fading streak; other phases clear it.
  if (gs.phase === 'rolling') pushTrail(fx.trail, gs.ball.x, gs.ball.y, 14);
  else fx.trail.length = 0;

  // A pin that just went down throws a little purple spark burst, once.
  for (const p of gs.pins) {
    if (p.down && !fx.downSeen.has(p)) {
      fx.downSeen.set(p, true);
      spawnBurst(fx.particles, p.x, p.y, 6, 120, PURPLE_LIGHT);
    }
  }

  // On the roll → sweep edge, celebrate strikes (big) and spares (small).
  if (fx.prevPhase !== 'sweep' && gs.phase === 'sweep') {
    const cx = W / 2;
    const cy = HEAD_Y - PIN_GAP_Y * 1.5;
    if (gs.note.includes('Strike')) {
      fx.shake = 8;
      fx.flash = 1;
      spawnBurst(fx.particles, cx, cy, 34, 320, PURPLE_LIGHT);
      spawnBurst(fx.particles, cx, cy, 18, 180, '#f0abfc');
    } else if (gs.note.includes('Spare')) {
      fx.shake = 4;
      fx.flash = 0.6;
      spawnBurst(fx.particles, cx, cy, 20, 240, PURPLE);
    }
  }
  fx.prevPhase = gs.phase;

  fx.particles = stepParticles(fx.particles, dt, 0.02, 40);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** A standing pin: soft shadow, lit body, glossy highlight, purple neck ring. */
function drawStandingPin(ctx: CanvasRenderingContext2D, x: number, y: number) {
  drawShadow(ctx, x, y + PIN_R * 0.55, PIN_R * 1.05, PIN_R * 0.5, 0.3);
  drawSphere(ctx, x, y, PIN_R, '#ffffff', '#e8edf4', '#9aa6b6');
  // Purple neck stripe reads as the classic pin band + our theme accent.
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, PIN_R - 2.5, 0, TWO_PI);
  ctx.strokeStyle = PURPLE;
  ctx.lineWidth = 2;
  ctx.shadowColor = withAlpha(PURPLE, 0.7);
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.restore();
}

/** A fallen pin: a faded, top-lit ellipse lying along its travel direction. */
function drawFallenPin(ctx: CanvasRenderingContext2D, p: Pin) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(p.y - p.oy, p.x - p.ox) || 0);
  const g = ctx.createLinearGradient(0, -PIN_R, 0, PIN_R);
  g.addColorStop(0, 'rgba(236,240,246,0.55)');
  g.addColorStop(1, 'rgba(150,163,184,0.45)');
  ctx.beginPath();
  ctx.ellipse(0, 0, PIN_R + 3, PIN_R - 3, 0, 0, TWO_PI);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** The glossy, top-lit bowling ball with a contact shadow. */
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number) {
  drawShadow(ctx, x, y + BALL_R * 0.55, BALL_R * 0.95, BALL_R * 0.5, 0.35);
  drawSphere(ctx, x, y, BALL_R, PURPLE_LIGHT, PURPLE, PURPLE_DEEP, { rim: true });
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX) {
  ctx.clearRect(0, 0, W, H);

  // —— Backdrop: a dim, top-lit alley beyond the pins ——
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1a1330');
  bg.addColorStop(0.35, '#121026');
  bg.addColorStop(1, '#0b0a16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Pin-deck sheen glowing down from the top (behind the rack).
  const sheen = ctx.createRadialGradient(W / 2, HEAD_Y - 40, 10, W / 2, HEAD_Y - 40, H * 0.55);
  sheen.addColorStop(0, withAlpha(PURPLE, 0.16));
  sheen.addColorStop(1, withAlpha(PURPLE, 0));
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  // —— Gutters: rounded, recessed channels either side of the lane ——
  const gut = ctx.createLinearGradient(0, 0, 0, H);
  gut.addColorStop(0, '#141021');
  gut.addColorStop(1, '#0a0813');
  ctx.fillStyle = gut;
  roundRectPath(ctx, 4, 6, LANE_L - 8, H - 12, 8);
  ctx.fill();
  roundRectPath(ctx, LANE_R + 4, 6, W - LANE_R - 8, H - 12, 8);
  ctx.fill();

  // —— Lane: polished wood, brighter toward the bowler where light pools ——
  const wood = ctx.createLinearGradient(0, 0, 0, H);
  wood.addColorStop(0, '#4a3a22');
  wood.addColorStop(0.55, '#5a4526');
  wood.addColorStop(1, '#6b5330');
  ctx.fillStyle = wood;
  ctx.fillRect(LANE_L, 0, LANE_R - LANE_L, H);
  // A soft lengthwise gloss down the middle of the boards.
  const gloss = ctx.createLinearGradient(LANE_L, 0, LANE_R, 0);
  gloss.addColorStop(0, 'rgba(0,0,0,0.25)');
  gloss.addColorStop(0.5, 'rgba(255,236,190,0.10)');
  gloss.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = gloss;
  ctx.fillRect(LANE_L, 0, LANE_R - LANE_L, H);
  // Lane boards.
  ctx.strokeStyle = 'rgba(0,0,0,0.20)';
  ctx.lineWidth = 1;
  for (let x = LANE_L + 20; x < LANE_R; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // —— Aiming arrows: the classic lane guide, glowing in the theme color ——
  ctx.save();
  ctx.fillStyle = withAlpha(PURPLE, 0.5);
  ctx.shadowColor = withAlpha(PURPLE, 0.7);
  ctx.shadowBlur = 6;
  for (let i = -2; i <= 2; i++) {
    const ax = W / 2 + i * 26;
    const ay = HEAD_Y + 150 + Math.abs(i) * 14;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - 4, ay + 12);
    ctx.lineTo(ax + 4, ay + 12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // —— Foul line: a glowing neon accent ——
  neonLine(ctx, LANE_L, H - 70, LANE_R, H - 70, PURPLE, 3, 12);

  // —— Vignette for depth ——
  const vig = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.28, W / 2, H * 0.5, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // —— Dynamic layer (shaken on strikes/spares) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Rolling ball motion streak, tapering behind the ball.
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, BALL_R * (0.3 + k * 0.6), 0, TWO_PI);
    ctx.fillStyle = withAlpha(PURPLE, 0.04 + k * 0.14);
    ctx.fill();
  }

  // Pins: fallen ones lie flat (drawn first), standing ones stand lit on top.
  for (const p of gs.pins) if (p.down) drawFallenPin(ctx, p);
  for (const p of gs.pins) if (!p.down) drawStandingPin(ctx, p.x, p.y);

  // Aim guide (glowing).
  if (gs.phase === 'aim' && gs.drag.active) {
    const v = launch(gs.drag.dx, gs.drag.dy);
    if (v) {
      const len = 120;
      const s = Math.hypot(v.vx0, v.vy0);
      ctx.save();
      ctx.strokeStyle = withAlpha('#38bdf8', 0.85);
      ctx.shadowColor = withAlpha('#38bdf8', 0.8);
      ctx.shadowBlur = 10;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(START.x, START.y);
      ctx.lineTo(START.x + (v.vx0 / s) * len, START.y + (v.vy0 / s) * len);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawBall(ctx, gs.ball.x, gs.ball.y);

  drawParticles(ctx, fx.particles);
  ctx.restore();

  // —— Strike/spare flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(PURPLE, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }

  // —— On-canvas STRIKE! / SPARE! banner, softly lit ——
  if (gs.phase === 'sweep' && (gs.note.includes('Strike') || gs.note.includes('Spare'))) {
    const strike = gs.note.includes('Strike');
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillStyle = strike ? '#f5e9ff' : '#ede9fe';
    ctx.shadowColor = withAlpha(PURPLE, 0.95);
    ctx.shadowBlur = 18;
    ctx.fillText(strike ? 'STRIKE!' : 'SPARE!', W / 2, HEAD_Y + 60);
    ctx.restore();
  }
}

export default function Bowling() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('aim');
  const [score, setScore] = useState(0);
  const [frame, setFrame] = useState(0);
  const [note, setNote] = useState('');

  const playing = phase !== 'done';

  /** Advance frame/deck state after a roll settles. */
  // A roll has stopped: score it and decide what happens next, but DEFER the
  // deck change — the fallen pins stay on screen through a sweep pause first.
  const settleRoll = useCallback(() => {
    const gs = gsRef.current;
    const after = standingCount(gs.pins);
    const pinfall = gs.standing - after;
    gs.rolls.push(pinfall);
    setScore(computeScore(gs.rolls));
    if (after === 0) playCup(); // cleared the deck (strike / spare / clean-up)
    else if (pinfall === 0) playUndo(); // whiff or gutter

    // 'rack' = fresh ten after the sweep; 'clear' = sweep the downed pins and
    // leave the standing ones for the next ball; 'done' = game over.
    let afterSweep: 'rack' | 'clear' | 'done' = 'rack';
    let note = '';
    const endFrame = (label: string) => {
      gs.frame += 1;
      gs.rollInFrame = 0;
      setFrame(gs.frame);
      afterSweep = 'rack';
      note = label;
    };

    if (gs.frame < 9) {
      if (gs.rollInFrame === 0) {
        if (pinfall === 10) {
          endFrame('Strike! 🎳');
        } else {
          gs.rollInFrame = 1;
          afterSweep = 'clear';
          note = pinfall === 0 ? 'Gutter — one more ball.' : `${pinfall} down — one more.`;
        }
      } else {
        const first = gs.rolls[gs.rolls.length - 2] ?? 0;
        endFrame(first + pinfall === 10 ? 'Spare! ✅' : 'Nice frame.');
      }
    } else {
      // 10th frame: up to three balls, racking a fresh deck whenever it clears.
      gs.rollInFrame += 1;
      const tenth = gs.rolls.slice(gs.rolls.length - gs.rollInFrame);
      const b1 = tenth[0] ?? 0;
      const b2 = tenth[1] ?? 0;
      if (gs.rollInFrame === 1) {
        afterSweep = pinfall === 10 ? 'rack' : 'clear';
        note = pinfall === 10 ? 'Strike! One more.' : `${pinfall} down — one more.`;
      } else if (gs.rollInFrame === 2) {
        const thirdBall = b1 === 10 || b1 + b2 === 10;
        if (thirdBall) {
          afterSweep = after === 0 ? 'rack' : 'clear';
          note = 'Bonus ball!';
        } else {
          afterSweep = 'done';
          note = '';
        }
      } else {
        afterSweep = 'done';
        note = '';
      }
    }

    gs.afterSweep = afterSweep;
    gs.note = note;
    setNote(note);
    gs.phase = 'sweep';
    gs.sweepAt = performance.now();
  }, []);

  // The sweep pause elapsed: clear the downed pins (or rack a fresh ten) and
  // hand the next ball to the player.
  const applySweep = useCallback(() => {
    const gs = gsRef.current;
    if (gs.afterSweep === 'done') {
      gs.phase = 'done';
      setPhase('done');
      playFanfare();
      return;
    }
    if (gs.afterSweep === 'rack') {
      gs.pins = makePins();
      gs.standing = 10;
    } else {
      gs.pins = gs.pins.filter((p) => !p.down); // sweep the fallen pins away
      gs.standing = gs.pins.length;
    }
    gs.ball = freshBall();
    gs.phase = 'aim';
    setPhase('aim');
  }, []);

  useEffect(() => {
    if (!playing) return;
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
    // never run. Shift the roll/sweep deadlines by the away span on resume so a
    // roll backgrounded past MAX_ROLL_MS isn't settled (as a gutter) on return.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const gap = performance.now() - hiddenAt;
        const gs = gsRef.current;
        gs.rollStart += gap;
        gs.sweepAt += gap;
        hiddenAt = 0;
        last = performance.now();
        acc = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const frameLoop = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(frameLoop);
        return;
      }
      const dt = Math.min(now - last, 100);
      acc += dt;
      last = now;

      while (acc >= FIXED) {
        if (gs.phase === 'rolling') step(gs);
        acc -= FIXED;
      }

      if (gs.phase === 'rolling') {
        const ballSpeed = Math.hypot(gs.ball.vx, gs.ball.vy);
        const pinsMoving = gs.pins.some((p) => Math.abs(p.vx) + Math.abs(p.vy) > 0.05);
        const ballDone = gs.ball.y < -20 || ballSpeed < 0.06;
        // Wait for the pins to finish toppling even after the ball leaves, so a
        // fast strike isn't scored before the chain reaction completes.
        if ((ballDone && !pinsMoving) || now - gs.rollStart > MAX_ROLL_MS) {
          settleRoll();
        }
      } else if (gs.phase === 'sweep' && now - gs.sweepAt > SWEEP_MS) {
        applySweep();
      }

      updateFX(fxRef.current, gs, dt);
      draw(ctx, gs, fxRef.current);
      raf = requestAnimationFrame(frameLoop);
    };
    raf = requestAnimationFrame(frameLoop);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [playing, settleRoll, applySweep]);

  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
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
    const v = launch(gs.drag.dx, gs.drag.dy);
    if (!v) return;
    gs.ball.vx = v.vx0;
    gs.ball.vy = v.vy0;
    gs.ball.rolling = true;
    gs.phase = 'rolling';
    gs.rollStart = performance.now();
    setPhase('rolling');
    setNote('');
    // Rendering-only: a little release puff at the foul line.
    spawnBurst(fxRef.current.particles, gs.ball.x, gs.ball.y, 10, 140, PURPLE_LIGHT);
    playStroke();
  }, []);

  const restart = useCallback(() => {
    gsRef.current = freshGS();
    fxRef.current = freshFX();
    setScore(0);
    setFrame(0);
    setNote('');
    setPhase('aim');
  }, []);

  if (phase === 'done') {
    const remark =
      score >= 180 ? 'Turkey time! 🦃' : score >= 120 ? 'Great game! 🎳' : score >= 80 ? 'Nice rolling! 👍' : 'Keep bowling! 🎮';
    return (
      <Screen>
        <TopBar title="Bowling" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🎳</span>
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">final score · 10 frames</p>
          </div>
          <div className="mt-8">
            <Button onClick={restart} sound="none">
              Play again
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="Bowling" back="/fun" />
      <Content>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-fairway-50">
            Frame <span className="text-fairway-100">{Math.min(frame + 1, 10)}</span>
            <span className="font-normal text-fairway-400"> / 10</span>
          </span>
          <span className="text-fairway-300">
            Score <span className="font-bold text-fairway-100">{score}</span>
          </span>
        </div>

        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="block w-full touch-none rounded-2xl border border-fairway-800"
          style={{ aspectRatio: `${W} / ${H}` }}
        />

        <p className="mt-3 min-h-[2.5rem] text-center text-sm text-fairway-100/80">
          {phase === 'rolling' ? 'Rolling…' : note || 'Swipe up the lane to roll — angle it for a hook.'}
        </p>
      </Content>
    </Screen>
  );
}
