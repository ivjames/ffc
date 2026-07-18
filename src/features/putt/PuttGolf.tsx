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
  sdBlob,
  sdSurface,
  type Seg,
  type Ball,
  type Hole,
} from './world';
import { generateHole } from './generate';

// Arcade Putt — a playable mini-golf minigame. Drag from the ball to aim (the
// drag direction sets the line, its length sets power) and release to putt. The
// green is a smooth shaped surface (rounded lanes, circular greens fed by narrow
// channels); curved walls deflect the ball and blobby pits swallow a slow one
// for a penalty.
//
// Two modes: the hand-authored nine-hole COURSE, and an ENDLESS run of
// procedurally generated holes (generate.ts) that never ends until you stop.
// All client-side — works offline.
//
// Physics + geometry live in ./world (shared with the validation sim). This file
// is input, the rAF loop, and rendering.

type Mode = 'course' | 'endless';
type Phase = 'aim' | 'rolling' | 'splash' | 'sunk' | 'done';
type Drag = { active: boolean; sx: number; sy: number; dx: number; dy: number };
// A splash-and-sink animation: the ball sinks at (sx,sy), ripples spread, then it
// re-drops (grows back in) at (dx,dy) just outside the pool. `p` runs 0→1.
type Splash = { sx: number; sy: number; dx: number; dy: number; p: number };
type GS = {
  holes: Hole[];
  mode: Mode;
  seed: number; // base seed for endless generation
  ball: Ball;
  phase: Phase;
  holeIndex: number;
  strokes: number;
  drag: Drag;
  splash: Splash | null;
};

// Distinct derived seeds per hole so an endless run is reproducible.
const SEED_SALT = 0x9e3779b1;

// How long the splash-and-sink plays before the ball is live again (ms).
const SPLASH_MS = 950;

// After sinking, linger on the result so the score reads clearly, then advance
// on its own so a round flows without a tap between every hole. The "Next hole"
// button still skips the wait.
const AUTO_ADVANCE_MS = 3000;

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

// Candy-colored barrier palette (base + a lighter top highlight), cycled per
// barrier so a hole's rails/bumpers are distinct and clearly non-green.
const WALL_COLORS = [
  { base: '#ef4444', light: '#f87171' }, // red
  { base: '#3b82f6', light: '#60a5fa' }, // blue
  { base: '#f59e0b', light: '#fbbf24' }, // amber
  { base: '#a855f7', light: '#c084fc' }, // purple
  { base: '#ec4899', light: '#f472b6' }, // pink
  { base: '#14b8a6', light: '#2dd4bf' }, // teal
];

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

// --- filleted hazard/rough blobs --------------------------------------------
// Hazards and rough are clusters of overlapping discs. Filling them as separate
// capsules (fillCapsule) unions them, but the union keeps a sharp concave waist
// at every disc crossing, so a chain reads as a bunch of grapes. Instead we
// rasterize each cluster from its *smooth* field (sdBlob, the same one collision
// uses): colour each pixel by its signed distance so the outline — and every
// junction — is a filleted blob. Layers (rim → fill → shimmer) fall straight out
// of distance bands. All of it is clipped to the surface, so a patch or a blob
// that rounds out toward the rail is trimmed cleanly at it rather than spilling
// onto the off-surface background.
//
// This is per-pixel, so it's built once per hole into an offscreen canvas and
// cached; the frame loop just blits it. SS supersamples for a crisp edge.
const SS = 2;
const hazardCache = new Map<Hole, HTMLCanvasElement | null>();

