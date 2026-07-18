import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playStroke, playFanfare } from '../../lib/sound';

// §12 Bumper Cars — the third attraction mini-game. Drive with a floating
// joystick and ram the other cars; land as many solid bumps as you can before
// the 30-second horn. Top-down real-time canvas physics, client-side, offline.
// (Bumper boats is the same mechanic reskinned — swap the arena/emoji.)
//
// Fixed-timestep accumulator (framerate-independent, no tunneling); the clock
// pauses when backgrounded, like the other games. Cars are equal-mass circles
// that collide elastically; a bump only scores when YOU drive into another car
// hard enough (rewarding aggression, not getting shoved).

// —— Arena + physics (logical units; the canvas scales to fit) ————————————————
const W = 340;
const H = 560;
const CAR_R = 26;
const N_AI = 4;

const FIXED = 1000 / 120; // physics substep (ms)
const FRICTION = 0.975; // per-step velocity damping
const MAX_SPEED = 5.5;
const AI_MAX = 4.4;
const ACCEL = 0.16; // player thrust at full throttle (units/step)
const AI_ACCEL = 0.12;
const WALL_E = 0.6; // wall bounce restitution
const CAR_E = 0.92; // car-car restitution
const JOY_MAX = 60; // joystick travel (field units) for full throttle
const BUMP_SPEED = 2.0; // closing speed that counts as a solid bump
const BUMP_COOLDOWN = 450; // ms before the same car can be bumped again
const GAME_MS = 30000;

const CAR_COLORS = ['#f97316', '#eab308', '#a855f7', '#38bdf8'];

type Car = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  // AI wander target (unused for the player).
  tx: number;
  ty: number;
  retargetAt: number;
};
type Joystick = { active: boolean; ox: number; oy: number; kx: number; ky: number };
type Phase = 'play' | 'done';
type GS = {
  phase: Phase;
  cars: Car[]; // [0] = player, rest = AI
  score: number;
  elapsed: number; // ms of active play
  joy: Joystick;
  lastBump: number[]; // per-AI-index cooldown timestamps
  lastSound: number;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function freshGS(): GS {
  const player: Car = { x: W / 2, y: H - 90, vx: 0, vy: 0, color: '#22c55e', tx: 0, ty: 0, retargetAt: 0 };
  const cars: Car[] = [player];
  // Space the AI cars across the upper arena so they don't start overlapping.
  const spots = [
    { x: W * 0.28, y: H * 0.22 },
    { x: W * 0.72, y: H * 0.22 },
    { x: W * 0.3, y: H * 0.48 },
    { x: W * 0.7, y: H * 0.48 },
  ];
  for (let i = 0; i < N_AI; i++) {
    cars.push({
      x: spots[i].x,
      y: spots[i].y,
      vx: 0,
      vy: 0,
      color: CAR_COLORS[i % CAR_COLORS.length],
      tx: rnd(CAR_R, W - CAR_R),
      ty: rnd(CAR_R, H - CAR_R),
      retargetAt: 0,
    });
  }
  return {
    phase: 'play',
    cars,
    score: 0,
    elapsed: 0,
    joy: { active: false, ox: 0, oy: 0, kx: 0, ky: 0 },
    lastBump: new Array(N_AI + 1).fill(-1e9),
    lastSound: -1e9,
  };
}

function capSpeed(c: Car, max: number) {
  const s = Math.hypot(c.vx, c.vy);
  if (s > max) {
    c.vx = (c.vx / s) * max;
    c.vy = (c.vy / s) * max;
  }
}

function wallBounce(c: Car) {
  if (c.x < CAR_R) {
    c.x = CAR_R;
    c.vx = Math.abs(c.vx) * WALL_E;
  } else if (c.x > W - CAR_R) {
    c.x = W - CAR_R;
    c.vx = -Math.abs(c.vx) * WALL_E;
  }
  if (c.y < CAR_R) {
    c.y = CAR_R;
    c.vy = Math.abs(c.vy) * WALL_E;
  } else if (c.y > H - CAR_R) {
    c.y = H - CAR_R;
    c.vy = -Math.abs(c.vy) * WALL_E;
  }
}

/** One physics substep at time `now` (ms). */
function step(gs: GS, now: number) {
  const cars = gs.cars;
  const player = cars[0];

  // Player thrust from the joystick.
  if (gs.joy.active) {
    const dx = gs.joy.kx - gs.joy.ox;
    const dy = gs.joy.ky - gs.joy.oy;
    const len = Math.hypot(dx, dy);
    if (len > 4) {
      const throttle = Math.min(len / JOY_MAX, 1);
      player.vx += (dx / len) * ACCEL * throttle;
      player.vy += (dy / len) * ACCEL * throttle;
    }
  }

  // AI wander: steer toward a target, repicking periodically.
  for (let i = 1; i < cars.length; i++) {
    const c = cars[i];
    if (now >= c.retargetAt || Math.hypot(c.tx - c.x, c.ty - c.y) < 40) {
      c.tx = rnd(CAR_R, W - CAR_R);
      c.ty = rnd(CAR_R, H - CAR_R);
      c.retargetAt = now + rnd(900, 2000);
    }
    const dx = c.tx - c.x;
    const dy = c.ty - c.y;
    const d = Math.hypot(dx, dy) || 1;
    c.vx += (dx / d) * AI_ACCEL;
    c.vy += (dy / d) * AI_ACCEL;
  }

  // Integrate + friction + walls + speed caps.
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    c.vx *= FRICTION;
    c.vy *= FRICTION;
    capSpeed(c, i === 0 ? MAX_SPEED : AI_MAX);
    c.x += c.vx;
    c.y += c.vy;
    wallBounce(c);
  }

  // Car-car collisions (equal mass, elastic with restitution).
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const min = CAR_R * 2;
      if (dist >= min) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      // Separate equally.
      const overlap = min - dist;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; // <0 => approaching
      const closing = -rel;
      if (rel < 0) {
        const jimp = (-(1 + CAR_E) * rel) / 2; // equal mass
        a.vx -= jimp * nx;
        a.vy -= jimp * ny;
        b.vx += jimp * nx;
        b.vy += jimp * ny;
      }
      // Scoring: player (index 0) drives into an AI hard enough.
      if (i === 0 && closing > BUMP_SPEED) {
        const aiIdx = j;
        const playerIntoAi = a.vx * nx + a.vy * ny; // player velocity toward b
        if (playerIntoAi > 0.4 && now - gs.lastBump[aiIdx] > BUMP_COOLDOWN) {
          gs.score += 1;
          gs.lastBump[aiIdx] = now;
          if (now - gs.lastSound > 60) {
            playStroke();
            gs.lastSound = now;
          }
        }
      }
    }
  }
}

