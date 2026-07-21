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

// §12 Air Hockey — the second attraction mini-game. Drag your mallet in the
// bottom half to defend your goal and slam the puck into the CPU's; first to 7
// wins. Real-time canvas physics, all client-side, works offline.
//
// Physics runs on a fixed-timestep accumulator so it's framerate-independent and
// the fast puck never tunnels through a mallet or wall; the clock pauses when the
// tab/app is backgrounded (PWA/Capacitor lifecycle), same as Skee-Ball.

// —— Table + physics (logical units; the canvas scales to fit) ————————————————
const W = 340;
const H = 560;
const PUCK_R = 13;
const PAD_R = 28;
const GOAL_W = 150;
const GOAL_X0 = (W - GOAL_W) / 2;
const GOAL_X1 = (W + GOAL_W) / 2;
const MID = H / 2;

const TARGET = 7; // goals to win
const FIXED = 1000 / 120; // physics substep (ms)
const PUCK_MAX = 7.2; // max puck speed (units/step)
const PUCK_MIN_HIT = 3.4; // floor speed after a mallet strike so it never stalls
const SERVE_SPEED = 3.4;
const AI_SPEED = 4.2; // CPU mallet max speed (units/step) — kept beatable
const SERVE_DELAY = 850; // pause at center before the puck launches

type Vec = { x: number; y: number };
type Pad = { x: number; y: number; px: number; py: number }; // p* = previous pos
type Phase = 'ready' | 'serve' | 'play' | 'done';
type GS = {
  phase: Phase;
  puck: { x: number; y: number; vx: number; vy: number };
  player: Pad;
  ai: Pad;
  you: number;
  cpu: number;
  serveAt: number; // timestamp to launch the next serve
  serveDir: number; // -1 up (toward CPU), +1 down (toward you)
  pointer: Vec | null; // latest finger target for the player mallet
  aiRetreatUntil: number; // after a strike, defend until this time (no re-chase)
};

const inGoalX = (x: number) => x > GOAL_X0 && x < GOAL_X1;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function centeredPuck() {
  return { x: W / 2, y: H / 2, vx: 0, vy: 0 };
}

function freshGS(now: number): GS {
  return {
    phase: 'serve',
    puck: centeredPuck(),
    player: { x: W / 2, y: H - 70, px: W / 2, py: H - 70 },
    ai: { x: W / 2, y: 70, px: W / 2, py: 70 },
    you: 0,
    cpu: 0,
    serveAt: now + SERVE_DELAY,
    serveDir: -1,
    pointer: null,
    aiRetreatUntil: 0,
  };
}

/** Launch the puck from center toward `dir` (−1 up / +1 down) with a little
 *  lateral spread so serves aren't identical. */
function serve(gs: GS) {
  const spread = (Math.random() * 2 - 1) * 1.8;
  gs.puck = { x: W / 2, y: H / 2, vx: spread, vy: gs.serveDir * SERVE_SPEED };
  gs.phase = 'play';
}

function capSpeed(p: { vx: number; vy: number }, max: number, min = 0) {
  const s = Math.hypot(p.vx, p.vy);
  if (s > max) {
    p.vx = (p.vx / s) * max;
    p.vy = (p.vy / s) * max;
  } else if (min > 0 && s > 0 && s < min) {
    p.vx = (p.vx / s) * min;
    p.vy = (p.vy / s) * min;
  }
}

/** Resolve a puck↔mallet collision: separate, reflect off the contact normal,
 *  and add the mallet's motion so a moving strike drives the puck. Returns true
 *  on contact (for the hit sound). */
function malletHit(puck: GS['puck'], pad: Pad): boolean {
  const dx = puck.x - pad.x;
  const dy = puck.y - pad.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const minDist = PUCK_R + PAD_R;
  if (dist >= minDist) return false;
  const nx = dx / dist;
  const ny = dy / dist;
  // Push the puck to the mallet's edge.
  puck.x = pad.x + nx * minDist;
  puck.y = pad.y + ny * minDist;
  // Reflect velocity about the normal.
  const vDotN = puck.vx * nx + puck.vy * ny;
  puck.vx -= 2 * vDotN * nx;
  puck.vy -= 2 * vDotN * ny;
  // Add the mallet's velocity along the normal (the "slam").
  const padVx = pad.x - pad.px;
  const padVy = pad.y - pad.py;
  puck.vx += padVx * 0.9 + nx * 0.6;
  puck.vy += padVy * 0.9 + ny * 0.6;
  capSpeed(puck, PUCK_MAX, PUCK_MIN_HIT);
  return true;
}

