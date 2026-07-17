import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';

// Arcade Putt — a tiny playable mini-golf minigame (the real thing, not code
// golf). Two taps per shot: lock the sweeping aim arrow, then tap again to fire
// on the oscillating power meter. The ball rolls with friction, bounces off the
// rails and obstacles, and drops if it reaches the cup slowly enough. Count the
// strokes across a short course. Entirely client-side — no API, works offline.

// --- playfield geometry (fixed internal resolution, scaled to fit) ----------
const W = 360;
const H = 540;
const MARGIN = 16; // rail inset
const BALL_R = 8;
const HOLE_R = 13;

// --- physics tuning ---------------------------------------------------------
const FRICTION = 0.985; // per-frame velocity retention on the green
const WALL_REST = 0.68; // energy kept on a bounce
const STOP_SPEED = 0.16; // below this the ball is "at rest"
const MIN_SHOT = 3.2; // px/frame at 0% power
const MAX_SHOT = 14.5; // px/frame at 100% power
const CAPTURE_SPEED = 5.8; // fast balls lip out instead of dropping

// --- sweep speeds (radians / ms and cycles) ---------------------------------
const AIM_SPEED = 0.0016; // full rotation ≈ 3.9s
const POWER_SPEED = 0.005; // power cycle ≈ 1.3s
const START_ANGLE = -Math.PI / 2; // aim begins pointing up the green

type Rect = { x: number; y: number; w: number; h: number };
type Hole = {
  par: number;
  tee: { x: number; y: number };
  cup: { x: number; y: number };
  walls: Rect[];
};

const HOLES: Hole[] = [
  {
    par: 2,
    tee: { x: 180, y: 470 },
    cup: { x: 180, y: 90 },
    walls: [],
  },
  {
    par: 3,
    tee: { x: 90, y: 470 },
    cup: { x: 270, y: 110 },
    walls: [{ x: 40, y: 260, w: 210, h: 22 }],
  },
  {
    par: 3,
    tee: { x: 180, y: 480 },
    cup: { x: 290, y: 120 },
    walls: [
      { x: 60, y: 340, w: 160, h: 22 },
      { x: 180, y: 190, w: 140, h: 22 },
    ],
  },
];

type Phase = 'aim' | 'power' | 'rolling' | 'sunk' | 'done';

type Ball = { x: number; y: number; vx: number; vy: number };
type GS = {
  ball: Ball;
  aim: number; // radians (drawn each frame)
  power: number; // 0..1 (drawn each frame)
  phase: Phase;
  holeIndex: number;
  strokes: number;
  tAim: number; // ms timestamp the aim sweep started
  tPower: number; // ms timestamp the power sweep started
  now: number;
};

function toParText(diff: number): string {
  if (diff === 0) return 'even par';
  return diff < 0 ? `${-diff} under` : `${diff} over`;
}

function holeResult(strokes: number, par: number): { label: string; emoji: string } {
  const d = strokes - par;
  if (strokes === 1) return { label: 'Hole in one!', emoji: '🏌️' };
  if (d <= -2) return { label: 'Eagle', emoji: '🦅' };
  if (d === -1) return { label: 'Birdie', emoji: '🐦' };
  if (d === 0) return { label: 'Par', emoji: '⛳️' };
  if (d === 1) return { label: 'Bogey', emoji: '😬' };
  return { label: `+${d}`, emoji: '😵' };
}

// Circle-vs-axis-aligned-rectangle collision: push the ball out of the rail and
// reflect its velocity along the contact normal.
function collideRect(b: Ball, r: Rect) {
  const nx = Math.max(r.x, Math.min(b.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(b.y, r.y + r.h));
  const dx = b.x - nx;
  const dy = b.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 > BALL_R * BALL_R) return;

  if (d2 === 0) {
    // Center is inside the rect — eject along the shallowest side.
    const left = b.x - r.x;
    const right = r.x + r.w - b.x;
    const top = b.y - r.y;
    const bottom = r.y + r.h - b.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) {
      b.x = r.x - BALL_R;
      b.vx = -Math.abs(b.vx) * WALL_REST;
    } else if (m === right) {
      b.x = r.x + r.w + BALL_R;
      b.vx = Math.abs(b.vx) * WALL_REST;
    } else if (m === top) {
      b.y = r.y - BALL_R;
      b.vy = -Math.abs(b.vy) * WALL_REST;
    } else {
      b.y = r.y + r.h + BALL_R;
      b.vy = Math.abs(b.vy) * WALL_REST;
    }
    return;
  }

  const d = Math.sqrt(d2);
  const ux = dx / d;
  const uy = dy / d;
  b.x += ux * (BALL_R - d);
  b.y += uy * (BALL_R - d);
  const vdot = b.vx * ux + b.vy * uy;
  b.vx = (b.vx - 2 * vdot * ux) * WALL_REST;
  b.vy = (b.vy - 2 * vdot * uy) * WALL_REST;
}