// —— drawing —————————————————————————————————————————————————————————————————
function drawCar(ctx: CanvasRenderingContext2D, c: Car, isPlayer: boolean) {
  // Rubber bumper ring.
  ctx.beginPath();
  ctx.arc(c.x, c.y, CAR_R, 0, Math.PI * 2);
  ctx.fillStyle = isPlayer ? '#052e16' : '#111a2b';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = c.color;
  ctx.stroke();
  // Body.
  ctx.beginPath();
  ctx.arc(c.x, c.y, CAR_R - 8, 0, Math.PI * 2);
  ctx.fillStyle = c.color;
  ctx.fill();
  // Heading nub in the direction of travel.
  const s = Math.hypot(c.vx, c.vy);
  if (s > 0.3) {
    const nx = c.vx / s;
    const ny = c.vy / s;
    ctx.beginPath();
    ctx.arc(c.x + nx * (CAR_R - 6), c.y + ny * (CAR_R - 6), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0f14';
    ctx.fill();
  }
}

function draw(ctx: CanvasRenderingContext2D, gs: GS) {
  ctx.clearRect(0, 0, W, H);
  // Arena floor.
  ctx.fillStyle = '#0e1626';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#2a3a55';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  // Faint floor grid for a sense of motion.
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 40; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 40; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  for (let i = gs.cars.length - 1; i >= 0; i--) drawCar(ctx, gs.cars[i], i === 0);

  // Joystick.
  if (gs.joy.active) {
    const kx = clamp(gs.joy.kx, gs.joy.ox - JOY_MAX, gs.joy.ox + JOY_MAX);
    const ky = clamp(gs.joy.ky, gs.joy.oy - JOY_MAX, gs.joy.oy + JOY_MAX);
    ctx.beginPath();
    ctx.arc(gs.joy.ox, gs.joy.oy, JOY_MAX, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(kx, ky, 20, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
  }
}

export default function BumperCars() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());

  const [phase, setPhase] = useState<Phase>('play');
  const [score, setScore] = useState(0);
  const [secs, setSecs] = useState(GAME_MS / 1000);

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
    let pushedScore = -1;
    let pushedSecs = -1;
    const frame = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(now - last, 100);
      last = now;
      acc += dt;
      gs.elapsed += dt;

      while (acc >= FIXED) {
        if (gs.phase === 'play') step(gs, now);
        acc -= FIXED;
      }

      if (gs.score !== pushedScore) {
        pushedScore = gs.score;
        setScore(gs.score);
      }
      const remain = Math.max(0, Math.ceil((GAME_MS - gs.elapsed) / 1000));
      if (remain !== pushedSecs) {
        pushedSecs = remain;
        setSecs(remain);
      }

      if (gs.elapsed >= GAME_MS) {
        gs.phase = 'done';
        setPhase('done');
        playFanfare();
      }

      draw(ctx, gs);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // Re-inits only when the play view mounts; the loop reads gsRef and pushes
    // React state only when a mirrored value (score/secs) actually changes.
  }, [playing]);

  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const p = toField(e);
      gsRef.current.joy = { active: true, ox: p.x, oy: p.y, kx: p.x, ky: p.y };
      canvasRef.current?.setPointerCapture(e.pointerId);
    },
    [toField],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (!gs.joy.active) return;
      const p = toField(e);
      gs.joy.kx = p.x;
      gs.joy.ky = p.y;
    },
    [toField],
  );
  const onPointerUp = useCallback(() => {
    gsRef.current.joy.active = false;
  }, []);

  const restart = useCallback(() => {
    gsRef.current = freshGS();
    setScore(0);
    setSecs(GAME_MS / 1000);
    setPhase('play');
  }, []);

  if (phase === 'done') {
    const remark =
      score >= 20 ? 'Demolition champ! 🏆' : score >= 12 ? 'Bumper pro! 🚗' : score >= 6 ? 'Nice driving! 👍' : 'Keep bumping! 🎮';
    return (
      <Screen>
        <TopBar title="Bumper Cars" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🚗</span>
            <div className="text-5xl font-black text-fairway-50">{score}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">bumps in 30 seconds</p>
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

  return (
    <Screen>
      <TopBar title="Bumper Cars" back="/fun" />
      <Content>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-green-400">Bumps {score}</span>
          <span className={`font-bold ${secs <= 5 ? 'text-red-400' : 'text-fairway-300'}`}>⏱ {secs}s</span>
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
          Touch and drag to steer your green car — ram the others to score bumps.
        </p>
      </Content>
    </Screen>
  );
}