type RGB = [number, number, number];
// Two-value hash of integer pixel coords → [0,1), for a stable rough fleck.
function fleck(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function buildHazardLayer(hole: Hole): HTMLCanvasElement | null {
  if (!hole.rough && !hole.water && !hole.pits) return null;
  const cv = document.createElement('canvas');
  cv.width = W * SS;
  cv.height = H * SS;
  const c = cv.getContext('2d');
  if (!c) return null;
  const img = c.createImageData(cv.width, cv.height);
  const d = img.data;
  const set = (o: number, col: RGB, a = 255) => {
    d[o] = col[0];
    d[o + 1] = col[1];
    d[o + 2] = col[2];
    d[o + 3] = a;
  };
  for (let iy = 0; iy < cv.height; iy++) {
    const py = iy / SS;
    for (let ix = 0; ix < cv.width; ix++) {
      const px = ix / SS;
      const o = (iy * cv.width + ix) * 4;
      // Everything here is clipped to the surface: the smooth (sdBlob) contour can
      // round out a hair past the rail near a junction, so gating on the surface
      // trims it at the rail instead of letting it spill onto the off-surface
      // background (and matches the on-surface splash gate in the physics).
      const onSurface = sdSurface(px, py, hole) < 0;
      // Rough patches (bottom layer). A darker lip rings the patch; a sparse fleck
      // breaks up the fill so it reads as longer grass.
      if (hole.rough && onSurface) {
        const sd = sdBlob(px, py, hole.rough);
        if (sd < 0) {
          if (sd > -3) set(o, [30, 84, 48]);
          else set(o, fleck(ix, iy) > 0.86 ? [52, 122, 70] : [40, 104, 58]);
        }
      }
      // Water — deep rim, water, then a lighter shimmer in the middle.
      if (hole.water && onSurface) {
        const sd = sdBlob(px, py, hole.water);
        if (sd < -6) set(o, [120, 190, 235]);
        else if (sd < 0) set(o, [42, 151, 220]);
        else if (sd < 2) set(o, [21, 101, 168]);
      }
      // Sand bunkers — darker sand rim, then the sand surface.
      if (hole.pits && onSurface) {
        const sd = sdBlob(px, py, hole.pits);
        if (sd < 0) set(o, [227, 205, 140]);
        else if (sd < 2) set(o, [184, 153, 92]);
      }
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

function hazardLayer(hole: Hole): HTMLCanvasElement | null {
  if (!hazardCache.has(hole)) {
    // Endless appends fresh holes forever; cap the cache (Map keeps insertion
    // order) so we don't retain a canvas per hole for the whole run.
    if (hazardCache.size >= 12) hazardCache.delete(hazardCache.keys().next().value!);
    hazardCache.set(hole, buildHazardLayer(hole));
  }
  return hazardCache.get(hole) ?? null;
}

// The splash-and-sink, driven by progress s.p (0→1): ripples spread from where
// the ball went under, the ball shrinks away as it sinks, then it grows back in
// at the re-drop spot (already computed clear of the pool) with a landing ripple.
function drawSplash(ctx: CanvasRenderingContext2D, s: Splash) {
  const p = s.p;

  // Ripples from the entry point — a few staggered rings expanding and fading.
  const RINGS = 3;
  for (let i = 0; i < RINGS; i++) {
    const rp = p * 1.5 - i * 0.22;
    if (rp <= 0 || rp >= 1) continue;
    ctx.strokeStyle = `rgba(210,235,255,${0.55 * (1 - rp)})`;
    ctx.lineWidth = 2 * (1 - rp) + 0.6;
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, BALL_R * (0.5 + rp * 2.6), 0, Math.PI * 2);
    ctx.stroke();
  }

  // The ball sinking: shrinks and dims, gone by ~55% of the way through.
  const sinkP = Math.min(p / 0.55, 1);
  if (sinkP < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - sinkP * 0.5;
    ctx.fillStyle = '#eef2f6';
    ctx.beginPath();
    ctx.arc(s.sx, s.sy + sinkP * 2, BALL_R * (1 - sinkP), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Re-drop: the ball grows back in just outside the pool over the last third,
  // with a small landing ripple so it reads as reappearing clear of the water.
  const dropP = Math.max(0, (p - 0.68) / 0.32);
  if (dropP > 0) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(s.dx, s.dy, BALL_R * Math.min(1, dropP), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (dropP < 1) {
      ctx.strokeStyle = `rgba(240,253,244,${0.5 * (1 - dropP)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.dx, s.dy, BALL_R + 4 + dropP * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function draw(ctx: CanvasRenderingContext2D, gs: GS) {
  const hole = gs.holes[gs.holeIndex];
  if (!hole) return;

  const surface = [...hole.fairway, ...hole.green];

  // Off the playable surface.
  ctx.fillStyle = '#0a2417';
  ctx.fillRect(0, 0, W, H);

  // Dark rim around the whole surface.
  ctx.fillStyle = '#0b3b22';
  for (const s of surface) fillCapsule(ctx, s, 5);

  // The green's rough collar first, then the fairway lane over it (so the
  // approach cuts through the collar and stays clear of rough), then the
  // brighter putting surface on top — a clean green disc with a collar that
  // rings it everywhere except where the fairway enters.
  ctx.fillStyle = '#2b7a43';
  for (const s of hole.green) fillCapsule(ctx, s, 0);
  ctx.fillStyle = '#1a8f4a';
  for (const s of hole.fairway) fillCapsule(ctx, s, 0);
  ctx.fillStyle = '#37c06d';
  for (const s of hole.green) fillCapsule(ctx, s, -ROUGH_BAND);

  // Rough patches, water and sand — rasterized once per hole from their smooth
  // fields (sdBlob) into an offscreen layer so every cluster is a filleted blob,
  // not a bunch of grapes — then blitted here over the surface. Rough is under
  // the hazards; walls (below) stay on top.
  const layer = hazardLayer(hole);
  if (layer) ctx.drawImage(layer, 0, 0, W, H);

  // Walls — bright candy-colored rails/bumpers, one hue per barrier, with a
  // dark rim and a light top highlight so they read as raised and non-green.
  if (hole.walls) {
    hole.walls.forEach((s, i) => {
      const c = WALL_COLORS[i % WALL_COLORS.length];
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      fillCapsule(ctx, s, 2);
      ctx.fillStyle = c.base;
      fillCapsule(ctx, s, 0);
      ctx.fillStyle = c.light;
      fillCapsule(ctx, s, -3);
    });
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

  // While a splash plays it owns the ball's presentation — draw the sink/re-drop
  // and nothing else (no resting ball, no aim UI).
  if (gs.phase === 'splash' && gs.splash) {
    drawSplash(ctx, gs.splash);
    return;
  }

  const b = gs.ball;

  // Aim line while dragging.
  if (gs.phase === 'aim' && gs.drag.active) {
    const { dx, dy } = gs.drag;
    const len = Math.hypot(dx, dy);
    if (len > 4) {
      const power = Math.min(len / MAX_DRAG, 1);
      // Slingshot: the shot goes opposite the drag, so the arrow points away
      // from the finger and stays visible.
      const a = Math.atan2(-dy, -dx);
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

// A fresh, random base seed for an endless run (only needs to be unpredictable,
// not cryptographic).
function freshSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

export default function PuttGolf() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>({
    holes: [],
    mode: 'course',
    seed: 0,
    ball: { x: HOLES[0].tee.x, y: HOLES[0].tee.y, vx: 0, vy: 0 },
    phase: 'aim',
    holeIndex: 0,
    strokes: 0,
    drag: { active: false, sx: 0, sy: 0, dx: 0, dy: 0 },
    splash: null,
  });

  const [mode, setMode] = useState<Mode | null>(null);
  const [phase, setPhase] = useState<Phase>('aim');
  const [holeIndex, setHoleIndex] = useState(0);
  const [strokes, setStrokes] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [note, setNote] = useState('');
  const scoresRef = useRef<number[]>([]);

  const startHole = useCallback((index: number) => {
    const gs = gsRef.current;
    const hole = gs.holes[index];
    gs.ball = { x: hole.tee.x, y: hole.tee.y, vx: 0, vy: 0 };
    gs.phase = 'aim';
    gs.holeIndex = index;
    gs.strokes = 0;
    gs.drag.active = false;
    gs.splash = null;
    setPhase('aim');
    setHoleIndex(index);
    setStrokes(0);
    setNote('');
  }, []);

  // Start a round in the chosen mode. Course mode plays the authored HOLES;
  // endless mode generates the first hole from a fresh seed and grows from there.
  const beginRound = useCallback(
    (m: Mode) => {
      const gs = gsRef.current;
      gs.mode = m;
      if (m === 'course') {
        gs.holes = HOLES;
      } else {
        gs.seed = freshSeed();
        gs.holes = [generateHole(gs.seed)];
      }
      scoresRef.current = [];
      setScores([]);
      setHoles(gs.holes);
      setMode(m);
      startHole(0);
    },
    [startHole],
  );

  // Ensure the endless hole at `index` exists, generating it if the prefetch
  // (kicked off when the previous hole was sunk) hasn't landed yet.
  const ensureEndlessHole = useCallback((index: number) => {
    const gs = gsRef.current;
    while (gs.holes.length <= index) {
      gs.holes = [...gs.holes, generateHole(gs.seed + gs.holes.length * SEED_SALT)];
    }
    setHoles(gs.holes);
  }, []);

  // The canvas only exists while the play view is shown (it unmounts on the
  // finished-round screen and the mode picker), so the render/physics loop must
  // re-initialize each time that view mounts.
  const playing = mode !== null && phase !== 'done';

  // Render + physics loop.
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
    let last = 0;
    const splashInfo = { splashX: 0, splashY: 0 };
    const frame = (ts: number) => {
      const dt = last ? ts - last : 16;
      last = ts;
      const gs = gsRef.current;
      if (gs.phase === 'rolling') {
        const res = stepPhysics(gs.ball, gs.holes[gs.holeIndex], splashInfo);
        if (res === 'sunk') {
          gs.phase = 'sunk';
          const next = [...scoresRef.current];
          next[gs.holeIndex] = gs.strokes;
          scoresRef.current = next;
          setScores(next);
          setPhase('sunk');
          // Endless: prefetch the next hole now, while the celebration is up and
          // the ball is at rest, so generation never hitches live play.
          if (gs.mode === 'endless') {
            const want = gs.holeIndex + 1;
            setTimeout(() => {
              const g = gsRef.current;
              if (g.mode === 'endless' && g.holes.length <= want) {
                g.holes = [...g.holes, generateHole(g.seed + g.holes.length * SEED_SALT)];
                setHoles(g.holes);
              }
            }, 0);
          }
        } else if (res === 'water') {
          // Penalty now; the ball is already sitting at its safe re-drop spot.
          // Play the splash-and-sink (sink at the entry point → re-drop grows
          // back in) before handing control back to the player.
          gs.strokes += 1;
          gs.splash = {
            sx: splashInfo.splashX,
            sy: splashInfo.splashY,
            dx: gs.ball.x,
            dy: gs.ball.y,
            p: 0,
          };
          gs.phase = 'splash';
          setStrokes(gs.strokes);
          setPhase('splash');
          setNote('💦 Splash! +1 penalty — dropped by the water');
        } else if (res === 'stopped') {
          gs.phase = 'aim';
          setPhase('aim');
        }
      } else if (gs.phase === 'splash' && gs.splash) {
        gs.splash.p += dt / SPLASH_MS;
        if (gs.splash.p >= 1) {
          gs.splash = null;
          gs.phase = 'aim';
          setPhase('aim');
        }
      }
      draw(ctx, gs);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

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
    const a = Math.atan2(-dy, -dx); // slingshot: launch opposite the drag
    const speed = MIN_SHOT + power * (MAX_SHOT - MIN_SHOT);
    gs.ball.vx = Math.cos(a) * speed;
    gs.ball.vy = Math.sin(a) * speed;
    gs.phase = 'rolling';
    gs.strokes += 1;
    setStrokes(gs.strokes);
    setPhase('rolling');
    setNote('');
  }, []);

  const advance = useCallback(() => {
    const gs = gsRef.current;
    if (gs.phase === 'sunk') {
      if (gs.mode === 'course' && gs.holeIndex + 1 >= gs.holes.length) {
        gs.phase = 'done';
        setPhase('done');
      } else {
        if (gs.mode === 'endless') ensureEndlessHole(gs.holeIndex + 1);
        startHole(gs.holeIndex + 1);
      }
    }
  }, [startHole, ensureEndlessHole]);

  // Auto-advance a short beat after the ball drops, so the round flows without a
  // tap between holes. Pauses while the tab/app is backgrounded (the timer is
  // (re)armed on visibility) so a hidden celebration isn't skipped past, and is
  // cancelled if the player taps "Next hole" first (advance() also no-ops once
  // the phase leaves 'sunk', so a late-firing timer can't double-advance).
  useEffect(() => {
    if (phase !== 'sunk') return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(advance, AUTO_ADVANCE_MS);
    };
    const onVisibility = () => {
      if (document.hidden) window.clearTimeout(timer);
      else arm();
    };
    if (!document.hidden) arm();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase, advance]);

  // End an endless run early to see the summary of holes played so far.
  const endRun = useCallback(() => {
    gsRef.current.phase = 'done';
    setPhase('done');
  }, []);

  const resetHole = useCallback(() => startHole(gsRef.current.holeIndex), [startHole]);

  const hole = holes[holeIndex];
  const played = scores.filter((s) => s != null).length;
  const playedHoles = holes.slice(0, scores.length);
  const totalStrokes = scores.reduce((a, b) => a + (b ?? 0), 0);
  const totalPar = playedHoles.reduce((a, h) => a + h.par, 0);
  const result = phase === 'sunk' && hole ? holeResult(strokes, hole.par) : null;

  const hint =
    phase === 'aim'
      ? note || 'Pull back from the ball to aim — the arrow shows your shot — and release to putt.'
      : phase === 'rolling'
        ? 'Rolling…'
        : phase === 'splash'
          ? '💦 Splash! +1 penalty'
          : phase === 'sunk'
            ? `${result?.emoji} ${result?.label} — ${strokes} on par ${hole?.par}`
            : '';

  // Mode picker — the entry screen.
  if (mode === null) {
    return (
      <Screen>
        <TopBar title="Arcade Putt" back="/fun" />
        <Content>
          <div className="mt-6 text-center">
            <div className="text-5xl">⛳️</div>
            <h2 className="mt-2 text-2xl font-black text-fairway-50">Choose your game</h2>
            <p className="mx-auto mt-1 max-w-xs text-sm text-fairway-100/70">
              Drag back from the ball to aim, release to putt. Sink it in as few strokes as you can.
            </p>
          </div>
          <div className="mt-6 space-y-3">
            <Button onClick={() => beginRound('course')}>🏁 9-Hole Course</Button>
            <Button variant="ghost" onClick={() => beginRound('endless')}>
              ♾️ Endless (procedural)
            </Button>
          </div>
          <p className="mx-auto mt-6 max-w-xs text-center text-xs text-fairway-400">
            Endless deals fresh, randomly generated holes for as long as you keep playing — each one
            checked to be fair and sinkable before it's dealt.
          </p>
        </Content>
      </Screen>
    );
  }

  const isEndless = mode === 'endless';

  return (
    <Screen>
      <TopBar title="Arcade Putt" back="/fun" />
      <Content>
        {phase !== 'done' ? (
          <>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-bold text-fairway-50">
                Hole {holeIndex + 1}
                <span className="font-normal text-fairway-400">
                  {isEndless ? ' · Endless' : ` / ${HOLES.length}`}
                </span>
              </span>
              <span className="text-fairway-300">
                Par <span className="font-bold text-fairway-100">{hole?.par}</span>
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

            <p
              className={`mt-3 min-h-[2.5rem] text-center text-sm ${
                note && phase === 'aim' ? 'font-semibold text-sky-300' : 'text-fairway-100/80'
              }`}
            >
              {hint}
            </p>

            <div className="space-y-2">
              {phase === 'sunk' && (
                <Button onClick={advance}>
                  {!isEndless && holeIndex + 1 >= HOLES.length ? 'See scorecard →' : 'Next hole →'}
                </Button>
              )}
              {phase !== 'sunk' && (
                <Button
                  variant="ghost"
                  onClick={resetHole}
                  disabled={phase === 'rolling' || phase === 'splash'}
                >
                  Reset hole
                </Button>
              )}
              {isEndless && phase !== 'rolling' && phase !== 'splash' && (
                <Button variant="ghost" onClick={endRun}>
                  End run
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="mt-4">
            <div className="mb-4 text-center">
              <div className="text-5xl">🏆</div>
              <h2 className="mt-2 text-2xl font-black text-fairway-50">
                {isEndless ? 'Run complete' : 'Round complete'}
              </h2>
              <p className="mt-1 text-fairway-100/70">
                {isEndless ? `${played} holes · ` : ''}
                {totalStrokes} strokes · {toParText(totalStrokes - totalPar)}
              </p>
            </div>

            {playedHoles.length > 0 && (
              <div className="max-h-[46vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-fairway-800">
                {playedHoles.map((h, i) => {
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
            )}

            <div className="mt-4 space-y-2">
              <Button onClick={() => beginRound(mode)}>{isEndless ? 'New run' : 'Play again'}</Button>
              <Button variant="ghost" onClick={() => setMode(null)}>
                Change mode
              </Button>
            </div>
          </div>
        )}
      </Content>
    </Screen>
  );
}
