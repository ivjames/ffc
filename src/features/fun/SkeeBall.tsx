import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playStroke, playCup, playDing, playUndo, playFanfare } from '../../lib/sound';
import type { Particle, Vec as FxVec } from './fx';
import {
  TWO_PI,
  withAlpha,
  roundRectPath,
  drawShadow,
  drawSphere,
  spawnBurst,
  stepParticles,
  drawParticles,
  pushTrail,
  decay,
  shakeOffset,
} from './fx';

// §12 Skee-Ball — the first attraction mini-game. Swipe up the lane to roll a
// ball into the target: each scoring ring is a funnel dish the ball circles and
// spirals down into its drop hole (never yanked straight in). Thread the top
// corners for 100, nail the small center ring for 50, or come up short for a
// gutter zero. Nine balls a game.
//
// The landing is deterministic from the swipe, but the aim trail FADES OUT before
// the target — you commit to a line and power without a pinpoint preview, so
// judging the roll is the skill. All client-side canvas; works offline.

// —— Field + physics (logical units; the canvas scales to fit) ———————————————
const W = 360;
const H = 560;
const BALL_R = 12;
const START = { x: W / 2, y: 500 };

// Scoring targets: each is a ring (rim radius R) with a hole at its bottom that
// the ball rolls down into. Laid out as a center column (higher value = further
// up the lane = more power) with the two hard 100 holes in the top corners.
type Hole = { cx: number; cy: number; R: number; pts: number; color: string };
const HOLES: Hole[] = [
  { cx: 88, cy: 74, R: 18, pts: 100, color: '#22c55e' },
  { cx: W - 88, cy: 74, R: 18, pts: 100, color: '#22c55e' },
  { cx: W / 2, cy: 96, R: 26, pts: 50, color: '#f59e0b' },
  { cx: W / 2, cy: 160, R: 30, pts: 40, color: '#ec4899' },
  { cx: W / 2, cy: 226, R: 32, pts: 30, color: '#a855f7' },
  { cx: W / 2, cy: 292, R: 34, pts: 20, color: '#3b82f6' },
  { cx: W / 2, cy: 358, R: 36, pts: 10, color: '#38bdf8' },
];
const HOLE_R = 8; // the drop hole at the bottom of each ring
const FUNNEL = 12; // lands within R + FUNNEL of a ring get funneled in

const GRAV = 0.5;
const MIN_V = 11;
const MAX_V = 25;
const MAX_DRAG = 300;
const BALLS = 9;
const FLIGHT_MS = 560; // arc-to-landing animation
const SINK_MS = 620; // roll-around-the-dish-and-drop-in animation
const SINK_TURNS = 2; // extra whole revolutions before the drop — must be an
// integer so `SINK_TURNS * TWO_PI` lands the spiral back on the drop-hole angle
const NEXT_DELAY_MS = 850; // pause on the result before the next ball
const FADE_END_Y = 350; // the aim trail is fully faded above this y (before the target)

type Vel = { vx0: number; vy0: number };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The drop hole at the bottom-inside of a ring. */
function holeDrop(h: Hole): { x: number; y: number } {
  return { x: h.cx, y: h.cy + h.R - HOLE_R - 4 };
}

/** Where the ball sits at progress `q` (0..1) as it rolls *around* the funnel
 *  dish and spirals down into the drop hole — rather than sliding straight to
 *  it. Modelled as polar motion about the ring centre: the ball keeps its
 *  landing radius while it whips around the rim early, then the radius collapses
 *  toward the drop hole for the final plunge. The path starts exactly on the
 *  landing point (q=0) and ends exactly on the drop hole (q=1). */
function sinkPos(h: Hole, land: { x: number; y: number }, q: number): { x: number; y: number } {
  const dp = holeDrop(h);
  const r0 = Math.hypot(land.x - h.cx, land.y - h.cy);
  const r1 = Math.hypot(dp.x - h.cx, dp.y - h.cy);
  // Start angle: fall back to the drop-hole angle for a dead-centre landing so a
  // near-zero radius doesn't spiral outward from a meaningless heading.
  const a0 = r0 < 0.5 ? Math.atan2(dp.y - h.cy, dp.x - h.cx) : Math.atan2(land.y - h.cy, land.x - h.cx);
  const a1 = Math.atan2(dp.y - h.cy, dp.x - h.cx);
  // Sweep from the landing heading to the drop-hole heading, plus whole extra
  // revolutions so the ball visibly circles the dish. Normalised to a positive
  // (clockwise-in-screen) turn for a consistent roll direction.
  let da = (a1 - a0) % TWO_PI;
  if (da < 0) da += TWO_PI;
  const sweep = da + SINK_TURNS * TWO_PI;
  // Circle fast-then-settling (angle ease-out); hold the wide radius, then let it
  // collapse into the hole late (radius ease-in) — the funnel "drop" at the end.
  const ang = a0 + sweep * (1 - (1 - q) * (1 - q));
  const rad = r0 + (r1 - r0) * (q * q);
  return { x: h.cx + Math.cos(ang) * rad, y: h.cy + Math.sin(ang) * rad };
}

