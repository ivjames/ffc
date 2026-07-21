import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useFitCanvas } from './useFitCanvas';
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
  // RINGS is ordered outer→inner, so scan from the innermost (highest value)
  // outward and take the first ring the point falls inside.
  for (let i = RINGS.length - 1; i >= 0; i--) if (d <= RINGS[i].r) return RINGS[i].pts;
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

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the timing sim is never touched; they're advanced per
// animation frame with a real dt and only ever paint pixels. Built on the shared
// ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent flying-axe positions → spinning motion streak
  particles: Particle[]; // wood-chip / spark bursts on release + stick
  shake: number; // impact shake magnitude (px), decays to 0
  flash: number; // bullseye flash 0..1, decays to 0
  flashColor: string;
};

function freshFX(): FX {
  return { trail: [], particles: [], shake: 0, flash: 0, flashColor: '#fbbf24' };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, dt: number) {
  fx.particles = stepParticles(fx.particles, dt, 0.02, 220); // gravity so chips fall
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
function drawAxe(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  // Wooden handle — lengthwise grain gradient.
  const hg = ctx.createLinearGradient(-2.5, 0, 2.5, 0);
  hg.addColorStop(0, '#4a2f18');
  hg.addColorStop(0.45, '#a06a34');
  hg.addColorStop(0.6, '#8b5a2b');
  hg.addColorStop(1, '#3d2713');
  ctx.fillStyle = hg;
  ctx.fillRect(-2.5, -6, 5, 26);
  // Steel head — lit metal gradient (bright bevel → shadowed body).
  const mg = ctx.createLinearGradient(-2, -14, 12, -1);
  mg.addColorStop(0, '#f1f5f9');
  mg.addColorStop(0.5, '#cbd5e1');
  mg.addColorStop(1, '#64748b');
  ctx.beginPath();
  ctx.moveTo(-2, -10);
  ctx.lineTo(12, -14);
  ctx.lineTo(12, -1);
  ctx.lineTo(-2, -4);
  ctx.closePath();
  ctx.fillStyle = mg;
  ctx.fill();
  // Specular glint along the cutting edge.
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(11.4, -13);
  ctx.lineTo(11.4, -1.6);
  ctx.stroke();
  ctx.restore();
}

// The area-centroid of the steel head polygon in drawAxe's local coords. drawAxe
// pins its origin (0,0) — the neck between handle and head — so calling it with
// the landing point sticks the axe by the *whole graphic's* middle, biasing the
// head off-target. Anchoring the head's own center puts the blade the player
// reads as "the axe" onto the target. (Pinning the far cutting edge instead
// throws the head high-and-left, since the head extends up-left of that edge.)
const AXE_HEAD = { x: 5.86, y: -7.28 };

/** Draw an axe so its blade head (not its origin) is centered on (hx, hy). */
function drawAxeStuck(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  angle: number,
  scale = 1,
) {
  // Rotate + scale the head-center offset, then place the origin so the head
  // lands on (hx,hy).
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ox = (AXE_HEAD.x * c - AXE_HEAD.y * s) * scale;
  const oy = (AXE_HEAD.x * s + AXE_HEAD.y * c) * scale;
  drawAxe(ctx, hx - ox, hy - oy, angle, scale);
}

/** The wooden board + concentric scoring rings + glossy bullseye, top-lit. */
function drawBoard(ctx: CanvasRenderingContext2D) {
  const bx = 28;
  const by = 60;
  const bw = W - 56;
  const bh = 320;

  // Soft contact shadow so the board floats off the back wall.
  drawShadow(ctx, CENTER.x, by + bh + 6, bw * 0.5, 20, 0.4);

  // Wooden plank — radial grain darkening toward the edges.
  ctx.save();
  roundRectPath(ctx, bx, by, bw, bh, 12);
  ctx.clip();
  const wood = ctx.createRadialGradient(CENTER.x, CENTER.y - 20, 20, CENTER.x, CENTER.y, 230);
  wood.addColorStop(0, '#5a3f22');
  wood.addColorStop(0.6, '#3f2c17');
  wood.addColorStop(1, '#241910');
  ctx.fillStyle = wood;
  ctx.fillRect(bx, by, bw, bh);
  // Faint vertical grain lines.
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 1;
  for (let gx = bx + 10; gx < bx + bw; gx += 16) {
    ctx.beginPath();
    ctx.moveTo(gx, by);
    ctx.lineTo(gx + 4, by + bh);
    ctx.stroke();
  }
  ctx.restore();

  // Beveled frame.
  ctx.strokeStyle = 'rgba(20,13,7,0.9)';
  ctx.lineWidth = 5;
  roundRectPath(ctx, bx, by, bw, bh, 12);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(180,130,70,0.25)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, bx + 2, by + 2, bw - 4, bh - 4, 10);
  ctx.stroke();

  // Scoring discs — outer→inner (each covers the previous), lit top-left.
  for (const ring of RINGS) {
    const g = ctx.createRadialGradient(
      CENTER.x - ring.r * 0.35,
      CENTER.y - ring.r * 0.4,
      ring.r * 0.1,
      CENTER.x,
      CENTER.y,
      ring.r,
    );
    g.addColorStop(0, withAlpha('#ffffff', 0.22));
    g.addColorStop(0.18, ring.fill);
    g.addColorStop(1, withAlpha('#000000', 0.28));
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, ring.r, 0, TWO_PI);
    ctx.fillStyle = ring.fill;
    ctx.fill();
    ctx.fillStyle = g;
    ctx.fill();
  }
  // Ring boundaries — soft amber-lit strokes.
  ctx.save();
  ctx.shadowColor = 'rgba(251,191,36,0.5)';
  for (const ring of RINGS) {
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, ring.r, 0, TWO_PI);
    ctx.strokeStyle = 'rgba(255,240,210,0.35)';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 5;
    ctx.stroke();
  }
  ctx.restore();

  // Glossy bullseye highlight.
  ctx.beginPath();
  ctx.arc(CENTER.x - 7, CENTER.y - 8, 6, 0, TWO_PI);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fill();

  // Corner clutch dots — lit green spheres.
  for (const c of CLUTCH) {
    drawShadow(ctx, c.x, c.y + 3, CLUTCH_R * 0.9, CLUTCH_R * 0.5, 0.35);
    drawSphere(ctx, c.x, c.y, CLUTCH_R, '#bbf7d0', '#22c55e', '#14532d', { rim: true });
  }
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);

  // —— Throwing-range backdrop: dim gradient + warm radial sheen + vignette ——
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#141d2f');
  bg.addColorStop(0.5, '#0e1626');
  bg.addColorStop(1, '#080d18');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const sheen = ctx.createRadialGradient(W / 2, CENTER.y, 20, W / 2, CENTER.y, H * 0.6);
  sheen.addColorStop(0, 'rgba(234,179,8,0.12)');
  sheen.addColorStop(1, 'rgba(234,179,8,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // —— The target (static) ——
  drawBoard(ctx);

  // —— Dynamic layer (shaken on impact) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Spinning motion trail behind the flying axe.
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 2 + k * 5, 0, TWO_PI);
    ctx.fillStyle = `rgba(251,191,36,${0.03 + k * 0.16})`;
    ctx.fill();
  }

  // Previous throws stuck in the board.
  for (const m of gs.marks) drawAxeStuck(ctx, m.x, m.y, -0.35, 0.8);

  // Aiming guides — glowing amber sweep lines.
  if (gs.phase === 'aimX') {
    const x = SWEEP_X0 + (SWEEP_X1 - SWEEP_X0) * triWave(now - gs.sweepBase, SWEEP_X_MS);
    neonLine(ctx, x, 60, x, 380, '#fbbf24', 2.5, 12);
  } else if (gs.phase === 'aimY') {
    const y = SWEEP_Y0 + (SWEEP_Y1 - SWEEP_Y0) * triWave(now - gs.sweepBase, SWEEP_Y_MS);
    // Locked vertical + sweeping horizontal; their crossing is the target point.
    ctx.save();
    ctx.strokeStyle = 'rgba(251,191,36,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gs.lockX, 60);
    ctx.lineTo(gs.lockX, 380);
    ctx.stroke();
    ctx.restore();
    neonLine(ctx, 28, y, W - 28, y, '#fbbf24', 2.5, 12);
    ctx.save();
    ctx.beginPath();
    ctx.arc(gs.lockX, y, 5, 0, TWO_PI);
    ctx.fillStyle = '#fde68a';
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.restore();
  }

  // Flying axe (spins from the thrower to the landing point).
  if (gs.phase === 'flying' && gs.land) {
    const p = Math.min((now - gs.flyStart) / FLIGHT_MS, 1);
    const sx = W / 2;
    const sy = H - 24;
    const x = sx + (gs.land.x - sx) * p;
    const y = sy + (gs.land.y - sy) * p;
    drawAxeStuck(ctx, x, y, p * Math.PI * 6);
  }
  // Stuck result + floating points.
  if (gs.phase === 'scored' && gs.land) {
    drawAxeStuck(ctx, gs.land.x, gs.land.y, -0.35);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.shadowBlur = 12;
    if (gs.score >= 5) {
      const big = gs.score >= 7;
      const label = big ? 'CLUTCH!' : 'BULLSEYE!';
      const col = big ? '#4ade80' : '#fbbf24';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.fillText(label, gs.land.x, gs.land.y - 40);
    }
    ctx.font = 'bold 22px system-ui, sans-serif';
    const sc = gs.score >= 7 ? '#4ade80' : gs.score > 0 ? '#fde68a' : '#94a3b8';
    ctx.fillStyle = sc;
    ctx.shadowColor = sc;
    ctx.fillText(gs.score > 0 ? `+${gs.score}` : 'MISS', gs.land.x, gs.land.y - 20);
    ctx.restore();
  }

  // Thrower's axe at the ready.
  if (gs.phase === 'aimX' || gs.phase === 'aimY') drawAxe(ctx, W / 2, H - 24, 0);

  // Additive spark / chip particles.
  drawParticles(ctx, fx.particles);
  ctx.restore();

  // —— Bullseye flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }
}