// Advance the ball one frame. Sub-steps keep a fast ball from tunnelling
// through a thin rail. Returns the outcome for this frame.
function stepPhysics(b: Ball, hole: Hole): 'rolling' | 'stopped' | 'sunk' {
  const speed = Math.hypot(b.vx, b.vy);
  const steps = Math.max(1, Math.ceil(speed / (BALL_R * 0.5)));
  for (let i = 0; i < steps; i++) {
    b.x += b.vx / steps;
    b.y += b.vy / steps;

    // Rails.
    if (b.x < MARGIN + BALL_R) {
      b.x = MARGIN + BALL_R;
      b.vx = -b.vx * WALL_REST;
    } else if (b.x > W - MARGIN - BALL_R) {
      b.x = W - MARGIN - BALL_R;
      b.vx = -b.vx * WALL_REST;
    }
    if (b.y < MARGIN + BALL_R) {
      b.y = MARGIN + BALL_R;
      b.vy = -b.vy * WALL_REST;
    } else if (b.y > H - MARGIN - BALL_R) {
      b.y = H - MARGIN - BALL_R;
      b.vy = -b.vy * WALL_REST;
    }

    for (const r of hole.walls) collideRect(b, r);

    // Cup: a slow ball near the center drops; near-misses get a gentle nudge
    // toward the hole so a good lag putt curls in satisfyingly.
    const dx = hole.cup.x - b.x;
    const dy = hole.cup.y - b.y;
    const d = Math.hypot(dx, dy);
    const s = Math.hypot(b.vx, b.vy);
    if (d < HOLE_R && s < CAPTURE_SPEED) {
      b.x = hole.cup.x;
      b.y = hole.cup.y;
      b.vx = 0;
      b.vy = 0;
      return 'sunk';
    }
    if (d < HOLE_R * 2 && s < CAPTURE_SPEED) {
      b.vx += (dx / d) * 0.22;
      b.vy += (dy / d) * 0.22;
    }
  }

  b.vx *= FRICTION;
  b.vy *= FRICTION;
  if (Math.hypot(b.vx, b.vy) < STOP_SPEED) {
    b.vx = 0;
    b.vy = 0;
    return 'stopped';
  }
  return 'rolling';
}

