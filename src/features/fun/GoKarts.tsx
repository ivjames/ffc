import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playStroke, playCup, playFanfare } from '../../lib/sound';

// §12 Go-Karts — the seventh attraction mini-game. A top-down 3-lap time trial
// on a procedural closed circuit. Drag control: touch anywhere and the kart
// chases your finger like a lure — you lead it around the track instead of
// working a throttle and left/right steering by hand. Throttle scales with how
// far ahead you drag, so holding still brings it to a gentle stop. Solid walls
// line both edges of the asphalt: run wide and you scrape the barrier and slide
// along it instead of flying off across the grass. Fixed-timestep physics,
// client-side, offline.

// —— Track + physics (logical units; the canvas scales to fit) ————————————————
const W = 340;
const H = 560;
const TRACK_W = 62; // asphalt width
const WALL = 6; // barrier thickness drawn outside each asphalt edge
const KART_R = 7; // kart collision radius (half its body width)
const LAPS = 3;

const FIXED = 1000 / 120;
const ACCEL = 0.06; // throttle pickup per substep at full lead
const MAX_SPEED = 2.3; // calmer top speed (was twitchy-fast)
const COAST = 0.985; // rolling resistance every substep
const WALL_SLIDE = 0.55; // speed kept when scraping along a barrier
const TURN = 0.06; // max heading change per substep, turning toward the finger
const TURN_SPEED = 1.1; // speed for full turn authority
const TURN_FLOOR = 0.3; // min turn authority, so a slow kart can still point out of a wall
const LEAD = 80; // finger lead distance (px) for full throttle
const CATCH_R = 18; // within this of the finger, the kart eases to a stop
const BRAKE = 0.9; // gentle braking once caught up to the finger
const COUNTDOWN_MS = 2600;

// The wall sits half the kart's width in from the asphalt edge, so the kart body
// rests against the barrier rather than half-buried in it.
const WALL_DIST = TRACK_W / 2 - KART_R;

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

/** Nearest point on the track centerline → distance, arc-length fraction, and
 * that nearest point (so callers can build the wall normal from kart → center). */
function project(x: number, y: number): { dist: number; f: number; px: number; py: number } {
  let best = Infinity;
  let bestS = 0;
  let bestX = x;
  let bestY = y;
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
      bestX = px;
      bestY = py;
    }
  }
  return { dist: best, f: bestS / TRACK.total, px: bestX, py: bestY };
}

type Phase = 'countdown' | 'race' | 'done';
type Kart = { x: number; y: number; heading: number; speed: number };
type GS = {
  phase: Phase;
  kart: Kart;
  touch: { active: boolean; x: number; y: number };
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
    touch: { active: false, x: W / 2, y: H - 40 },
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

  // Drag control: the finger is a lure the kart chases. It turns toward the
  // touch point (rate-limited so it still corners like a vehicle) and its
  // throttle scales with how far ahead you're dragging — lead it further to go
  // faster, hold still and it eases to a stop as it catches up.
  if (gs.touch.active) {
    const dx = gs.touch.x - k.x;
    const dy = gs.touch.y - k.y;
    const dist = Math.hypot(dx, dy);
    // Turn toward the finger by the shortest angle, capped per substep.
    let dh = Math.atan2(dy, dx) - k.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const maxTurn = TURN * clamp(k.speed / TURN_SPEED, TURN_FLOOR, 1);
    k.heading += clamp(dh, -maxTurn, maxTurn);
    k.speed += ACCEL * clamp(dist / LEAD, 0, 1);
    if (dist < CATCH_R) k.speed *= BRAKE;
  }
  k.speed *= COAST;
  k.speed = clamp(k.speed, 0, MAX_SPEED);

  k.x += Math.cos(k.heading) * k.speed;
  k.y += Math.sin(k.heading) * k.speed;

  // Barriers line both edges of the asphalt. If the kart's center drifts past the
  // wall distance from the centerline, shove it back to the barrier and cancel
  // the velocity heading into the wall — the leftover along-wall motion (bled by
  // WALL_SLIDE) lets the kart scrape and slide instead of stopping dead or
  // flying off across the grass.
  const pr = project(k.x, k.y);
  if (pr.dist > WALL_DIST) {
    // Outward normal: from the nearest centerline point toward the kart.
    const nx = (k.x - pr.px) / (pr.dist || 1);
    const ny = (k.y - pr.py) / (pr.dist || 1);
    k.x = pr.px + nx * WALL_DIST;
    k.y = pr.py + ny * WALL_DIST;
    const vx = Math.cos(k.heading) * k.speed;
    const vy = Math.sin(k.heading) * k.speed;
    const vn = vx * nx + vy * ny; // component driving into the wall
    if (vn > 0) {
      const tx = vx - vn * nx; // slide component tangent to the wall
      const ty = vy - vn * ny;
      k.speed = Math.hypot(tx, ty) * WALL_SLIDE;
      if (k.speed > 0.001) k.heading = Math.atan2(ty, tx);
    }
  }

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
  // Barriers: a solid band the full track width plus a wall on each edge, drawn
  // under the asphalt so the asphalt masks the middle and leaves a wall ring.
  trace();
  ctx.strokeStyle = '#0b0f14';
  ctx.lineWidth = TRACK_W + WALL * 2 + 2;
  ctx.stroke();
  trace();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = TRACK_W + WALL * 2;
  ctx.stroke();
  // Asphalt on top, leaving the wall ring exposed on both edges.
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

  // Lure: while dragging, show where you're leading the kart.
  if (gs.phase === 'race' && gs.touch.active) {
    ctx.beginPath();
    ctx.arc(gs.touch.x, gs.touch.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251,191,36,0.30)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(251,191,36,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

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
  // Anchor the countdown to the real clock. Creating this with t=0 would make
  // the opening frame see the countdown as already elapsed and drop the player
  // straight into the race, skipping the advertised countdown.
  const gsRef = useRef<GS>(null!);
  if (!gsRef.current) gsRef.current = freshGS(performance.now());

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
    let pushedLap = -1;
    let pushedTime = -1;
    // Pause via visibilitychange, not a hidden-rAF branch: mobile browsers
    // suspend requestAnimationFrame while backgrounded, so a hidden frame may
    // never run. Shift the countdown by the away span on resume so the elapsed
    // hidden time can't complete the countdown (the race clock is dt-driven and
    // resumes naturally once `last` is reset).
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        gsRef.current.countStart += performance.now() - hiddenAt;
        hiddenAt = 0;
        last = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const loop = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(loop);
        return;
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
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [playing]);

  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  }, []);

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      const p = toField(e);
      gs.touch = { active: true, x: p.x, y: p.y };
      canvasRef.current?.setPointerCapture(e.pointerId);
      // First press also kicks the engine sound once we're racing.
      if (gs.phase === 'race') playStroke();
    },
    [toField],
  );
  const onMove = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (gs.touch.active) {
        const p = toField(e);
        gs.touch.x = p.x;
        gs.touch.y = p.y;
      }
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
            : 'Drag to lead the kart — it follows your finger. Keep off the walls!'}
        </p>
      </Content>
    </Screen>
  );
}
