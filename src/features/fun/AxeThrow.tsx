import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playStroke, playCup, playUndo, playFanfare } from '../../lib/sound';

// §12 Axe Throwing — the fourth attraction mini-game. A two-tap timing game:
// a vertical guide sweeps left↔right (tap to set your aim), then a horizontal
// guide sweeps up↕down (tap to set height), and the axe flies and sticks where
// the lines cross. Five throws; hit the bullseye for 5 or thread a corner clutch
// for 7. Pure timing skill, canvas-rendered, client-side, offline.

// —— Target + geometry (logical units; the canvas scales to fit) ——————————————
const W = 340;
const H = 560;
const CENTER = { x: W / 2, y: 220 };

// Concentric rings (outer radius → points → fill).
const RINGS: Array<{ r: number; pts: number; fill: string }> = [
  { r: 150, pts: 1, fill: '#3f2d1a' },
  { r: 116, pts: 2, fill: '#6b4a24' },
  { r: 84, pts: 3, fill: '#1e3a5f' },
  { r: 54, pts: 4, fill: '#2563eb' },
  { r: 26, pts: 5, fill: '#dc2626' },
];
// Corner "clutch" dots — small, high value.
const CLUTCH = [
  { x: CENTER.x - 100, y: CENTER.y - 100 },
  { x: CENTER.x + 100, y: CENTER.y - 100 },
];
const CLUTCH_R = 15;
const CLUTCH_PTS = 7;

// Sweep ranges cover the whole target so every ring + both clutches are reachable.
const SWEEP_X0 = 22;
const SWEEP_X1 = W - 22;
const SWEEP_Y0 = 74;
const SWEEP_Y1 = 366;
const SWEEP_X_MS = 1300;
const SWEEP_Y_MS = 1100;

