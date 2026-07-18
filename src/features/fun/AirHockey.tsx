import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playStroke, playCup, playUndo, playFanfare } from '../../lib/sound';

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
type Phase = 'serve' | 'play' | 'done';
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

/** One physics substep. Returns 'you' | 'cpu' if a goal was scored, else null.
 *  `hit` is set true (by ref) if the puck struck a mallet this step. */
function step(gs: GS, hitRef: { v: boolean }): 'you' | 'cpu' | null {
  const p = gs.puck;

  // —— CPU mallet AI: chase the puck when it's in the CPU half, else guard the
  // goal. Capped speed keeps it beatable.
  {
    const ai = gs.ai;
    ai.px = ai.x;
    ai.py = ai.y;
    let tx: number;
    let ty: number;
    if (p.y < H * 0.55) {
      tx = p.x;
      ty = clamp(p.y - 4, PAD_R + 2, MID - PAD_R - 4);
    } else {
      tx = W / 2 + (p.x - W / 2) * 0.4; // loosely track the puck's x to guard
      ty = 70;
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
  if (malletHit(p, gs.ai)) hitRef.v = true;

  capSpeed(p, PUCK_MAX);
  return null;
}

// —— drawing —————————————————————————————————————————————————————————————————
function draw(ctx: CanvasRenderingContext2D, gs: GS) {
  ctx.clearRect(0, 0, W, H);

  // Table.
  ctx.fillStyle = '#0e1a2b';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#2a3a55';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

  // Center line + circle.
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, MID);
  ctx.lineTo(W, MID);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, MID, 46, 0, Math.PI * 2);
  ctx.stroke();

  // Goals (mouths in the end walls).
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(GOAL_X0, 2.5);
  ctx.lineTo(GOAL_X1, 2.5);
  ctx.moveTo(GOAL_X0, H - 2.5);
  ctx.lineTo(GOAL_X1, H - 2.5);
  ctx.stroke();

  // Mallets.
  const mallet = (x: number, y: number, color: string) => {
    ctx.beginPath();
    ctx.arc(x, y, PAD_R, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, PAD_R * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
  };
  mallet(gs.ai.x, gs.ai.y, '#ef4444');
  mallet(gs.player.x, gs.player.y, '#22c55e');

  // Puck.
  ctx.beginPath();
  ctx.arc(gs.puck.x, gs.puck.y, PUCK_R, 0, Math.PI * 2);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // "Get ready" flash on serve.
  if (gs.phase === 'serve') {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Get ready…', W / 2, MID - 80);
  }
}

export default function AirHockey() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS(0));

  const [phase, setPhase] = useState<Phase>('serve');
  const [you, setYou] = useState(0);
  const [cpu, setCpu] = useState(0);

  const playing = phase !== 'done';

  // Render + physics loop (fixed-timestep accumulator).
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
    const frame = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      acc += Math.min(now - last, 100); // clamp to avoid a spiral after a stall
      last = now;

      if (gs.phase === 'serve' && now >= gs.serveAt) serve(gs);

      const hitRef = { v: false };
      let goal: 'you' | 'cpu' | null = null;
      while (acc >= FIXED) {
        if (gs.phase === 'play') {
          const r = step(gs, hitRef);
          if (r) {
            goal = r;
            break;
          }
        }
        acc -= FIXED;
      }
      if (hitRef.v) playStroke();

      if (goal) {
        acc = 0;
        if (goal === 'you') {
          gs.you += 1;
          gs.serveDir = -1; // serve away toward the CPU next
          setYou(gs.you);
          playCup();
        } else {
          gs.cpu += 1;
          gs.serveDir = 1;
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

      draw(ctx, gs);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
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

  const restart = useCallback(() => {
    gsRef.current = freshGS(performance.now());
    setYou(0);
    setCpu(0);
    setPhase('serve');
  }, []);

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
      <TopBar title="Air Hockey" back="/fun" />
      <Content>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-red-400">CPU {cpu}</span>
          <span className="text-fairway-400">First to {TARGET}</span>
          <span className="font-bold text-green-400">You {you}</span>
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
          Drag your green mallet to hit the puck into the CPU's goal at the top.
        </p>
      </Content>
    </Screen>
  );
}