/** Map a swipe (drag delta) to a launch velocity, or null if it isn't a valid
 *  upward roll. */
function launchVelocity(dx: number, dy: number): Vel | null {
  const len = Math.hypot(dx, dy);
  if (len < 10) return null; // deadzone tap
  if (dy / len > -0.25) return null; // not aimed up the lane
  const power = Math.min(len / MAX_DRAG, 1);
  const speed = MIN_V + power * (MAX_V - MIN_V);
  return { vx0: (dx / len) * speed, vy0: (dy / len) * speed };
}

/** Ball position along its parabola at time t (constant vx, gravity on vy). */
function trajectory(v: Vel, t: number): { x: number; y: number } {
  return { x: START.x + v.vx0 * t, y: START.y + v.vy0 * t + 0.5 * GRAV * t * t };
}

/** Time to the apex — where the ball settles into the target plane. */
function apexTime(v: Vel): number {
  return -v.vy0 / GRAV;
}

/** Where the ball lands (its apex), or null for an invalid shot. */
function landingPoint(v: Vel): { x: number; y: number } | null {
  if (v.vy0 >= 0) return null;
  return trajectory(v, apexTime(v));
}

/** The ring/hole a landing point drops into (nearest that captures it), or null
 *  for a gutter miss. */
function holeAt(p: { x: number; y: number } | null): Hole | null {
  if (!p) return null;
  let best: Hole | null = null;
  let bestD = Infinity;
  for (const h of HOLES) {
    const d = Math.hypot(p.x - h.cx, p.y - h.cy);
    if (d <= h.R + FUNNEL && d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

type Phase = 'aim' | 'flight' | 'sink' | 'scored' | 'done';
type Shot = {
  v: Vel;
  land: { x: number; y: number };
  hole: Hole | null;
  score: number;
  startedAt: number;
  sinkAt: number;
};
type Drag = { active: boolean; sx: number; sy: number; dx: number; dy: number };
type GS = {
  phase: Phase;
  ballNo: number; // 0-based index of the current ball
  total: number;
  ball: { x: number; y: number };
  ballR: number; // shrinks as the ball drops into a hole
  drag: Drag;
  shot: Shot | null;
  lastPts: number | null;
};

function freshGS(): GS {
  return {
    phase: 'aim',
    ballNo: 0,
    total: 0,
    ball: { ...START },
    ballR: BALL_R,
    drag: { active: false, sx: 0, sy: 0, dx: 0, dy: 0 },
    shot: null,
    lastPts: null,
  };
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the deterministic sim is never touched; they're
// advanced per animation frame with a real dt and only ever paint pixels. Built
// on the shared ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent ball positions → motion streak while rolling
  particles: Particle[]; // spark bursts on release / score
  shake: number; // screen-shake magnitude (px), decays to 0
  flash: number; // big-score flash 0..1, decays to 0
  flashColor: string;
};

function freshFX(): FX {
  return { trail: [], particles: [], shake: 0, flash: 0, flashColor: '#22c55e' };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, gs: GS, dt: number) {
  if (gs.phase === 'flight' || gs.phase === 'sink') pushTrail(fx.trail, gs.ball.x, gs.ball.y, 14);
  else fx.trail.length = 0;
  fx.particles = stepParticles(fx.particles, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX) {
  ctx.clearRect(0, 0, W, H);

  // —— Backboard: a deep, top-lit green cabinet ——
  const back = ctx.createLinearGradient(0, 0, 0, H);
  back.addColorStop(0, '#071a12');
  back.addColorStop(0.5, '#05130d');
  back.addColorStop(1, '#040d09');
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, W, H);

  // Overhead sheen over the scoring end.
  const sheen = ctx.createRadialGradient(W / 2, H * 0.24, 20, W / 2, H * 0.24, H * 0.7);
  sheen.addColorStop(0, 'rgba(74,222,128,0.14)');
  sheen.addColorStop(1, 'rgba(74,222,128,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  // —— The rolling lane: a felt strip with a lit crown down the middle ——
  const laneX = 24;
  const laneW = W - 48;
  const lane = ctx.createLinearGradient(laneX, 0, laneX + laneW, 0);
  lane.addColorStop(0, '#0a2318');
  lane.addColorStop(0.5, '#124a30');
  lane.addColorStop(1, '#0a2318');
  ctx.save();
  roundRectPath(ctx, laneX, -20, laneW, H + 40, 22);
  ctx.fillStyle = lane;
  ctx.fill();
  // Lengthwise sheen so the felt reads as a rolling surface.
  const laneSheen = ctx.createLinearGradient(0, 0, 0, H);
  laneSheen.addColorStop(0, 'rgba(120,240,170,0.10)');
  laneSheen.addColorStop(0.55, 'rgba(120,240,170,0.03)');
  laneSheen.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = laneSheen;
  ctx.fill();
  ctx.restore();

  // Rounded rails flanking the lane.
  ctx.save();
  roundRectPath(ctx, 22, -20, laneW + 4, H + 40, 24);
  ctx.lineWidth = 5;
  const rail = ctx.createLinearGradient(0, 0, 0, H);
  rail.addColorStop(0, 'rgba(134,239,172,0.55)');
  rail.addColorStop(0.5, 'rgba(34,197,94,0.4)');
  rail.addColorStop(1, 'rgba(20,83,45,0.5)');
  ctx.strokeStyle = rail;
  ctx.stroke();
  ctx.restore();

  // —— Corner vignette for depth ——
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // —— Dynamic layer (shaken on a big score) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Target rings + their drop holes. Draw lower (bigger) rings first so the
  // upper rings layer cleanly on top where they touch.
  const ordered = [...HOLES].sort((a, b) => b.cy - a.cy);
  for (const h of ordered) {
    // Funnel dish: a lit bowl sinking toward its drop hole.
    const dish = ctx.createRadialGradient(h.cx, h.cy - h.R * 0.3, h.R * 0.1, h.cx, h.cy, h.R);
    dish.addColorStop(0, withAlpha(h.color, 0.32));
    dish.addColorStop(0.7, withAlpha(h.color, 0.14));
    dish.addColorStop(1, 'rgba(3,10,7,0.55)');
    ctx.beginPath();
    ctx.arc(h.cx, h.cy, h.R, 0, TWO_PI);
    ctx.fillStyle = dish;
    ctx.fill();
    // Glowing neon rim.
    ctx.save();
    ctx.beginPath();
    ctx.arc(h.cx, h.cy, h.R, 0, TWO_PI);
    ctx.strokeStyle = h.color;
    ctx.lineWidth = 3;
    ctx.shadowColor = h.color;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();
    // Value label near the top of the ring, softly lit.
    ctx.save();
    ctx.fillStyle = '#eafff2';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.shadowColor = withAlpha(h.color, 0.9);
    ctx.shadowBlur = 6;
    ctx.fillText(String(h.pts), h.cx, h.cy - h.R * 0.42);
    ctx.restore();
    // The hole at the bottom of the ring — a dark recess with a lit lip.
    const dp = holeDrop(h);
    const pit = ctx.createRadialGradient(dp.x, dp.y - HOLE_R * 0.4, 1, dp.x, dp.y, HOLE_R);
    pit.addColorStop(0, '#0a1710');
    pit.addColorStop(1, '#03070a');
    ctx.beginPath();
    ctx.arc(dp.x, dp.y, HOLE_R, 0, TWO_PI);
    ctx.fillStyle = pit;
    ctx.fill();
    ctx.strokeStyle = withAlpha(h.color, 0.6);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Aim trail while dragging — dots that FADE OUT before reaching the target, so
  // the landing spot isn't given away. Neutral color (never reveals the score).
  if (gs.phase === 'aim' && gs.drag.active) {
    const v = launchVelocity(gs.drag.dx, gs.drag.dy);
    if (v && v.vy0 < 0) {
      const tStar = apexTime(v);
      ctx.save();
      ctx.fillStyle = '#dbe7ff';
      ctx.shadowColor = 'rgba(203,213,225,0.8)';
      ctx.shadowBlur = 6;
      for (let i = 1; i <= 30; i++) {
        const p = trajectory(v, (i / 30) * tStar);
        // Fade from the ball (full) to nothing at FADE_END_Y (below the target).
        const a = clamp((p.y - FADE_END_Y) / (START.y - FADE_END_Y), 0, 1);
        if (a <= 0.03) continue;
        ctx.globalAlpha = a * a * 0.7;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, TWO_PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // Ball motion streak while it's rolling (drawn under the ball).
  if (fx.trail.length > 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < fx.trail.length; i++) {
      const t = fx.trail[i];
      const k = i / fx.trail.length;
      ctx.beginPath();
      ctx.arc(t.x, t.y, gs.ballR * (0.25 + k * 0.7), 0, TWO_PI);
      ctx.fillStyle = `rgba(190,230,255,${0.02 + k * 0.09})`;
      ctx.fill();
    }
    ctx.restore();
  }

  // The ball: a lit sphere with a soft contact shadow.
  if (gs.ballR > 0.5) {
    drawShadow(ctx, gs.ball.x, gs.ball.y + gs.ballR * 0.5, gs.ballR * 0.95, gs.ballR * 0.45, 0.35);
    drawSphere(ctx, gs.ball.x, gs.ball.y, gs.ballR, '#ffffff', '#d3ddec', '#8794a6');
  }

  // Spark bursts on release / score.
  drawParticles(ctx, fx.particles);

  // Floating "+N" once the ball has settled, glowing so it reads as lit.
  if (gs.phase === 'scored' && gs.shot && gs.lastPts !== null) {
    const at = gs.shot.hole ? holeDrop(gs.shot.hole) : gs.shot.land;
    const col = gs.lastPts >= 100 ? '#4ade80' : gs.lastPts > 0 ? '#fbbf24' : '#94a3b8';
    ctx.save();
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = col;
    ctx.shadowColor = withAlpha(col, 0.9);
    ctx.shadowBlur = 14;
    ctx.fillText(gs.lastPts > 0 ? `+${gs.lastPts}` : 'MISS', at.x, Math.max(at.y - 24, 20));
    ctx.restore();
  }

  ctx.restore();

  // —— Big-score flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }
}

export default function SkeeBall() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());
  const nextTimer = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('aim');
  const [ballNo, setBallNo] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastPts, setLastPts] = useState<number | null>(null);

  const playing = phase !== 'done';

  const loadNextBall = useCallback(() => {
    const gs = gsRef.current;
    if (gs.ballNo + 1 >= BALLS) {
      gs.phase = 'done';
      setPhase('done');
      playFanfare();
      return;
    }
    gs.ballNo += 1;
    gs.ball = { ...START };
    gs.ballR = BALL_R;
    gs.shot = null;
    gs.lastPts = null;
    gs.phase = 'aim';
    setBallNo(gs.ballNo);
    setLastPts(null);
    setPhase('aim');
  }, []);

  // Score the current shot, then queue the next ball.
  const finalize = useCallback(() => {
    const gs = gsRef.current;
    const shot = gs.shot;
    if (!shot) return;
    gs.total += shot.score;
    gs.lastPts = shot.score;
    gs.phase = 'scored';
    setTotal(gs.total);
    setLastPts(shot.score);
    setPhase('scored');
    // Rendering-only celebration keyed off the score that already happened.
    const fx = fxRef.current;
    const at = shot.hole ? holeDrop(shot.hole) : shot.land;
    if (shot.score >= 100) {
      fx.shake = 8;
      fx.flash = 1;
      fx.flashColor = shot.hole?.color ?? '#22c55e';
      spawnBurst(fx.particles, at.x, at.y, 30, 300, '#86efac');
      spawnBurst(fx.particles, at.x, at.y, 14, 150, '#eafff2');
    } else if (shot.score > 0) {
      fx.shake = 4;
      spawnBurst(fx.particles, at.x, at.y, 16, 200, shot.hole?.color ?? '#22c55e');
    } else {
      spawnBurst(fx.particles, at.x, at.y, 6, 90, '#64748b');
    }
    if (shot.score >= 100) playFanfare();
    else if (shot.score > 0) (shot.score >= 40 ? playCup : playDing)();
    else playUndo();
    nextTimer.current = window.setTimeout(loadNextBall, NEXT_DELAY_MS);
  }, [loadNextBall]);

  // Render + animation loop. The canvas only exists on the play view, so this
  // re-initializes whenever it mounts.
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
    let last = performance.now(); // rendering-only dt clock (does not drive the sim)
    // Pause the animation clock while backgrounded so a resumed game doesn't
    // teleport the ball (PWA/Capacitor lifecycle). Use visibilitychange rather
    // than a hidden-rAF branch: mobile browsers suspend requestAnimationFrame
    // while hidden, so a hidden frame may never run to shift the shot clock —
    // the shot would then complete instantly on return. Shift by the away span.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const gap = performance.now() - hiddenAt;
        const gs = gsRef.current;
        if (gs.shot) {
          gs.shot.startedAt += gap;
          gs.shot.sinkAt += gap;
        }
        hiddenAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const frame = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(now - last, 100); // clamp so a stall doesn't spike effects
      last = now;

      if (gs.phase === 'flight' && gs.shot) {
        const p = Math.min((now - gs.shot.startedAt) / FLIGHT_MS, 1);
        gs.ball = trajectory(gs.shot.v, p * apexTime(gs.shot.v));
        if (p >= 1) {
          gs.ball = { ...gs.shot.land };
          if (gs.shot.hole) {
            gs.phase = 'sink';
            gs.shot.sinkAt = now;
          } else {
            finalize(); // gutter — nothing to drop into
          }
        }
      } else if (gs.phase === 'sink' && gs.shot && gs.shot.hole) {
        const q = Math.min((now - gs.shot.sinkAt) / SINK_MS, 1);
        // Roll around the funnel dish and spiral into the hole, not a straight pull.
        gs.ball = sinkPos(gs.shot.hole, gs.shot.land, q);
        // Shrink into the hole over the last part of the roll.
        gs.ballR = BALL_R * (1 - 0.85 * clamp((q - 0.55) / 0.45, 0, 1));
        if (q >= 1) finalize();
      }

      updateFX(fxRef.current, gs, dt);
      draw(ctx, gs, fxRef.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [playing, finalize]);

  // Clear a pending "next ball" timer if we leave the screen mid-result.
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
    const v = launchVelocity(gs.drag.dx, gs.drag.dy);
    const land = v && landingPoint(v);
    if (!v || !land) return; // not a valid roll — ball not consumed
    const hole = holeAt(land);
    gs.shot = { v, land, hole, score: hole ? hole.pts : 0, startedAt: performance.now(), sinkAt: 0 };
    gs.ballR = BALL_R;
    gs.phase = 'flight';
    setPhase('flight');
    // Rendering-only launch puff at the release point.
    const fx = fxRef.current;
    fx.trail.length = 0;
    spawnBurst(fx.particles, START.x, START.y, 8, 120, '#86efac');
    playStroke();
  }, []);

  const restart = useCallback(() => {
    if (nextTimer.current) clearTimeout(nextTimer.current);
    gsRef.current = freshGS();
    fxRef.current = freshFX();
    setPhase('aim');
    setBallNo(0);
    setTotal(0);
    setLastPts(null);
  }, []);

  if (phase === 'done') {
    const remark =
      total >= 500 ? 'Skee-Ball wizard! 🧙' : total >= 300 ? 'Great arm! 🎯' : total >= 150 ? 'Nicely rolled! 👍' : 'Keep practicing! 🎮';
    return (
      <Screen>
        <TopBar title="Skee-Ball" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🎳</span>
            <div className="text-5xl font-black text-fairway-50">{total}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">across {BALLS} balls</p>
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

  const hint =
    phase === 'aim'
      ? lastPts !== null
        ? lastPts > 0
          ? `Nice — +${lastPts}! Line up the next one.`
          : 'Gutter! Line up the next one.'
        : 'Swipe up the lane to roll — aim the corners for 100.'
      : phase === 'flight' || phase === 'sink'
        ? 'Rolling…'
        : lastPts && lastPts > 0
          ? `+${lastPts}!`
          : 'Gutter!';

  return (
    <Screen>
      <TopBar title="Skee-Ball" back="/fun" />
      <Content>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-fairway-50">
            Ball <span className="text-fairway-100">{Math.min(ballNo + 1, BALLS)}</span>
            <span className="font-normal text-fairway-400"> / {BALLS}</span>
          </span>
          <span className="text-fairway-300">
            Score <span className="font-bold text-fairway-100">{total}</span>
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

        <p className="mt-3 min-h-[2.5rem] text-center text-sm text-fairway-100/80">{hint}</p>
      </Content>
    </Screen>
  );
}