// --- drawing ----------------------------------------------------------------
function draw(ctx: CanvasRenderingContext2D, gs: GS, hole: Hole) {
  ctx.clearRect(0, 0, W, H);

  // Green with mowed stripes.
  ctx.fillStyle = '#14532d';
  roundRect(ctx, MARGIN, MARGIN, W - 2 * MARGIN, H - 2 * MARGIN, 14);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let y = MARGIN; y < H - MARGIN; y += 44) {
    if (((y - MARGIN) / 44) % 2 === 0) ctx.fillRect(MARGIN, y, W - 2 * MARGIN, 22);
  }
  ctx.restore();

  // Rail.
  ctx.strokeStyle = '#0b3b22';
  ctx.lineWidth = 3;
  roundRect(ctx, MARGIN, MARGIN, W - 2 * MARGIN, H - 2 * MARGIN, 14);
  ctx.stroke();

  // Obstacles.
  for (const r of hole.walls) {
    ctx.fillStyle = '#0b3b22';
    roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Cup + flag.
  ctx.fillStyle = '#04160c';
  ctx.beginPath();
  ctx.arc(hole.cup.x, hole.cup.y, HOLE_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hole.cup.x, hole.cup.y - 2);
  ctx.lineTo(hole.cup.x, hole.cup.y - 34);
  ctx.stroke();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(hole.cup.x, hole.cup.y - 34);
  ctx.lineTo(hole.cup.x + 16, hole.cup.y - 29);
  ctx.lineTo(hole.cup.x, hole.cup.y - 24);
  ctx.closePath();
  ctx.fill();

  // Aim line while aiming or setting power.
  if (gs.phase === 'aim' || gs.phase === 'power') {
    const len = 34 + (gs.phase === 'power' ? gs.power * 46 : 24);
    const ex = gs.ball.x + Math.cos(gs.aim) * len;
    const ey = gs.ball.y + Math.sin(gs.aim) * len;
    ctx.strokeStyle = gs.phase === 'power' ? '#fbbf24' : 'rgba(240,253,244,0.85)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(gs.ball.x, gs.ball.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead.
    const a = gs.aim;
    ctx.fillStyle = gs.phase === 'power' ? '#fbbf24' : '#f0fdf4';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(a - 0.4) * 10, ey - Math.sin(a - 0.4) * 10);
    ctx.lineTo(ex - Math.cos(a + 0.4) * 10, ey - Math.sin(a + 0.4) * 10);
    ctx.closePath();
    ctx.fill();
  }

  // Ball.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(gs.ball.x, gs.ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Power meter (bottom-left) during the power phase.
  if (gs.phase === 'power') {
    const mx = MARGIN + 10;
    const my = H - MARGIN - 22;
    const mw = 120;
    const mh = 12;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(ctx, mx, my, mw, mh, 6);
    ctx.fill();
    const grad = ctx.createLinearGradient(mx, 0, mx + mw, 0);
    grad.addColorStop(0, '#4ade80');
    grad.addColorStop(0.6, '#fbbf24');
    grad.addColorStop(1, '#ef4444');
    ctx.fillStyle = grad;
    roundRect(ctx, mx, my, mw * gs.power, mh, 6);
    ctx.fill();
    ctx.fillStyle = '#f0fdf4';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillText('POWER', mx, my - 5);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function PuttGolf() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>({
    ball: { x: HOLES[0].tee.x, y: HOLES[0].tee.y, vx: 0, vy: 0 },
    aim: START_ANGLE,
    power: 0,
    phase: 'aim',
    holeIndex: 0,
    strokes: 0,
    tAim: 0,
    tPower: 0,
    now: 0,
  });
  const scoresRef = useRef<number[]>([]);

  // React state mirrors only what the UI chrome needs (labels update rarely).
  const [phase, setPhase] = useState<Phase>('aim');
  const [holeIndex, setHoleIndex] = useState(0);
  const [strokes, setStrokes] = useState(0);
  const [scores, setScores] = useState<number[]>([]);

  const startHole = useCallback((index: number) => {
    const gs = gsRef.current;
    const hole = HOLES[index];
    gs.ball = { x: hole.tee.x, y: hole.tee.y, vx: 0, vy: 0 };
    gs.aim = START_ANGLE;
    gs.power = 0;
    gs.phase = 'aim';
    gs.holeIndex = index;
    gs.strokes = 0;
    gs.tAim = performance.now();
    setPhase('aim');
    setHoleIndex(index);
    setStrokes(0);
  }, []);

  // Single rAF loop. Behavior is driven by gs.phase (in the ref), so the loop
  // is created once and never needs re-binding.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    let raf = 0;
    const frame = (ts: number) => {
      const gs = gsRef.current;
      gs.now = ts;
      const hole = HOLES[gs.holeIndex];

      if (gs.phase === 'aim') {
        gs.aim = START_ANGLE + (ts - gs.tAim) * AIM_SPEED;
      } else if (gs.phase === 'power') {
        gs.power = (Math.sin((ts - gs.tPower) * POWER_SPEED) + 1) / 2;
      } else if (gs.phase === 'rolling') {
        const res = stepPhysics(gs.ball, hole);
        if (res === 'sunk') {
          gs.phase = 'sunk';
          const next = [...scoresRef.current];
          next[gs.holeIndex] = gs.strokes;
          scoresRef.current = next;
          setScores(next);
          setPhase('sunk');
        } else if (res === 'stopped') {
          gs.phase = 'aim';
          gs.tAim = ts;
          setPhase('aim');
        }
      }

      draw(ctx, gs, hole);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onAction = useCallback(() => {
    const gs = gsRef.current;
    if (gs.phase === 'aim') {
      gs.phase = 'power';
      gs.power = 0;
      gs.tPower = performance.now();
      setPhase('power');
    } else if (gs.phase === 'power') {
      const speed = MIN_SHOT + gs.power * (MAX_SHOT - MIN_SHOT);
      gs.ball.vx = Math.cos(gs.aim) * speed;
      gs.ball.vy = Math.sin(gs.aim) * speed;
      gs.phase = 'rolling';
      gs.strokes += 1;
      setStrokes(gs.strokes);
      setPhase('rolling');
    } else if (gs.phase === 'sunk') {
      if (gs.holeIndex + 1 >= HOLES.length) {
        gs.phase = 'done';
        setPhase('done');
      } else {
        startHole(gs.holeIndex + 1);
      }
    } else if (gs.phase === 'done') {
      scoresRef.current = [];
      setScores([]);
      startHole(0);
    }
  }, [startHole]);

  const resetHole = useCallback(() => startHole(gsRef.current.holeIndex), [startHole]);

  // Keyboard + tap-canvas shortcuts for the primary action.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onAction();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAction]);

  const hole = HOLES[holeIndex];
  const totalStrokes = scores.reduce((a, b) => a + (b ?? 0), 0);
  const totalPar = HOLES.reduce((a, h) => a + h.par, 0);
  const result = phase === 'sunk' ? holeResult(strokes, hole.par) : null;

  const actionLabel =
    phase === 'aim'
      ? 'Lock aim →'
      : phase === 'power'
        ? 'Shoot! 🏌️'
        : phase === 'rolling'
          ? '…'
          : phase === 'sunk'
            ? holeIndex + 1 >= HOLES.length
              ? 'See scorecard →'
              : 'Next hole →'
            : 'Play again';

  const hint =
    phase === 'aim'
      ? 'Tap when the arrow points where you want.'
      : phase === 'power'
        ? 'Tap to shoot — the meter sets your power.'
        : phase === 'rolling'
          ? 'Rolling…'
          : phase === 'sunk'
            ? `${result?.emoji} ${result?.label}`
            : 'Nice round.';

  return (
    <Screen>
      <TopBar title="Arcade Putt" back="/" />
      <Content>
        {phase !== 'done' ? (
          <>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-bold text-fairway-50">
                Hole {holeIndex + 1}
                <span className="font-normal text-fairway-400"> / {HOLES.length}</span>
              </span>
              <span className="text-fairway-300">
                Par <span className="font-bold text-fairway-100">{hole.par}</span>
                <span className="mx-2 text-fairway-700">·</span>
                Strokes <span className="font-bold text-fairway-100">{strokes}</span>
              </span>
            </div>

            <button
              type="button"
              onClick={onAction}
              disabled={phase === 'rolling'}
              className="block w-full overflow-hidden rounded-2xl border border-fairway-800"
              aria-label="Tap to lock aim, then tap to shoot"
            >
              <canvas
                ref={canvasRef}
                className="block w-full"
                style={{ aspectRatio: `${W} / ${H}`, touchAction: 'manipulation' }}
              />
            </button>

            <p className="mt-3 text-center text-sm text-fairway-100/80">{hint}</p>

            <div className="mt-3 space-y-2">
              <Button onClick={onAction} disabled={phase === 'rolling'}>
                {actionLabel}
              </Button>
              {phase !== 'sunk' && (
                <Button variant="ghost" onClick={resetHole} disabled={phase === 'rolling'}>
                  Reset hole
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="mt-4">
            <div className="mb-4 text-center">
              <div className="text-5xl">🏆</div>
              <h2 className="mt-2 text-2xl font-black text-fairway-50">Round complete</h2>
              <p className="mt-1 text-fairway-100/70">
                {totalStrokes} strokes · {toParText(totalStrokes - totalPar)}
              </p>
            </div>

            <div className="overflow-hidden rounded-2xl border border-fairway-800">
              {HOLES.map((h, i) => {
                const r = holeResult(scores[i] ?? 0, h.par);
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between border-b border-fairway-800/60 bg-fairway-900/40 px-4 py-3 last:border-0"
                  >
                    <span className="font-bold text-fairway-100">Hole {i + 1}</span>
                    <span className="text-sm text-fairway-400">par {h.par}</span>
                    <span className="font-mono font-bold text-fairway-50">{scores[i] ?? '—'}</span>
                    <span className="w-24 text-right text-sm text-fairway-300">
                      {r.emoji} {r.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <Button onClick={onAction}>Play again</Button>
            </div>
          </div>
        )}
      </Content>
    </Screen>
  );
}
