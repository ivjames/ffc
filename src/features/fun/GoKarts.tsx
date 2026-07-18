import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playStroke, playCup, playFanfare } from '../../lib/sound';

// §12 Go-Karts — the seventh attraction mini-game. A top-down 3-lap time trial
// on a procedural closed circuit. One-touch control: press to accelerate, and
// press left/right of center to steer that way (release to coast). Leave the
// asphalt and the grass grabs you. Fixed-timestep physics, client-side, offline.

// —— Track + physics (logical units; the canvas scales to fit) ————————————————
const W = 340;
const H = 560;
const TRACK_W = 62; // asphalt width
const LAPS = 3;

const FIXED = 1000 / 120;
const ACCEL = 0.12;
const MAX_SPEED = 3.4;
const OFF_MAX = 1.2; // top speed on grass
const OFF_DRAG = 0.9; // extra per-step drag off track
const COAST = 0.985; // decel when not on the gas
const TURN = 0.05; // rad/step at full lock
const TURN_SPEED = 1.4; // speed needed for full steering authority
const COUNTDOWN_MS = 2600;

/** Procedural closed circuit — an oval with an S-kink, sampled as a polyline. */
function buildTrack() {
  const cx = W / 2;
  const cy = H / 2 + 6;
  const a = 108;
  const b = 196;
  const kink = 34;
  const N = 90;
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    pts.push({ x: cx + a * Math.cos(t) + kink * Math.sin(2 * t), y: cy + b * Math.sin(t) });
  }
  const cum: number[] = [0];
  let total = 0;
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % N];
    total += Math.hypot(q.x - p.x, q.y - p.y);
    cum.push(total);
  }
  return { pts, cum, total, N };
}
const TRACK = buildTrack();

/** Nearest point on the track centerline → distance + arc-length fraction. */
function project(x: number, y: number): { dist: number; f: number } {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i < TRACK.N; i++) {
    const p = TRACK.pts[i];
    const q = TRACK.pts[(i + 1) % TRACK.N];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const segLen2 = dx * dx + dy * dy || 1;
    let u = ((x - p.x) * dx + (y - p.y) * dy) / segLen2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = p.x + u * dx;
    const py = p.y + u * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < best) {
      best = d;
      bestS = TRACK.cum[i] + u * Math.hypot(dx, dy);
    }
  }
  return { dist: best, f: bestS / TRACK.total };
}

type Phase = 'countdown' | 'race' | 'done';
type Kart = { x: number; y: number; heading: number; speed: number };
type GS = {
  phase: Phase;
  kart: Kart;
  touch: { active: boolean; x: number };
  raceTime: number; // ms of active racing
  lapStart: number;
  laps: number; // completed laps
  best: number; // best lap ms (Infinity until first)
  lastLap: number;
  prevF: number;
  halfway: boolean;
  countStart: number;
};

function startKart(): Kart {
  const p0 = TRACK.pts[0];
  const p1 = TRACK.pts[1];
  return { x: p0.x, y: p0.y, heading: Math.atan2(p1.y - p0.y, p1.x - p0.x), speed: 0 };
}

function freshGS(now: number): GS {
  return {
    phase: 'countdown',
    kart: startKart(),
    touch: { active: false, x: W / 2 },
    raceTime: 0,
    lapStart: 0,
    laps: 0,
    best: Infinity,
    lastLap: 0,
    prevF: 0,
    halfway: false,
    countStart: now,
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** One physics substep. Returns true when a lap was just completed. */
function step(gs: GS): boolean {
  const k = gs.kart;
  const onTrack = project(k.x, k.y).dist <= TRACK_W / 2;

  if (gs.touch.active) {
    k.speed += ACCEL;
  } else {
    k.speed *= COAST;
  }
  if (!onTrack) k.speed *= OFF_DRAG;
  k.speed = clamp(k.speed, 0, onTrack ? MAX_SPEED : OFF_MAX);

  // Steering: press left/right of center; authority scales with speed.
  const steer = clamp((gs.touch.x - W / 2) / (W / 2), -1, 1);
  if (gs.touch.active) k.heading += TURN * steer * clamp(k.speed / TURN_SPEED, 0, 1);

  k.x += Math.cos(k.heading) * k.speed;
  k.y += Math.sin(k.heading) * k.speed;
  // Keep the kart on the canvas.
  k.x = clamp(k.x, 6, W - 6);
  k.y = clamp(k.y, 6, H - 6);

  // Lap progress — count a forward wrap past start/finish, once past halfway.
  const f = project(k.x, k.y).f;
  if (f > 0.5) gs.halfway = true;
  const df = f - gs.prevF;
  let lapped = false;
  if (df < -0.5 && gs.halfway) {
    gs.laps += 1;
    gs.halfway = false;
    lapped = true;
  } else if (df > 0.5) {
    // Crossed backward — undo a lap credit so reversing can't farm laps.
    gs.laps = Math.max(0, gs.laps - 1);
  }
  gs.prevF = f;
  return lapped;
}

// —— drawing —————————————————————————————————————————————————————————————————
function draw(ctx: CanvasRenderingContext2D, gs: GS, now: number) {
  ctx.clearRect(0, 0, W, H);
  // Grass.
  ctx.fillStyle = '#14361f';
  ctx.fillRect(0, 0, W, H);

  // Asphalt: stroke the centerline at full track width, plus a lighter inner
  // stroke for a lane feel.
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(TRACK.pts[0].x, TRACK.pts[0].y);
    for (let i = 1; i <= TRACK.N; i++) {
      const p = TRACK.pts[i % TRACK.N];
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  trace();
  ctx.strokeStyle = '#3f4650';
  ctx.lineWidth = TRACK_W;
  ctx.stroke();
  trace();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 12]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Start/finish line — a checkered band across the track at the start point.
  const p0 = TRACK.pts[0];
  const p1 = TRACK.pts[1];
  const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  ctx.save();
  ctx.translate(p0.x, p0.y);
  ctx.rotate(ang + Math.PI / 2);
  const half = TRACK_W / 2;
  const sq = TRACK_W / 4;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#0b0f14';
      ctx.fillRect(-half + c * sq, -sq + r * sq, sq, sq);
    }
  }
  ctx.restore();

  // Kart.
  const k = gs.kart;
  ctx.save();
  ctx.translate(k.x, k.y);
  ctx.rotate(k.heading);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(-11, -7, 22, 14);
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(2, -5, 7, 10); // windshield/cockpit toward the front
  ctx.restore();

  // Countdown.
  if (gs.phase === 'countdown') {
    const left = COUNTDOWN_MS - (now - gs.countStart);
    const n = Math.ceil(left / 800);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n > 3 ? '3' : n <= 0 ? 'GO!' : String(n), W / 2, H / 2);
  }
}