export default function AxeThrow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS(0));
  const fxRef = useRef<FX>(freshFX());
  // Last-rendered guide position (the sweep values actually painted this frame).
  // onTap reads these so the axe lands on the crosshair the player saw, closing
  // the sub-frame gap between the draw clock and a fresh clock read at tap time.
  const guideRef = useRef({ x: SWEEP_X0, y: SWEEP_Y0 });
  const nextTimer = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>('aimX');
  const [throwNo, setThrowNo] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastScore, setLastScore] = useState<number | null>(null);

  const playing = phase !== 'done';
  useFitCanvas(canvasRef, W, H, playing);

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
    let last = performance.now();
    const frame = (now: number) => {
      const gs = gsRef.current;
      const fx = fxRef.current;
      if (document.hidden) {
        // Freeze the sweeps while backgrounded by advancing their base.
        if (!sweepPausedAt) sweepPausedAt = now;
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      if (sweepPausedAt) {
        gs.sweepBase += now - sweepPausedAt;
        sweepPausedAt = 0;
      }
      const dt = Math.min(now - last, 100);
      last = now;

      // Record the guide's *rendered* position this frame so a tap lands exactly
      // where the crosshair was last drawn — not where a freshly re-read clock in
      // onTap would place it a few ms later. Same `now` the draw below uses.
      if (gs.phase === 'aimX') {
        guideRef.current.x = SWEEP_X0 + (SWEEP_X1 - SWEEP_X0) * triWave(now - gs.sweepBase, SWEEP_X_MS);
      } else if (gs.phase === 'aimY') {
        guideRef.current.y = SWEEP_Y0 + (SWEEP_Y1 - SWEEP_Y0) * triWave(now - gs.sweepBase, SWEEP_Y_MS);
      }

      // Feed the spinning motion trail while the axe is in flight.
      if (gs.phase === 'flying' && gs.land) {
        const p = Math.min((now - gs.flyStart) / FLIGHT_MS, 1);
        const sx = W / 2;
        const sy = H - 24;
        pushTrail(fx.trail, sx + (gs.land.x - sx) * p, sy + (gs.land.y - sy) * p, 14);
      }

      if (gs.phase === 'flying' && gs.land && now - gs.flyStart >= FLIGHT_MS) {
        gs.total += gs.score;
        gs.marks = [...gs.marks, { x: gs.land.x, y: gs.land.y }];
        gs.phase = 'scored';
        gs.scoreAtTs = now;
        setTotal(gs.total);
        setLastScore(gs.score);
        setPhase('scored');
        // Impact juice: wood-chips at the stick point + a shake; a flash and a
        // bigger burst when the axe sticks the bullseye (5) or a clutch (7).
        fx.trail.length = 0;
        const big = gs.score >= 5;
        spawnBurst(
          fx.particles,
          gs.land.x,
          gs.land.y,
          big ? 26 : gs.score > 0 ? 14 : 8,
          big ? 300 : 180,
          big ? '#fde68a' : '#c8963e',
        );
        fx.shake = big ? 6 : gs.score > 0 ? 3.5 : 2;
        if (big) {
          fx.flash = 1;
          fx.flashColor = gs.score >= 7 ? '#4ade80' : '#fbbf24';
        }
        if (gs.score >= 7) playFanfare();
        else if (gs.score > 0) playCup();
        else playUndo();
        nextTimer.current = window.setTimeout(() => loadNext(performance.now()), NEXT_DELAY_MS);
      }

      updateFX(fx, dt);
      draw(ctx, gs, fx, now);
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
      // Lock to the last *rendered* sweep position, not a re-read of the clock,
      // so the throw lands exactly under the crosshair the player saw.
      gs.lockX = guideRef.current.x;
      gs.phase = 'aimY';
      gs.sweepBase = now;
      setPhase('aimY');
      playStroke();
    } else if (gs.phase === 'aimY') {
      const y = guideRef.current.y;
      gs.land = { x: gs.lockX, y };
      gs.score = scoreAt(gs.lockX, y);
      gs.phase = 'flying';
      gs.flyStart = now;
      setPhase('flying');
      // Release puff off the thrower's hand + a fresh trail for this throw.
      const fx = fxRef.current;
      fx.trail.length = 0;
      spawnBurst(fx.particles, W / 2, H - 24, 7, 120, '#c8963e');
      playStroke();
    }
  }, []);

  const restart = useCallback(() => {
    if (nextTimer.current) clearTimeout(nextTimer.current);
    gsRef.current = freshGS(performance.now());
    fxRef.current = freshFX();
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
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Axe Throwing" back="/fun" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Throw <span className="text-fairway-100">{Math.min(throwNo + 1, THROWS)}</span>
          <span className="font-normal text-fairway-400"> / {THROWS}</span>
        </span>
        <span className="text-fairway-300">
          Score <span className="font-bold text-fairway-100">{total}</span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onTap}
          className="block touch-none rounded-2xl border border-fairway-800"
        />
      </div>

      <p className="min-h-[2.5rem] shrink-0 px-4 pb-4 pt-3 text-center text-sm text-fairway-100/80">{hint}</p>
    </div>
  );
}