const THROWS = 5;
const FLIGHT_MS = 480;
const NEXT_DELAY_MS = 800;

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** Triangle wave 0→1→0 over `period` ms, for a guide that sweeps and returns. */
function triWave(now: number, period: number): number {
  const u = (now % period) / period;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

function scoreAt(x: number, y: number): number {
  for (const c of CLUTCH) if (dist(x, y, c.x, c.y) <= CLUTCH_R) return CLUTCH_PTS;
  const d = dist(x, y, CENTER.x, CENTER.y);
  for (const ring of RINGS) if (d <= ring.r) return ring.pts;
  return 0;
}

type Phase = 'aimX' | 'aimY' | 'flying' | 'scored' | 'done';
type Mark = { x: number; y: number };
type GS = {
  phase: Phase;
  throwNo: number; // 0-based
  total: number;
  lockX: number;
  land: { x: number; y: number } | null;
  score: number;
  flyStart: number;
  scoreAtTs: number; // when the current result was locked in
  marks: Mark[];
  sweepBase: number; // now-offset so each sweep starts at its left/top
};

function freshGS(now: number): GS {
  return {
    phase: 'aimX',
    throwNo: 0,
    total: 0,
    lockX: CENTER.x,
    land: null,
    score: 0,
    flyStart: 0,
    scoreAtTs: 0,
    marks: [],
    sweepBase: now,
  };
}

// —— drawing —————————————————————————————————————————————————————————————————
function drawAxe(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  // Handle.
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(-2.5, -6, 5, 26);
  // Head.
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(-2, -10);
  ctx.lineTo(12, -14);
  ctx.lineTo(12, -1);
  ctx.lineTo(-2, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, now: number) {
  ctx.clearRect(0, 0, W, H);
  // Backdrop.
  ctx.fillStyle = '#0e1626';
  ctx.fillRect(0, 0, W, H);

  // Wood board behind the target.
  ctx.fillStyle = '#3a2a18';
  ctx.fillRect(28, 60, W - 56, 320);
  ctx.strokeStyle = '#241a10';
  ctx.lineWidth = 4;
  ctx.strokeRect(28, 60, W - 56, 320);

  // Rings.
  for (const ring of RINGS) {
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, ring.r, 0, Math.PI * 2);
    ctx.fillStyle = ring.fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Clutch dots.
  for (const c of CLUTCH) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, CLUTCH_R, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Previous throws stuck in the board.
  for (const m of gs.marks) drawAxe(ctx, m.x, m.y, -0.35, 0.8);

  // Aiming guides.
  if (gs.phase === 'aimX') {
    const x = SWEEP_X0 + (SWEEP_X1 - SWEEP_X0) * triWave(now - gs.sweepBase, SWEEP_X_MS);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(x, 60);
    ctx.lineTo(x, 380);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (gs.phase === 'aimY') {
    const y = SWEEP_Y0 + (SWEEP_Y1 - SWEEP_Y0) * triWave(now - gs.sweepBase, SWEEP_Y_MS);
    // Locked vertical + sweeping horizontal; their crossing is the target point.
    ctx.strokeStyle = 'rgba(251,191,36,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gs.lockX, 60);
    ctx.lineTo(gs.lockX, 380);
    ctx.stroke();
    ctx.strokeStyle = '#fbbf24';
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(28, y);
    ctx.lineTo(W - 28, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(gs.lockX, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
  }

  // Flying axe (spins from the thrower to the landing point).
  if (gs.phase === 'flying' && gs.land) {
    const p = Math.min((now - gs.flyStart) / FLIGHT_MS, 1);
    const sx = W / 2;
    const sy = H - 24;
    const x = sx + (gs.land.x - sx) * p;
    const y = sy + (gs.land.y - sy) * p;
    drawAxe(ctx, x, y, p * Math.PI * 6);
  }
  // Stuck result + floating points.
  if (gs.phase === 'scored' && gs.land) {
    drawAxe(ctx, gs.land.x, gs.land.y, -0.35);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = gs.score >= 7 ? '#4ade80' : gs.score > 0 ? '#fbbf24' : '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText(gs.score > 0 ? `+${gs.score}` : 'MISS', gs.land.x, gs.land.y - 22);
  }

  // Thrower's axe at the ready.
  if (gs.phase === 'aimX' || gs.phase === 'aimY') drawAxe(ctx, W / 2, H - 24, 0);
}

export default function AxeThrow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS(0));
  const nextTimer = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('aimX');
  const [throwNo, setThrowNo] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastScore, setLastScore] = useState<number | null>(null);

  const playing = phase !== 'done';

  const loadNext = useCallback((now: number) => {
    const gs = gsRef.current;
    if (gs.throwNo + 1 >= THROWS) {
      gs.phase = 'done';
      setPhase('done');
      playFanfare();
      return;
    }
    gs.throwNo += 1;
    gs.phase = 'aimX';
    gs.land = null;
    gs.sweepBase = now;
    setThrowNo(gs.throwNo);
    setPhase('aimX');
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
    let sweepPausedAt = 0;
    const frame = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        // Freeze the sweeps while backgrounded by advancing their base.
        if (!sweepPausedAt) sweepPausedAt = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      if (sweepPausedAt) {
        gs.sweepBase += now - sweepPausedAt;
        sweepPausedAt = 0;
      }

      if (gs.phase === 'flying' && gs.land && now - gs.flyStart >= FLIGHT_MS) {
        gs.total += gs.score;
        gs.marks = [...gs.marks, { x: gs.land.x, y: gs.land.y }];
        gs.phase = 'scored';
        gs.scoreAtTs = now;
        setTotal(gs.total);
        setLastScore(gs.score);
        setPhase('scored');
        if (gs.score >= 7) playFanfare();
        else if (gs.score > 0) playCup();
        else playUndo();
        nextTimer.current = window.setTimeout(() => loadNext(performance.now()), NEXT_DELAY_MS);
      }

      draw(ctx, gs, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, loadNext]);

  useEffect(() => {
    return () => {
      if (nextTimer.current) clearTimeout(nextTimer.current);
    };
  }, []);

  const onTap = useCallback(() => {
    const gs = gsRef.current;
    const now = performance.now();
    if (gs.phase === 'aimX') {
      gs.lockX = SWEEP_X0 + (SWEEP_X1 - SWEEP_X0) * triWave(now - gs.sweepBase, SWEEP_X_MS);
      gs.phase = 'aimY';
      gs.sweepBase = now;
      setPhase('aimY');
      playStroke();
    } else if (gs.phase === 'aimY') {
      const y = SWEEP_Y0 + (SWEEP_Y1 - SWEEP_Y0) * triWave(now - gs.sweepBase, SWEEP_Y_MS);
      gs.land = { x: gs.lockX, y };
      gs.score = scoreAt(gs.lockX, y);
      gs.phase = 'flying';
      gs.flyStart = now;
      setPhase('flying');
      playStroke();
    }
  }, []);

  const restart = useCallback(() => {
    if (nextTimer.current) clearTimeout(nextTimer.current);
    gsRef.current = freshGS(performance.now());
    setPhase('aimX');
    setThrowNo(0);
    setTotal(0);
    setLastScore(null);
  }, []);

  if (phase === 'done') {
    const remark =
      total >= 28 ? 'Lumberjack legend! 🪓' : total >= 20 ? 'Sharp shooter! 🎯' : total >= 12 ? 'Nice sticks! 👍' : 'Keep throwing! 🎮';
    return (
      <Screen>
        <TopBar title="Axe Throwing" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🪓</span>
            <div className="text-5xl font-black text-fairway-50">{total}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">across {THROWS} throws</p>
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
    phase === 'aimX'
      ? 'Tap to set your aim (left–right).'
      : phase === 'aimY'
        ? 'Tap to set the height (up–down).'
        : phase === 'flying'
          ? 'Thunk!'
          : lastScore && lastScore > 0
            ? `Stuck for +${lastScore}!`
            : 'Missed the board!';

  return (
    <Screen>
      <TopBar title="Axe Throwing" back="/fun" />
      <Content>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-fairway-50">
            Throw <span className="text-fairway-100">{Math.min(throwNo + 1, THROWS)}</span>
            <span className="font-normal text-fairway-400"> / {THROWS}</span>
          </span>
          <span className="text-fairway-300">
            Score <span className="font-bold text-fairway-100">{total}</span>
          </span>
        </div>

        <canvas
          ref={canvasRef}
          onPointerDown={onTap}
          className="block w-full touch-none rounded-2xl border border-fairway-800"
          style={{ aspectRatio: `${W} / ${H}` }}
        />

        <p className="mt-3 min-h-[2.5rem] text-center text-sm text-fairway-100/80">{hint}</p>
      </Content>
    </Screen>
  );
}