const fmt = (ms: number) => (ms / 1000).toFixed(2);

export default function GoKarts() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS(0));

  const [phase, setPhase] = useState<Phase>('countdown');
  const [lap, setLap] = useState(0);
  const [raceTime, setRaceTime] = useState(0);
  const [best, setBest] = useState<number>(Infinity);

  const playing = phase !== 'done';

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
    let pausedAt = 0;
    let pushedLap = -1;
    let pushedTime = -1;
    const loop = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        if (!pausedAt) pausedAt = now;
        last = now;
        raf = requestAnimationFrame(loop);
        return;
      }
      if (pausedAt) {
        gs.countStart += now - pausedAt;
        pausedAt = 0;
      }
      const dt = Math.min(now - last, 100);
      last = now;

      if (gs.phase === 'countdown' && now - gs.countStart >= COUNTDOWN_MS) {
        gs.phase = 'race';
        setPhase('race');
      }

      if (gs.phase === 'race') {
        gs.raceTime += dt;
        acc += dt;
        while (acc >= FIXED) {
          const lapped = step(gs);
          if (lapped) {
            const lapMs = gs.raceTime - gs.lapStart;
            gs.lastLap = lapMs;
            if (lapMs < gs.best) {
              gs.best = lapMs;
              setBest(lapMs);
            }
            gs.lapStart = gs.raceTime;
            if (gs.laps >= LAPS) {
              gs.phase = 'done';
              setPhase('done');
              playFanfare();
              break;
            }
            playCup();
          }
          acc -= FIXED;
        }
      }

      if (gs.laps !== pushedLap) {
        pushedLap = gs.laps;
        setLap(gs.laps);
      }
      const shownTime = Math.round(gs.raceTime);
      if (shownTime !== pushedTime) {
        pushedTime = shownTime;
        setRaceTime(shownTime);
      }

      draw(ctx, gs, now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  }, []);

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      gs.touch = { active: true, x: toField(e).x };
      canvasRef.current?.setPointerCapture(e.pointerId);
      // First press also kicks the engine sound once we're racing.
      if (gs.phase === 'race') playStroke();
    },
    [toField],
  );
  const onMove = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (gs.touch.active) gs.touch.x = toField(e).x;
    },
    [toField],
  );
  const onUp = useCallback(() => {
    gsRef.current.touch.active = false;
  }, []);

  const restart = useCallback(() => {
    gsRef.current = freshGS(performance.now());
    setPhase('countdown');
    setLap(0);
    setRaceTime(0);
    setBest(Infinity);
  }, []);

  if (phase === 'done') {
    const total = gsRef.current.raceTime;
    return (
      <Screen>
        <TopBar title="Go-Karts" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🏁</span>
            <div className="text-2xl font-black text-fairway-50">Race complete!</div>
            <div className="text-5xl font-black text-fairway-50">{fmt(total)}s</div>
            <p className="text-sm text-fairway-300">
              Best lap <span className="font-bold text-fairway-100">{best === Infinity ? '—' : `${fmt(best)}s`}</span>
              {' · '}
              {LAPS} laps
            </p>
          </div>
          <div className="mt-8">
            <Button onClick={restart} sound="none">
              Race again
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="Go-Karts" back="/fun" />
      <Content>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-fairway-50">
            Lap <span className="text-fairway-100">{Math.min(lap + 1, LAPS)}</span>
            <span className="font-normal text-fairway-400"> / {LAPS}</span>
          </span>
          <span className="text-fairway-300">
            {fmt(raceTime)}s
            <span className="mx-2 text-fairway-700">·</span>
            Best {best === Infinity ? '—' : `${fmt(best)}s`}
          </span>
        </div>

        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="block w-full touch-none rounded-2xl border border-fairway-800"
          style={{ aspectRatio: `${W} / ${H}` }}
        />

        <p className="mt-3 min-h-[2.5rem] text-center text-sm text-fairway-100/80">
          {phase === 'countdown'
            ? 'Get ready…'
            : 'Press to go — press left or right of center to steer. Stay on the asphalt!'}
        </p>
      </Content>
    </Screen>
  );
}
