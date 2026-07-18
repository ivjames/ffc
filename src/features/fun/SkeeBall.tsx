import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playStroke, playCup, playDing, playUndo, playFanfare } from '../../lib/sound';

// §12 Skee-Ball — the first attraction mini-game. Swipe up the lane to roll a
// ball into the target: each scoring ring has a hole the ball drops into. Thread
// the top corners for 100, nail the small center ring for 50, or come up short
// for a gutter zero. Nine balls a game.
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
const SINK_MS = 320; // roll-down-into-the-hole animation
const NEXT_DELAY_MS = 850; // pause on the result before the next ball
const FADE_END_Y = 350; // the aim trail is fully faded above this y (before the target)

type Vel = { vx0: number; vy0: number };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The drop hole at the bottom-inside of a ring. */
function holeDrop(h: Hole): { x: number; y: number } {
  return { x: h.cx, y: h.cy + h.R - HOLE_R - 4 };
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

// —— drawing —————————————————————————————————————————————————————————————————
function draw(ctx: CanvasRenderingContext2D, gs: GS) {
  ctx.clearRect(0, 0, W, H);

  // Lane + gutters.
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111a2b';
  ctx.fillRect(24, 0, W - 48, H);
  ctx.strokeStyle = '#1f2c44';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 0, W - 48, H);

  // Target rings + their drop holes. Draw lower (bigger) rings first so the
  // upper rings layer cleanly on top where they touch.
  const ordered = [...HOLES].sort((a, b) => b.cy - a.cy);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const h of ordered) {
    // Funnel dish.
    ctx.beginPath();
    ctx.arc(h.cx, h.cy, h.R, 0, Math.PI * 2);
    ctx.fillStyle = h.color + '26';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = h.color;
    ctx.stroke();
    // Value label near the top of the ring.
    ctx.fillStyle = '#e5edf7';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(String(h.pts), h.cx, h.cy - h.R * 0.42);
    // The hole at the bottom of the ring.
    const dp = holeDrop(h);
    ctx.beginPath();
    ctx.arc(dp.x, dp.y, HOLE_R, 0, Math.PI * 2);
    ctx.fillStyle = '#05070d';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Aim trail while dragging — dots that FADE OUT before reaching the target, so
  // the landing spot isn't given away. Neutral color (never reveals the score).
  if (gs.phase === 'aim' && gs.drag.active) {
    const v = launchVelocity(gs.drag.dx, gs.drag.dy);
    if (v && v.vy0 < 0) {
      const tStar = apexTime(v);
      ctx.fillStyle = '#cbd5e1';
      for (let i = 1; i <= 30; i++) {
        const p = trajectory(v, (i / 30) * tStar);
        // Fade from the ball (full) to nothing at FADE_END_Y (below the target).
        const a = clamp((p.y - FADE_END_Y) / (START.y - FADE_END_Y), 0, 1);
        if (a <= 0.03) continue;
        ctx.globalAlpha = a * a * 0.7;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // The ball.
  if (gs.ballR > 0.5) {
    ctx.beginPath();
    ctx.arc(gs.ball.x, gs.ball.y, gs.ballR, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(gs.ball.x - 4, gs.ball.y - 4, 2, gs.ball.x, gs.ball.y, gs.ballR);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#c7d2e0');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Floating "+N" once the ball has settled.
  if (gs.phase === 'scored' && gs.shot && gs.lastPts !== null) {
    const at = gs.shot.hole ? holeDrop(gs.shot.hole) : gs.shot.land;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = gs.lastPts >= 100 ? '#4ade80' : gs.lastPts > 0 ? '#fbbf24' : '#94a3b8';
    ctx.fillText(gs.lastPts > 0 ? `+${gs.lastPts}` : 'MISS', at.x, Math.max(at.y - 24, 20));
  }
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);

export default function SkeeBall() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
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
    let lastFrame = performance.now();
    const frame = (now: number) => {
      const gs = gsRef.current;
      // Pause the animation clock while backgrounded so a resumed game doesn't
      // teleport the ball (PWA/Capacitor lifecycle).
      if (document.hidden) {
        if (gs.shot) {
          gs.shot.startedAt += now - lastFrame;
          gs.shot.sinkAt += now - lastFrame;
        }
        lastFrame = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      lastFrame = now;

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
        const e = easeOut(q);
        const dp = holeDrop(gs.shot.hole);
        gs.ball = {
          x: gs.shot.land.x + (dp.x - gs.shot.land.x) * e,
          y: gs.shot.land.y + (dp.y - gs.shot.land.y) * e,
        };
        // Shrink into the hole over the last part of the roll.
        gs.ballR = BALL_R * (1 - 0.85 * clamp((q - 0.55) / 0.45, 0, 1));
        if (q >= 1) finalize();
      }

      draw(ctx, gs);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
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
    playStroke();
  }, []);

  const restart = useCallback(() => {
    if (nextTimer.current) clearTimeout(nextTimer.current);
    gsRef.current = freshGS();
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
