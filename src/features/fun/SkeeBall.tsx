import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playStroke, playCup, playDing, playUndo, playFanfare } from '../../lib/sound';

// §12 Skee-Ball — the first attraction mini-game. Swipe up the lane to roll a
// ball into the target: nail the center for 50, thread the top corners for 100,
// or come up short for a gutter zero. Nine balls a game.
//
// The landing is fully deterministic from the swipe (no RNG) and a live reticle
// previews exactly where the ball will drop, so it's pure skill — the same
// "feels fair in the hand" bar as Arcade Putt. Everything is client-side canvas;
// works offline.

// —— Field + physics (logical units; the canvas scales to fit) ———————————————
const W = 360;
const H = 560;
const BALL_R = 12;
const START = { x: W / 2, y: 500 };
const CENTER = { x: W / 2, y: 150 };

// Concentric scoring rings (outer radius → points).
const RINGS: Array<{ r: number; pts: number; fill: string }> = [
  { r: 140, pts: 10, fill: '#1e3a5f' },
  { r: 104, pts: 20, fill: '#2563eb' },
  { r: 74, pts: 30, fill: '#7c3aed' },
  { r: 48, pts: 40, fill: '#db2777' },
  { r: 24, pts: 50, fill: '#f59e0b' },
];
// The two high-value corner holes.
const CORNERS = [
  { x: 72, y: 70 },
  { x: W - 72, y: 70 },
];
const CORNER_R = 22;
const CORNER_PTS = 100;
const TOP_GUARD = 34; // an apex above this flew off the back → 0

const GRAV = 0.5;
const MIN_V = 11;
const MAX_V = 25;
const MAX_DRAG = 300;
const BALLS = 9;
const FLIGHT_MS = 620; // roll animation duration
const NEXT_DELAY_MS = 850; // pause on the result before the next ball

type Vel = { vx0: number; vy0: number };

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

/** Points scored for a landing point. Corners first, then rings by radius. */
function scoreAt(p: { x: number; y: number } | null): number {
  if (!p) return 0;
  for (const c of CORNERS) if (Math.hypot(p.x - c.x, p.y - c.y) <= CORNER_R) return CORNER_PTS;
  if (p.y < TOP_GUARD) return 0; // over the back
  const d = Math.hypot(p.x - CENTER.x, p.y - CENTER.y);
  for (const ring of RINGS) if (d <= ring.r) return ring.pts;
  return 0; // short / wide → gutter
}

type Phase = 'aim' | 'rolling' | 'scored' | 'done';
type Shot = { v: Vel; land: { x: number; y: number }; score: number; startedAt: number };
type Drag = { active: boolean; sx: number; sy: number; dx: number; dy: number };
type GS = {
  phase: Phase;
  ballNo: number; // 0-based index of the current ball
  total: number;
  ball: { x: number; y: number };
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

  // Target rings, outer → inner, each labeled with its value.
  for (const ring of RINGS) {
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, ring.r, 0, Math.PI * 2);
    ctx.fillStyle = ring.fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Ring value labels along the top edge of each band.
  for (const ring of RINGS) {
    const inner = RINGS.find((r) => r.r < ring.r)?.r ?? 0;
    const y = CENTER.y - (ring.r + inner) / 2;
    ctx.fillText(String(ring.pts), CENTER.x, y);
  }

  // Corner 100 holes.
  for (const c of CORNERS) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, CORNER_R, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1220';
    ctx.fill();
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('100', c.x, c.y);
  }

  // Aim guide + landing reticle while dragging a valid shot.
  if (gs.phase === 'aim' && gs.drag.active) {
    const v = launchVelocity(gs.drag.dx, gs.drag.dy);
    const land = v && landingPoint(v);
    if (v && land) {
      const pts = scoreAt(land);
      const color = pts >= 100 ? '#4ade80' : pts > 0 ? '#fbbf24' : '#64748b';
      // Dotted parabola from ball to landing.
      const tStar = apexTime(v);
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const p = trajectory(v, (i / 24) * tStar);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Reticle at the predicted landing.
      ctx.beginPath();
      ctx.arc(land.x, land.y, 10, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  // The ball.
  ctx.beginPath();
  ctx.arc(gs.ball.x, gs.ball.y, BALL_R, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(
    gs.ball.x - 4,
    gs.ball.y - 4,
    2,
    gs.ball.x,
    gs.ball.y,
    BALL_R,
  );
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#c7d2e0');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Floating "+N" once the ball has settled.
  if (gs.phase === 'scored' && gs.shot && gs.lastPts !== null) {
    const { x, y } = gs.shot.land;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = gs.lastPts >= 100 ? '#4ade80' : gs.lastPts > 0 ? '#fbbf24' : '#94a3b8';
    ctx.fillText(gs.lastPts > 0 ? `+${gs.lastPts}` : 'MISS', x, Math.max(y - 22, 20));
  }
}

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
    gs.shot = null;
    gs.lastPts = null;
    gs.phase = 'aim';
    setBallNo(gs.ballNo);
    setLastPts(null);
    setPhase('aim');
  }, []);

  // Render + roll-animation loop. The canvas only exists on the play view, so
  // this re-initializes whenever it mounts.
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
      // Pause the flight clock while the tab/app is backgrounded so a resumed
      // game doesn't teleport the ball (matches the PWA/Capacitor lifecycle).
      if (document.hidden) {
        if (gs.shot) gs.shot.startedAt += now - lastFrame;
        lastFrame = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      lastFrame = now;

      if (gs.phase === 'rolling' && gs.shot) {
        const p = Math.min((now - gs.shot.startedAt) / FLIGHT_MS, 1);
        gs.ball = trajectory(gs.shot.v, p * apexTime(gs.shot.v));
        if (p >= 1) {
          gs.ball = { ...gs.shot.land };
          gs.total += gs.shot.score;
          gs.lastPts = gs.shot.score;
          gs.phase = 'scored';
          setTotal(gs.total);
          setLastPts(gs.shot.score);
          setPhase('scored');
          if (gs.shot.score >= 100) playFanfare();
          else if (gs.shot.score > 0) (gs.shot.score >= 40 ? playCup : playDing)();
          else playUndo();
          nextTimer.current = window.setTimeout(loadNextBall, NEXT_DELAY_MS);
        }
      }

      draw(ctx, gs);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, loadNextBall]);

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
    gs.shot = { v, land, score: scoreAt(land), startedAt: performance.now() };
    gs.phase = 'rolling';
    setPhase('rolling');
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
      : phase === 'rolling'
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
