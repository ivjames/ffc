import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import {
  W,
  H,
  BALL_R,
  HOLE_R,
  MIN_SHOT,
  MAX_SHOT,
  MAX_DRAG,
  ROUGH_BAND,
  HOLES,
  stepPhysics,
  type Seg,
  type Ball,
} from './world';

// Arcade Putt — a playable mini-golf minigame. Drag from the ball to aim (the
// drag direction sets the line, its length sets power) and release to putt. The
// green is a smooth shaped surface (rounded lanes, circular greens fed by narrow
// channels); curved walls deflect the ball and blobby pits swallow a slow one
// for a penalty. Nine holes, stroke play. All client-side — works offline.
//
// Physics + geometry live in ./world (shared with the validation sim). This file
// is input, the rAF loop, and rendering.

type Phase = 'aim' | 'rolling' | 'sunk' | 'done';
type Drag = { active: boolean; sx: number; sy: number; dx: number; dy: number };
type GS = {
  ball: Ball;
  phase: Phase;
  holeIndex: number;
  strokes: number;
  drag: Drag;
};

function holeResult(strokes: number, par: number): { label: string; emoji: string } {
  const d = strokes - par;
  if (strokes === 1) return { label: 'Hole in one!', emoji: '🏌️' };
  if (d <= -2) return { label: 'Eagle', emoji: '🦅' };
  if (d === -1) return { label: 'Birdie', emoji: '🐦' };
  if (d === 0) return { label: 'Par', emoji: '⛳️' };
  if (d === 1) return { label: 'Bogey', emoji: '😬' };
  return { label: `+${d}`, emoji: '😵' };
}

function toParText(diff: number): string {
  if (diff === 0) return 'even par';
  return diff < 0 ? `${-diff} under par` : `${diff} over par`;
}

// --- drawing ----------------------------------------------------------------
// Fill the stadium (capsule) of radius s.r+extra. Filling overlapping same-color
// capsules unions them with no visible internal seams, which is how the smooth
// green / walls / pit blobs are rendered.
function fillCapsule(ctx: CanvasRenderingContext2D, s: Seg, extra: number) {
  const r = s.r + extra;
  if (r <= 0) return;
  ctx.beginPath();
  ctx.arc(s.ax, s.ay, r, 0, Math.PI * 2);
  ctx.fill();
  if (s.ax !== s.bx || s.ay !== s.by) {
    ctx.beginPath();
    ctx.arc(s.bx, s.by, r, 0, Math.PI * 2);
    ctx.fill();
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const l = Math.hypot(dx, dy);
    const px = (-dy / l) * r;
    const py = (dx / l) * r;
    ctx.beginPath();
    ctx.moveTo(s.ax + px, s.ay + py);
    ctx.lineTo(s.bx + px, s.by + py);
    ctx.lineTo(s.bx - px, s.by - py);
    ctx.lineTo(s.ax - px, s.ay - py);
    ctx.closePath();
    ctx.fill();
  }
}

// Union outline of a capsule set as a single Path2D — used to clip sand to the
// green so a bunker never spills past the rail.
function unionPath(segs: Seg[], extra: number): Path2D {
  const p = new Path2D();
  for (const s of segs) {
    const r = s.r + extra;
    if (r <= 0) continue;
    p.moveTo(s.ax + r, s.ay);
    p.arc(s.ax, s.ay, r, 0, Math.PI * 2);
    if (s.ax !== s.bx || s.ay !== s.by) {
      p.moveTo(s.bx + r, s.by);
      p.arc(s.bx, s.by, r, 0, Math.PI * 2);
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const l = Math.hypot(dx, dy);
      const px = (-dy / l) * r;
      const py = (dx / l) * r;
      p.moveTo(s.ax + px, s.ay + py);
      p.lineTo(s.bx + px, s.by + py);
      p.lineTo(s.bx - px, s.by - py);
      p.lineTo(s.ax - px, s.ay - py);
      p.closePath();
    }
  }
  return p;
}