/** One physics substep at time `now` (ms). Returns 'you' | 'cpu' if a goal was
 *  scored, else null. `hit` is set true (by ref) if the puck struck a mallet. */
function step(gs: GS, hitRef: { v: boolean }, now: number): 'you' | 'cpu' | null {
  const p = gs.puck;

  // —— CPU mallet AI. Rather than glue itself to the puck (which reads as
  // "catching and chasing"), it strikes from BEHIND and then retreats to guard
  // its goal, giving a natural hit-and-recover rhythm. Home position tracks the
  // puck's x so it still defends. Capped speed keeps it beatable.
  {
    const ai = gs.ai;
    ai.px = ai.x;
    ai.py = ai.y;
    const homeX = clamp(W / 2 + (p.x - W / 2) * 0.5, PAD_R, W - PAD_R);
    const homeY = 66;
    // Attack only when the puck is on the CPU's side of the rink and isn't
    // already racing away toward the player's goal.
    const attackable = p.y < MID - PUCK_R && p.vy < 1.5;
    let tx: number;
    let ty: number;
    if (now < gs.aiRetreatUntil || !attackable) {
      tx = homeX;
      ty = homeY;
    } else {
      // Aim just behind the puck (above it, toward the CPU goal) so the mallet
      // drives DOWN through it toward the player's goal instead of hovering on
      // top of it. The retreat is committed only once an actual hit lands (see
      // below), so a slow or glancing puck that comes near but isn't struck is
      // still pursued rather than abandoned mid-approach.
      tx = p.x;
      ty = p.y - (PAD_R + PUCK_R) + 6;
    }
    const dx = tx - ai.x;
    const dy = ty - ai.y;
    const d = Math.hypot(dx, dy);
    if (d > AI_SPEED) {
      ai.x += (dx / d) * AI_SPEED;
      ai.y += (dy / d) * AI_SPEED;
    } else {
      ai.x = tx;
      ai.y = ty;
    }
    ai.x = clamp(ai.x, PAD_R, W - PAD_R);
    ai.y = clamp(ai.y, PAD_R + 2, MID - PAD_R - 2);
  }

  // —— Player mallet: snap toward the finger, clamped to the bottom half.
  {
    const pl = gs.player;
    pl.px = pl.x;
    pl.py = pl.y;
    if (gs.pointer) {
      pl.x = clamp(gs.pointer.x, PAD_R, W - PAD_R);
      pl.y = clamp(gs.pointer.y, MID + 2, H - PAD_R - 2);
    }
  }

  // —— Puck integration.
  p.x += p.vx;
  p.y += p.vy;

  // Side walls.
  if (p.x < PUCK_R) {
    p.x = PUCK_R;
    p.vx = Math.abs(p.vx);
  } else if (p.x > W - PUCK_R) {
    p.x = W - PUCK_R;
    p.vx = -Math.abs(p.vx);
  }

  // Top wall / CPU goal.
  if (p.y < PUCK_R) {
    if (inGoalX(p.x)) {
      if (p.y < -PUCK_R) return 'you'; // through the CPU goal
    } else {
      p.y = PUCK_R;
      p.vy = Math.abs(p.vy);
    }
  }
  // Bottom wall / your goal.
  if (p.y > H - PUCK_R) {
    if (inGoalX(p.x)) {
      if (p.y > H + PUCK_R) return 'cpu'; // through your goal
    } else {
      p.y = H - PUCK_R;
      p.vy = -Math.abs(p.vy);
    }
  }

  // Mallet collisions.
  if (malletHit(p, gs.player)) hitRef.v = true;
  if (malletHit(p, gs.ai)) {
    hitRef.v = true;
    // Struck the puck away — now retreat to guard the goal before attacking again.
    gs.aiRetreatUntil = now + 380;
  }

  capSpeed(p, PUCK_MAX);
  return null;
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the fixed-timestep sim is never touched; they're
// advanced per animation frame with a real dt and only ever paint pixels. Built
// on the shared ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent puck positions → motion streak
  particles: Particle[]; // spark bursts on hits/goals
  shake: number; // camera shake magnitude (px), decays to 0
  flash: number; // goal flash 0..1, decays to 0
  flashColor: string;
};

