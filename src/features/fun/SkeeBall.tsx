import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameTicketAward from './GameTicketAward';
import GameHighScore from './GameHighScore';
import { useFitCanvas } from './useFitCanvas';
import { drawLogo, logoReady } from './logo';
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
  drawGlow,
  makeCachedLayer,
  brushedStreaks,
} from './fx';

// §12 Skee-Ball — the first attraction mini-game. Swipe up the lane to roll a
// ball into the target: land it in a scoring ring and it rolls down the inside
// of the ring into the hole at the bottom under gravity. Thread the top corners
// for 100, nail the small center ring for 50, or come up short for a gutter
// zero. Nine balls a game.
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

const GRAV = 0.5;
const MIN_V = 11;
const MAX_V = 25;
const MAX_DRAG = 300;
const BALLS = 9;
const FLIGHT_MS = 560; // arc-to-landing animation
const SINK_MS = 440; // roll down the inside of the ring into the hole after landing
const NEXT_DELAY_MS = 850; // pause on the result before the next ball
const FADE_END_Y = 350; // the aim trail is fully faded above this y (before the target)

type Vel = { vx0: number; vy0: number };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The drop hole at the bottom-inside of a ring. */
function holeDrop(h: Hole): { x: number; y: number } {
  return { x: h.cx, y: h.cy + h.R - HOLE_R - 4 };
}

/** Where the ball sits at progress `q` (0..1) as it settles into the hole. It
 *  rolls the short way down the *inside* of the ring toward the bottom, where the
 *  drop hole sits — so an off-centre landing hugs the ring wall and curves down
 *  to the hole instead of cutting straight across it. Modelled in polar terms
 *  about the ring centre: the angle swings to the bottom (screen-down) while the
 *  radius eases to land the ball inside the drop hole. Starts on the landing
 *  point (q=0). */