function draw(ctx: CanvasRenderingContext2D, gs: GS) {
  const hole = HOLES[gs.holeIndex];

  // Rough (off-green).
  ctx.fillStyle = '#0a2417';
  ctx.fillRect(0, 0, W, H);

  // Green in layers: dark rim, then the rough collar (whole green), then the
  // brighter fairway inset by the collar width — leaving a fringe of rough
  // around the edge.
  ctx.fillStyle = '#0b3b22';
  for (const s of hole.green) fillCapsule(ctx, s, 5);
  ctx.fillStyle = '#2e7d46';
  for (const s of hole.green) fillCapsule(ctx, s, 0);
  ctx.fillStyle = '#18a24f';
  for (const s of hole.green) fillCapsule(ctx, s, -ROUGH_BAND);

  // Sand bunkers — clipped to the green so they never break the rail.
  if (hole.pits) {
    ctx.save();
    ctx.clip(unionPath(hole.green, 0));
    ctx.fillStyle = '#b8995c';
    for (const s of hole.pits) fillCapsule(ctx, s, 2);
    ctx.fillStyle = '#e3cd8c';
    for (const s of hole.pits) fillCapsule(ctx, s, 0);
    ctx.restore();
  }

  // Walls — raised bars/bumpers with a lighter top.
  if (hole.walls) {
    ctx.fillStyle = '#0b3b22';
    for (const s of hole.walls) fillCapsule(ctx, s, 1);
    ctx.fillStyle = '#1e6b3f';
    for (const s of hole.walls) fillCapsule(ctx, s, -3);
  }

  // Cup + flag.
  const cup = hole.cup;
  ctx.fillStyle = '#04160c';
  ctx.beginPath();
  ctx.arc(cup.x, cup.y, HOLE_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cup.x, cup.y - 2);
  ctx.lineTo(cup.x, cup.y - 34);
  ctx.stroke();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(cup.x, cup.y - 34);
  ctx.lineTo(cup.x + 16, cup.y - 29);
  ctx.lineTo(cup.x, cup.y - 24);
  ctx.closePath();
  ctx.fill();

  const b = gs.ball;

  // Aim line while dragging.
  if (gs.phase === 'aim' && gs.drag.active) {
    const { dx, dy } = gs.drag;
    const len = Math.hypot(dx, dy);
    if (len > 4) {
      const power = Math.min(len / MAX_DRAG, 1);
      const a = Math.atan2(dy, dx);
      const reach = 24 + power * 74;
      const ex = b.x + Math.cos(a) * reach;
      const ey = b.y + Math.sin(a) * reach;
      // green → red as power climbs
      const col = power < 0.5 ? '#4ade80' : power < 0.8 ? '#fbbf24' : '#ef4444';
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(a - 0.4) * 11, ey - Math.sin(a - 0.4) * 11);
      ctx.lineTo(ex - Math.cos(a + 0.4) * 11, ey - Math.sin(a + 0.4) * 11);
      ctx.closePath();
      ctx.fill();

      // Power meter.
      const mx = 14;
      const my = H - 26;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(mx, my, 120, 12);
      ctx.fillStyle = col;
      ctx.fillRect(mx, my, 120 * power, 12);
      ctx.fillStyle = '#f0fdf4';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillText(`POWER ${Math.round(power * 100)}%`, mx, my - 5);
    }
  } else if (gs.phase === 'aim') {
    // Idle hint ring around the ball — "grab me".
    ctx.strokeStyle = 'rgba(240,253,244,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R + 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ball.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export default function PuttGolf() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>({
    ball: { x: HOLES[0].tee.x, y: HOLES[0].tee.y, vx: 0, vy: 0 },
    phase: 'aim',
    holeIndex: 0,
    strokes: 0,
    drag: { active: false, sx: 0, sy: 0, dx: 0, dy: 0 },
  });

  const [phase, setPhase] = useState<Phase>('aim');
  const [holeIndex, setHoleIndex] = useState(0);
  const [strokes, setStrokes] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  const scoresRef = useRef<number[]>([]);

  const startHole = useCallback((index: number) => {
    const gs = gsRef.current;
    const hole = HOLES[index];
    gs.ball = { x: hole.tee.x, y: hole.tee.y, vx: 0, vy: 0 };
    gs.phase = 'aim';
    gs.holeIndex = index;
    gs.strokes = 0;
    gs.drag.active = false;
    setPhase('aim');
    setHoleIndex(index);
    setStrokes(0);
  }, []);

  // Render + physics loop.
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
    const frame = () => {
      const gs = gsRef.current;
      if (gs.phase === 'rolling') {
        const res = stepPhysics(gs.ball, HOLES[gs.holeIndex]);
        if (res === 'sunk') {
          gs.phase = 'sunk';
          const next = [...scoresRef.current];
          next[gs.holeIndex] = gs.strokes;
          scoresRef.current = next;
          setScores(next);
          setPhase('sunk');
        } else if (res === 'stopped') {
          gs.phase = 'aim';
          setPhase('aim');
        }
      }
      draw(ctx, gs);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Convert a pointer event to field coordinates.
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
    const { dx, dy } = gs.drag;
    gs.drag.active = false;
    const len = Math.hypot(dx, dy);
    if (len < 8) return; // deadzone tap — no stroke wasted
    const power = Math.min(len / MAX_DRAG, 1);
    const a = Math.atan2(dy, dx);
    const speed = MIN_SHOT + power * (MAX_SHOT - MIN_SHOT);
    gs.ball.vx = Math.cos(a) * speed;
    gs.ball.vy = Math.sin(a) * speed;
    gs.phase = 'rolling';
    gs.strokes += 1;
    setStrokes(gs.strokes);
    setPhase('rolling');
  }, []);

  const advance = useCallback(() => {
    const gs = gsRef.current;
    if (gs.phase === 'sunk') {
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

  const hole = HOLES[holeIndex];
  const totalStrokes = scores.reduce((a, b) => a + (b ?? 0), 0);
  const totalPar = HOLES.reduce((a, h) => a + h.par, 0);
  const result = phase === 'sunk' ? holeResult(strokes, hole.par) : null;

  const hint =
    phase === 'aim'
      ? 'Drag from the ball to aim — farther = harder — and release to putt.'
      : phase === 'rolling'
        ? 'Rolling…'
        : phase === 'sunk'
          ? `${result?.emoji} ${result?.label} — ${strokes} on par ${hole.par}`
          : '';

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
              {hint}
            </p>

            <div className="space-y-2">
              {phase === 'sunk' && (
                <Button onClick={advance}>
                  {holeIndex + 1 >= HOLES.length ? 'See scorecard →' : 'Next hole →'}
                </Button>
              )}
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
                    className="flex items-center justify-between border-b border-fairway-800/60 bg-fairway-900/40 px-4 py-2.5 last:border-0"
                  >
                    <span className="w-16 font-bold text-fairway-100">Hole {i + 1}</span>
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
              <Button onClick={advance}>Play again</Button>
            </div>
          </div>
        )}
      </Content>
    </Screen>
  );
}