function freshFX(): FX {
  return { trail: [], particles: [], shake: 0, flash: 0, flashColor: '#ffffff' };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, gs: GS, dt: number) {
  pushTrail(fx.trail, gs.puck.x, gs.puck.y);
  fx.particles = stepParticles(fx.particles, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** A domed, top-lit mallet: ground shadow, lit body + rim, inner knob. */
function drawMallet(ctx: CanvasRenderingContext2D, x: number, y: number, light: string, base: string, dark: string) {
  drawShadow(ctx, x, y + 6, PAD_R * 0.95, PAD_R * 0.5);
  drawSphere(ctx, x, y, PAD_R, light, base, dark, { rim: true });
  drawSphere(ctx, x, y, PAD_R * 0.5, light, base, dark, { specular: false });
}

/** A glossy puck: ground shadow, lit body, incised ring, specular hotspot. */
function drawPuck(ctx: CanvasRenderingContext2D, x: number, y: number) {
  drawShadow(ctx, x, y + 5, PUCK_R * 0.95, PUCK_R * 0.55, 0.4);
  drawSphere(ctx, x, y, PUCK_R, '#ffffff', '#dbe4ee', '#8b97a6');
  ctx.beginPath();
  ctx.arc(x, y, PUCK_R * 0.62, 0, TWO_PI);
  ctx.strokeStyle = 'rgba(80,95,115,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX) {
  ctx.clearRect(0, 0, W, H);

  // —— Table surface: a polished icy rink, top-lit ——
  const surf = ctx.createLinearGradient(0, 0, 0, H);
  surf.addColorStop(0, '#12233b');
  surf.addColorStop(0.5, '#0d1a2c');
  surf.addColorStop(1, '#0a1524');
  ctx.fillStyle = surf;
  ctx.fillRect(0, 0, W, H);

  // Soft overhead sheen.
  const sheen = ctx.createRadialGradient(W / 2, H * 0.28, 20, W / 2, H * 0.28, H * 0.72);
  sheen.addColorStop(0, 'rgba(120,170,220,0.16)');
  sheen.addColorStop(1, 'rgba(120,170,220,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  // Corner vignette for depth.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // —— Rink rails (beveled border) ——
  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(9,15,25,0.9)';
  roundRectPath(ctx, 3, 3, W - 6, H - 6, 16);
  ctx.stroke();
  ctx.lineWidth = 2;
  const rail = ctx.createLinearGradient(0, 0, W, 0);
  rail.addColorStop(0, 'rgba(120,170,220,0.35)');
  rail.addColorStop(0.5, 'rgba(185,220,255,0.55)');
  rail.addColorStop(1, 'rgba(120,170,220,0.35)');
  ctx.strokeStyle = rail;
  roundRectPath(ctx, 5, 5, W - 10, H - 10, 14);
  ctx.stroke();
  ctx.restore();

  // —— Center line + face-off circle, glowing ——
  ctx.save();
  ctx.strokeStyle = 'rgba(120,190,255,0.28)';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(90,170,255,0.7)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(10, MID);
  ctx.lineTo(W - 10, MID);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, MID, 46, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, MID, 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120,190,255,0.4)';
  ctx.fill();
  ctx.restore();

  // —— Goals: glowing neon mouths (cyan = CPU end, green = your end) ——
  neonLine(ctx, GOAL_X0, 4, GOAL_X1, 4, '#38bdf8', 5, 16);
  neonLine(ctx, GOAL_X0, H - 4, GOAL_X1, H - 4, '#22c55e', 5, 16);

  // —— Dynamic layer (shaken on goals) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Puck motion trail (drawn under everything moving).
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, PUCK_R * (0.3 + k * 0.65), 0, TWO_PI);
    ctx.fillStyle = `rgba(150,210,255,${0.02 + k * 0.1})`;
    ctx.fill();
  }

  drawMallet(ctx, gs.ai.x, gs.ai.y, '#fca5a5', '#ef4444', '#7f1d1d');
  drawMallet(ctx, gs.player.x, gs.player.y, '#86efac', '#22c55e', '#14532d');
  drawPuck(ctx, gs.puck.x, gs.puck.y);

  drawParticles(ctx, fx.particles);
  ctx.restore();

  // —— Goal flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.25);
    ctx.fillRect(0, 0, W, H);
  }

  // "Get ready" flash on serve.
  if (gs.phase === 'serve') {
    ctx.save();
    ctx.fillStyle = 'rgba(230,245,255,0.92)';
    ctx.shadowColor = 'rgba(90,170,255,0.9)';
    ctx.shadowBlur = 12;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Get ready…', W / 2, MID - 80);
    ctx.restore();
  }
}