function sinkPos(h: Hole, land: { x: number; y: number }, q: number): { x: number; y: number } {
  const r0 = Math.hypot(land.x - h.cx, land.y - h.cy);
  const rHole = h.R - HOLE_R - 4; // the drop hole's centre distance from the ring centre
  const th0 = Math.atan2(land.y - h.cy, land.x - h.cx);
  const BOTTOM = Math.PI / 2; // screen-down — where the drop hole sits in the ring
  // Swing the short way round to the bottom, so the ball rolls down the nearer wall.
  const dth = ((((BOTTOM - th0 + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
  const e = q * q; // gravity from rest: the roll accelerates toward the bottom
  const th = th0 + dth * e;
  // Land inside the drop hole: grow outward to it, or for a rim landing already
  // past it, nestle in only as far as the hole's near edge (rHole + HOLE_R). We
  // never pull all the way to the hole centre, which at the bottom would read as
  // the ball climbing back up out of the ring.
  const endRad = clamp(r0, rHole, rHole + HOLE_R);
  const rad = r0 + (endRad - r0) * e;
  return {
    x: h.cx + Math.cos(th) * rad,
    y: Math.max(h.cy + Math.sin(th) * rad, land.y), // never rise above the landing
  };
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
 *  for a gutter miss. A ball only counts as "in the ring" when its centroid
 *  lands inside the ring's rim (d <= R) — no slop past the visible edge, so the
 *  ball is never scored while sitting outside the ring it's credited to. */
function holeAt(p: { x: number; y: number } | null): Hole | null {
  if (!p) return null;
  let best: Hole | null = null;
  let bestD = Infinity;
  for (const h of HOLES) {
    const d = Math.hypot(p.x - h.cx, p.y - h.cy);
    if (d <= h.R && d < bestD) {
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
  ringGlow: number[]; // per-ring hit lighting 0..1, parallel to HOLES
};

function freshFX(): FX {
  return {
    trail: [],
    particles: [],
    shake: 0,
    flash: 0,
    flashColor: '#22c55e',
    ringGlow: HOLES.map(() => 0),
  };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, gs: GS, dt: number) {
  if (gs.phase === 'flight' || gs.phase === 'sink') pushTrail(fx.trail, gs.ball.x, gs.ball.y, 14);
  else fx.trail.length = 0;
  fx.particles = stepParticles(fx.particles, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
  // Slower than the flash: a scored cup stays lit for a beat after the frame
  // flash has gone, the way a real lamp lags the event that fired it.
  for (let i = 0; i < fx.ringGlow.length; i++) fx.ringGlow[i] = decay(fx.ringGlow[i], dt, 0.0015);
}

// —— drawing —————————————————————————————————————————————————————————————————
// The cabinet, the lane and the ring bodies are pixel-identical on every frame —
// only how brightly a ring is LIT changes. Both are painted once into offscreen
// layers and blitted (fx.makeLayer); that's what buys the budget for the
// per-ring lighting below, which used to be seven shadowBlur strokes a frame.
const LANE_X = 24;
const LANE_W = W - 48;

/** Cabinet, lane and decal — everything behind the rings. */
function paintBackdrop(ctx: CanvasRenderingContext2D) {
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

  // —— The rolling lane: brushed steel, like the real alley bed ——
  // Cool metal against the warm green cabinet is the contrast a real Skee-Ball
  // machine has, and it gives the ring lamps something to actually reflect off:
  // a flat felt strip absorbs the glow and kills the lighting work below.
  ctx.save();
  roundRectPath(ctx, LANE_X, -20, LANE_W, H + 40, 22);
  ctx.clip();
  // Kept distinctly lighter than the cabinet around it. A dark lane swallows the
  // ring lamps' spill, and the spill landing on the bed is the whole point of
  // the lighting below — the surface has to have something to reflect.
  const lane = ctx.createLinearGradient(LANE_X, 0, LANE_X + LANE_W, 0);
  lane.addColorStop(0, '#1e2a2b');
  lane.addColorStop(0.18, '#3f4f50');
  lane.addColorStop(0.5, '#68797a');
  lane.addColorStop(0.82, '#3f4f50');
  lane.addColorStop(1, '#1e2a2b');
  ctx.fillStyle = lane;
  ctx.fillRect(LANE_X, -20, LANE_W, H + 40);
  // The grain itself — lengthwise, because that's the direction the bed is
  // ground in (and the direction the ball travels).
  brushedStreaks(ctx, LANE_X, -20, LANE_W, H + 40, 170, 0.07);
  // A tight specular band down the crown: metal has a hot line, not the broad
  // even wash a matte surface gives.
  const crown = ctx.createLinearGradient(LANE_X, 0, LANE_X + LANE_W, 0);
  crown.addColorStop(0.32, 'rgba(255,255,255,0)');
  crown.addColorStop(0.47, 'rgba(232,255,242,0.20)');
  crown.addColorStop(0.62, 'rgba(255,255,255,0)');
  ctx.fillStyle = crown;
  ctx.fillRect(LANE_X, -20, LANE_W, H + 40);
  // Green bounce from the cabinet at the top, falling to shadow at the near end
  // — the bed is steel, but it's steel sitting inside a green machine.
  const bounce = ctx.createLinearGradient(0, 0, 0, H);
  bounce.addColorStop(0, 'rgba(74,222,128,0.16)');
  bounce.addColorStop(0.55, 'rgba(74,222,128,0.05)');
  bounce.addColorStop(1, 'rgba(0,0,0,0.20)');
  ctx.fillStyle = bounce;
  ctx.fillRect(LANE_X, -20, LANE_W, H + 40);
  ctx.restore();

  // Rounded rails flanking the lane.
  ctx.save();
  roundRectPath(ctx, 22, -20, LANE_W + 4, H + 40, 24);
  ctx.lineWidth = 5;
  const rail = ctx.createLinearGradient(0, 0, 0, H);
  rail.addColorStop(0, 'rgba(134,239,172,0.55)');
  rail.addColorStop(0.5, 'rgba(34,197,94,0.4)');
  rail.addColorStop(1, 'rgba(20,83,45,0.5)');
  ctx.strokeStyle = rail;
  ctx.stroke();
  ctx.restore();

  // Lane decal, on the clear bed between the lowest scoring ring (~380) and the
  // racked ball (~478). Dark and low-alpha so it reads as etched INTO the steel
  // — a bright mark here would look like a sticker floating above the surface
  // the ball rolls across.
  //
  // Wordmark, not the lockup: the gap is under 100px tall, and a lockup narrow
  // enough to fit puts the moose below the ~92px its hairlines need, so it
  // renders as a smudge and crowds the 10-ring on top of that.
  drawLogo(ctx, W / 2, 432, { variant: 'wordmark', width: 140, tint: '#0c1c18', alpha: 0.55 });

  // —— Corner vignette for depth ——
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

/** The seven ring bodies, on transparent — blitted inside the shake transform
 *  so the cups still move with an impact. */
function paintRings(ctx: CanvasRenderingContext2D) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Lower (bigger) rings first so the upper rings layer cleanly where they touch.
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
    // Glowing neon rim. shadowBlur is affordable here — this runs once, not
    // per frame — and gives a softer falloff than a plain stroke.
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
}

const backdropLayer = makeCachedLayer(W, H, paintBackdrop);
const ringsLayer = makeCachedLayer(W, H, paintRings);

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX) {
  ctx.clearRect(0, 0, W, H);

  // Keyed on the decal so the backdrop is rebuilt once the mark decodes. A null
  // layer means no DOM / no 2D context — paint straight to the frame instead of
  // blanking out.
  const backdrop = backdropLayer(logoReady('wordmark'));
  const rings = ringsLayer();
  if (backdrop) ctx.drawImage(backdrop, 0, 0, W, H);
  else paintBackdrop(ctx);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // —— Dynamic layer (shaken on a big score) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  if (rings) ctx.drawImage(rings, 0, 0, W, H);
  else paintRings(ctx);

  // A cup that was just scored stays lit for a beat. Nothing glows at rest —
  // the lamps come up because something happened, not as atmosphere.
  for (let i = 0; i < HOLES.length; i++) {
    const hit = fx.ringGlow[i];
    if (hit < 0.02) continue;
    const h = HOLES[i];
    drawGlow(ctx, h.cx, h.cy, h.R * (2.2 + hit * 1.4), h.color, hit * 0.6);
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

  // Cabinet finish, last of all: scanlines + a tube vignette over the
  // finished frame. The bezel and bloom around the screen are CSS
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
  // One id per played round — the ticket award's idempotency key.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const playing = phase !== 'done';

  // Fill the play area: size the canvas to fit its stage (see useFitCanvas).
  useFitCanvas(canvasRef, W, H, playing);

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
    // Light the cup that took the ball — every scoring ring lights the same way,
    // scaled by what it was worth.
    if (shot.hole) {
      const ri = HOLES.indexOf(shot.hole);
      if (ri >= 0) fx.ringGlow[ri] = shot.score >= 100 ? 1 : 0.7;
    }
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
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    const remark =
      total >= 500 ? 'Skee-Ball wizard! 🧙' : total >= 300 ? 'Great arm! 🎯' : total >= 150 ? 'Nicely rolled! 👍' : 'Keep practicing! 🎮';
    return (
      <Screen>
        <TopBar title="Skee-Ball" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🎳</span>
            <div className="text-5xl font-black text-fairway-50">{total}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">across {BALLS} balls</p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (1 ticket per 10 points). */}
          <GameTicketAward game="skeeball" tickets={Math.round(total / 10)} sessionId={sessionId} />
          <GameHighScore game="skeeball" score={total} sessionId={sessionId} />
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
    // Full-height column (Screen's min-h-full doesn't resolve to a real height,
    // so use a dvh column like CourseMap). HUD + hint keep their size; the stage
    // flexes to fill, and useFitCanvas sizes the canvas to the largest W:H box
    // that fits it.
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Skee-Ball" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Ball <span className="text-fairway-100">{Math.min(ballNo + 1, BALLS)}</span>
          <span className="font-normal text-fairway-400"> / {BALLS}</span>
        </span>
        <span className="text-fairway-300">
          Score <span className="font-bold text-fairway-100">{total}</span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="block touch-none rounded-2xl arcade-screen"
        />
      </div>

      <p className="flex h-16 shrink-0 items-center justify-center px-4 pb-4 pt-3 text-center text-sm text-fairway-100/80">
        <span className="line-clamp-2">{hint}</span>
      </p>
    </div>
  );
}