export default function AirHockey() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS(0));
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('ready');
  const [you, setYou] = useState(0);
  const [cpu, setCpu] = useState(0);

  const active = phase !== 'ready' && phase !== 'done';
  useFitCanvas(canvasRef, W, H, active);

  // Render + physics loop (fixed-timestep accumulator).
  useEffect(() => {
    if (!active) return;
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
    // Pause via visibilitychange, not a hidden-rAF branch: mobile browsers
    // suspend requestAnimationFrame while backgrounded, so a hidden frame may
    // never run to keep `last` fresh — the first visible frame would then
    // simulate the whole capped catch-up window and the puck could jump or
    // score. Reset the accumulator on resume and shift the serve delay.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        gsRef.current.serveAt += performance.now() - hiddenAt;
        hiddenAt = 0;
        last = performance.now();
        acc = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const frame = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(now - last, 100); // clamp to avoid a spiral after a stall
      acc += dt;
      last = now;

      if (gs.phase === 'serve' && now >= gs.serveAt) serve(gs);

      const hitRef = { v: false };
      let goal: 'you' | 'cpu' | null = null;
      while (acc >= FIXED) {
        if (gs.phase === 'play') {
          const r = step(gs, hitRef, now);
          if (r) {
            goal = r;
            break;
          }
        }
        acc -= FIXED;
      }
      const fx = fxRef.current;
      if (hitRef.v) {
        playStroke();
        spawnBurst(fx.particles, gs.puck.x, gs.puck.y, 8, 150, '#cfe8ff');
      }

      if (goal) {
        acc = 0;
        fx.shake = 7;
        fx.flash = 1;
        fx.trail.length = 0;
        if (goal === 'you') {
          gs.you += 1;
          gs.serveDir = -1; // serve away toward the CPU next
          fx.flashColor = '#38bdf8';
          spawnBurst(fx.particles, W / 2, 12, 28, 320, '#7dd3fc');
          setYou(gs.you);
          playCup();
        } else {
          gs.cpu += 1;
          gs.serveDir = 1;
          fx.flashColor = '#ef4444';
          spawnBurst(fx.particles, W / 2, H - 12, 28, 320, '#fca5a5');
          setCpu(gs.cpu);
          playUndo();
        }
        if (gs.you >= TARGET || gs.cpu >= TARGET) {
          gs.phase = 'done';
          setPhase('done');
          playFanfare();
        } else {
          gs.puck = centeredPuck();
          gs.ai.x = W / 2;
          gs.ai.y = 70;
          gs.phase = 'serve';
          gs.serveAt = now + SERVE_DELAY;
        }
      }

      updateFX(fx, gs, dt);
      draw(ctx, gs, fx);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);

  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      gsRef.current.pointer = toField(e);
      canvasRef.current?.setPointerCapture(e.pointerId);
    },
    [toField],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (gsRef.current.pointer) gsRef.current.pointer = toField(e);
    },
    [toField],
  );
  const onPointerUp = useCallback(() => {
    gsRef.current.pointer = null;
  }, []);

  const start = useCallback(() => {
    gsRef.current = freshGS(performance.now());
    fxRef.current = freshFX();
    setYou(0);
    setCpu(0);
    setPhase('serve');
  }, []);

  if (phase === 'ready') {
    return (
      <Screen>
        <TopBar title="Air Hockey" back="/fun" />
        <Content>
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🏒</span>
            <div className="text-2xl font-black text-fairway-50">Air Hockey</div>
            <p className="text-sm text-fairway-300">
              Drag your green mallet to hit the puck into the CPU's goal at the top.
            </p>
            <p className="text-sm text-fairway-400">First to {TARGET} wins.</p>
          </div>
          <div className="mt-8">
            <Button onClick={start}>Start</Button>
          </div>
        </Content>
      </Screen>
    );
  }

  if (phase === 'done') {
    const won = you > cpu;
    return (
      <Screen>
        <TopBar title="Air Hockey" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">{won ? '🏆' : '🤖'}</span>
            <div className="text-2xl font-black text-fairway-50">{won ? 'You win!' : 'CPU wins'}</div>
            <div className="text-4xl font-black text-fairway-50">
              {you} <span className="text-fairway-400">–</span> {cpu}
            </div>
          </div>
          <div className="mt-8">
            <Button onClick={start} sound="none">
              Play again
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Air Hockey" back="/fun" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-red-400">CPU {cpu}</span>
        <span className="text-fairway-400">First to {TARGET}</span>
        <span className="font-bold text-green-400">You {you}</span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="block touch-none rounded-2xl border border-fairway-800"
        />
      </div>

      <p className="flex h-16 shrink-0 items-center justify-center px-4 pb-4 pt-3 text-center text-sm text-fairway-100/80">
        <span className="line-clamp-2">
          Drag your green mallet to hit the puck into the CPU's goal at the top.
        </span>
      </p>
    </div>
  );
}
