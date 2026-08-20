import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameAwards from './GameAwards';
import GameHighScore from './GameHighScore';
import { useFitCanvas } from './useFitCanvas';
import { drawLogo, logoReady } from './logo';
import { playDing, playTick, playBuzz, playFanfare } from '../../lib/sound';
import type { Particle, Floater } from './fx';
import Icon from '../../ui/Icon';
import {
  TWO_PI,
  withAlpha,
  drawShadow,
  spawnBurst,
  stepParticles,
  drawParticles,
  spawnFloater,
  stepFloaters,
  drawFloaters,
  makeCachedLayer,
  fxRandom,
} from './fx';
import {
  W,
  H,
  FENCE,
  PEN_Y,
  GATE_X0,
  GATE_X1,
  FLOCK,
  ROUND_MS,
  DOG_R,
  clamp,
  freshSim,
  stepDog,
  stepSheep,
  type Sim,
  type Sheep,
} from './sheepSim';

// §23 Sheep Drive — a herding mini-game. Tap or drag to send the sheepdog;
// sheep flee the dog and flock with each other (the boids sim in flocking.ts —
// alignment-led, so a moving herd STREAMS rather than balling up around its
// center of mass). Drive the whole flock through the gate into the pen before
// the clock runs out. The round sim lives in sheepSim.ts (tested headless,
// including a scripted drover that proves the round is winnable); this file is
// the screen: input, drawing, sound, and the end-screen furniture.
// Canvas-rendered, client-side, offline.

type Phase = 'ready' | 'play' | 'done';

type GS = {
  phase: Phase;
  sim: Sim;
  timeLeft: number; // ms, dt-driven (freezes while the tab is hidden)
  endedClean: boolean; // every sheep penned before the horn
};

function freshGS(): GS {
  return { phase: 'ready', sim: freshSim(), timeLeft: ROUND_MS, endedClean: false };
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
type FX = { particles: Particle[]; floaters: Floater[]; dustIn: number };
function freshFX(): FX {
  return { particles: [], floaters: [], dustIn: 0 };
}

function updateFX(fx: FX, gs: GS, dt: number) {
  fx.particles = stepParticles(fx.particles, dt, 0.02);
  fx.floaters = stepFloaters(fx.floaters, dt);
  // A little dust off the dog's paws while it's running.
  fx.dustIn -= dt;
  const d = gs.sim.dog;
  if (fx.dustIn <= 0 && Math.hypot(d.tx - d.x, d.ty - d.y) > 12) {
    spawnBurst(fx.particles, d.x - Math.cos(d.heading) * 8, d.y - Math.sin(d.heading) * 8, 2, 40, '#c8b89a');
    fx.dustIn = 90 + fxRandom() * 90;
  }
}

// —— drawing —————————————————————————————————————————————————————————————————
/** Static pasture: grass, mowing bands, tufts, both fences, the pen floor and
 *  the venue mark. All offsets index-derived — this paints once into a layer. */
function paintPasture(ctx: CanvasRenderingContext2D) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#3c7d33');
  bg.addColorStop(1, '#295c24');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Mowing bands, then grass tufts.
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let y = PEN_Y; y < H; y += 88) ctx.fillRect(0, y, W, 44);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 110; i++) {
    const x = 6 + ((i * 97) % (W - 12));
    const y = 6 + ((i * 61) % (H - 12));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 1.5, y - 3);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 1.5, y - 3);
    ctx.stroke();
  }

  // Pen floor: straw-worn dirt so the target area reads before the fence does.
  ctx.fillStyle = 'rgba(124,90,53,0.35)';
  ctx.fillRect(FENCE, FENCE, W - FENCE * 2, PEN_Y - FENCE);
  ctx.fillStyle = 'rgba(253,230,138,0.10)';
  ctx.fillRect(FENCE, FENCE, W - FENCE * 2, PEN_Y - FENCE);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('THE PEN', W / 2, FENCE + 20);
  ctx.restore();

  drawLogo(ctx, W / 2, 330, { width: 130, tint: '#f1f5f9', alpha: 0.3 });

  // Fences: outer ring, then the pen rail broken at the gate.
  const rail = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  rail(FENCE, FENCE, W - FENCE, FENCE);
  rail(FENCE, FENCE, FENCE, H - FENCE);
  rail(W - FENCE, FENCE, W - FENCE, H - FENCE);
  rail(FENCE, H - FENCE, W - FENCE, H - FENCE);
  rail(FENCE, PEN_Y, GATE_X0, PEN_Y);
  rail(GATE_X1, PEN_Y, W - FENCE, PEN_Y);
  // Posts.
  ctx.fillStyle = '#6f4620';
  for (let x = FENCE; x <= W - FENCE; x += 33) {
    ctx.fillRect(x - 2, FENCE - 4, 4, 8);
    ctx.fillRect(x - 2, H - FENCE - 4, 4, 8);
    if (x <= GATE_X0 || x >= GATE_X1) ctx.fillRect(x - 2, PEN_Y - 4, 4, 8);
  }
  for (let y = FENCE; y <= H - FENCE; y += 33) {
    ctx.fillRect(FENCE - 2, y - 2, 4, 4);
    ctx.fillRect(W - FENCE - 2, y - 2, 4, 4);
  }
  // Gate posts, taller, so the opening reads as a gate and not a gap.
  ctx.fillStyle = '#a16a35';
  ctx.fillRect(GATE_X0 - 3, PEN_Y - 7, 6, 14);
  ctx.fillRect(GATE_X1 - 3, PEN_Y - 7, 6, 14);
}

const pastureLayer = makeCachedLayer(W, H, paintPasture);

function drawSheep(ctx: CanvasRenderingContext2D, s: Sheep) {
  drawShadow(ctx, s.x, s.y + 5, 7, 3, 0.22);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.heading);
  // Wool body: two offset lobes read as fleece at this size.
  const wool = s.dark ? '#4d4742' : '#efe9db';
  const woolDark = s.dark ? '#332e2a' : '#c9c2b0';
  ctx.fillStyle = woolDark;
  ctx.beginPath();
  ctx.ellipse(0, 0, 7.2, 5.4, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = wool;
  ctx.beginPath();
  ctx.ellipse(-1, -0.8, 6.4, 4.6, 0, 0, TWO_PI);
  ctx.fill();
  // Head, ears.
  const hide = s.dark ? '#211d1a' : '#3f3a35';
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.ellipse(6.6, 0, 3, 2.3, 0, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(5.4, -2.4, 1.5, 0.9, -0.5, 0, TWO_PI);
  ctx.ellipse(5.4, 2.4, 1.5, 0.9, 0.5, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawDog(ctx: CanvasRenderingContext2D, gs: GS) {
  const d = gs.sim.dog;
  drawShadow(ctx, d.x, d.y + 5, 8, 3, 0.25);
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.heading);
  // Border-collie colors: dark body, white chest blaze and tail tip.
  ctx.fillStyle = '#1f2430';
  ctx.beginPath();
  ctx.ellipse(0, 0, 8.4, 4.4, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = '#e7e3da';
  ctx.beginPath();
  ctx.ellipse(3.2, 0, 3.2, 2.4, 0, 0, TWO_PI);
  ctx.fill();
  // Head + ears.
  ctx.fillStyle = '#161a24';
  ctx.beginPath();
  ctx.ellipse(8.6, 0, 3.4, 2.6, 0, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(7, -2.2);
  ctx.lineTo(9.6, -3.4);
  ctx.lineTo(9.2, -1);
  ctx.moveTo(7, 2.2);
  ctx.lineTo(9.6, 3.4);
  ctx.lineTo(9.2, 1);
  ctx.fill();
  // Tail.
  ctx.strokeStyle = '#1f2430';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-7.5, 0);
  ctx.quadraticCurveTo(-11, -1.5, -12, -4);
  ctx.stroke();
  ctx.strokeStyle = '#e7e3da';
  ctx.beginPath();
  ctx.moveTo(-11.4, -2.8);
  ctx.lineTo(-12, -4);
  ctx.stroke();
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);
  const layer = pastureLayer(logoReady());
  if (layer) ctx.drawImage(layer, 0, 0, W, H);
  else paintPasture(ctx);

  // Where the dog is headed — a fading whistle ring while it's still running.
  const d = gs.sim.dog;
  const toGo = Math.hypot(d.tx - d.x, d.ty - d.y);
  if (gs.phase === 'play' && toGo > 10) {
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.012);
    ctx.strokeStyle = withAlpha('#fde68a', 0.25 + 0.3 * pulse);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(d.tx, d.ty, 7 + pulse * 3, 0, TWO_PI);
    ctx.stroke();
  }

  // Painter's order down the field so overlaps read correctly.
  const bodies: Array<{ y: number; paint: () => void }> = gs.sim.sheep.map((s) => ({
    y: s.y,
    paint: () => drawSheep(ctx, s),
  }));
  bodies.push({ y: d.y, paint: () => drawDog(ctx, gs) });
  bodies.sort((a, b) => a.y - b.y);
  for (const b of bodies) b.paint();

  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
}

export default function SheepDrive() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('ready');
  const [penned, setPenned] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_MS / 1000);
  // One id per played round — the ticket award's idempotency key.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const active = phase !== 'done';
  useFitCanvas(canvasRef, W, H, active);

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
    // The round clock is a dt-decremented countdown, so freezing time while
    // hidden only needs `last` kept fresh — same pattern as WaterGunRace
    // (hidden-rAF branch plus a visibilitychange reset for mobile browsers
    // that suspend rAF entirely).
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        hiddenAt = 0;
        last = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const frame = (now: number) => {
      const gs = gsRef.current;
      const fx = fxRef.current;
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(now - last, 100);
      last = now;

      if (gs.phase === 'play') {
        gs.timeLeft -= dt;
        stepDog(gs.sim, dt);
        const newlyPenned = stepSheep(gs.sim, dt);
        for (const s of newlyPenned) {
          playDing();
          spawnBurst(fx.particles, s.x, s.y, 10, 130, '#fde68a');
          spawnFloater(fx.floaters, s.x, s.y - 14, `${gs.sim.penned}/${FLOCK}`, '#fde68a', {
            size: 16,
          });
        }
        if (newlyPenned.length) setPenned(gs.sim.penned);

        if (gs.sim.penned >= FLOCK) {
          gs.endedClean = true;
          gs.phase = 'done';
          playFanfare();
          setPhase('done');
        } else if (gs.timeLeft <= 0) {
          gs.timeLeft = 0;
          gs.phase = 'done';
          playBuzz();
          setPhase('done');
        }
        setSecondsLeft(Math.max(0, Math.ceil(gs.timeLeft / 1000)));
      }

      updateFX(fx, gs, dt);
      draw(ctx, gs, fx, now);
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
      x: clamp(((e.clientX - rect.left) / rect.width) * W, FENCE + DOG_R, W - FENCE - DOG_R),
      // The dog works the field, never the pen — it stops at the fence.
      y: clamp(((e.clientY - rect.top) / rect.height) * H, PEN_Y + DOG_R, H - FENCE - DOG_R),
    };
  }, []);

  const send = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (gs.phase !== 'play') return;
      const p = toField(e);
      gs.sim.dog.tx = p.x;
      gs.sim.dog.ty = p.y;
    },
    [toField],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      canvasRef.current?.setPointerCapture(e.pointerId);
      if (gsRef.current.phase === 'play') playTick();
      send(e);
    },
    [send],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons > 0 || e.pointerType === 'touch') send(e);
    },
    [send],
  );

  const start = useCallback(() => {
    const gs = freshGS();
    gs.phase = 'play';
    gsRef.current = gs;
    fxRef.current = freshFX();
    setPhase('play');
    setPenned(0);
    setSecondsLeft(ROUND_MS / 1000);
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    const gs = gsRef.current;
    const count = gs.sim.penned;
    const won = count >= FLOCK * 0.75;
    // Time counts only on a clean sweep — otherwise the round used it all.
    const bonus = gs.endedClean ? Math.ceil(gs.timeLeft / 1000) : 0;
    const score = count * 100 + bonus;
    const remark = gs.endedClean
      ? `Clean sweep with ${bonus}s to spare — not one ewe left out! 🐑`
      : won
        ? 'A fine day in the field — the stragglers can graze.'
        : count >= FLOCK / 2
          ? 'Half a flock penned, half still out there…'
          : 'The sheep won this one. Whistle the dog back and go again!';
    return (
      <Screen>
        <TopBar title="Sheep Drive" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <Icon name={won ? 'state.win' : 'state.lose'} className="text-6xl" />
            <div className="text-2xl font-black text-fairway-50">
              {gs.endedClean ? 'Flock all penned!' : won ? 'Good drive!' : 'Scattered flock'}
            </div>
            <div className="text-4xl font-black text-fairway-50">
              {count} <span className="text-fairway-400">/ {FLOCK} penned</span>
            </div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-100/70">
              Score: <b className="text-fairway-50">{score}</b>
              {bonus > 0 && <span> — includes a {bonus}-point time bonus</span>}
            </p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (8 per sheep penned; a clean sweep rounds up to the max 100). */}
          <GameAwards
            game="sheepdrive"
            tickets={gs.endedClean ? 100 : count * 8}
            sessionId={sessionId}
          />
          <GameHighScore game="sheepdrive" score={score} sessionId={sessionId} />
          <div className="mt-8">
            <Button onClick={start} sound="none">
              Play again
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  const hint =
    phase === 'ready'
      ? 'Tap the field to send the dog. Sheep run from the dog — steer the flock, don’t chase it.'
      : penned === 0
        ? 'Work from behind the flock and push it toward the gate.'
        : penned >= FLOCK - 2
          ? 'Almost there — ease the last few through the gate.'
          : 'Keep the herd moving with the flow — no need to chase strays.';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Sheep Drive" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Penned <span className="text-fairway-100">{penned}</span>
          <span className="font-normal text-fairway-400"> / {FLOCK}</span>
        </span>
        <span className={`tabular-nums font-bold ${secondsLeft <= 10 ? 'text-danger' : 'text-fairway-100'}`}>
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          className="col-start-1 row-start-1 block touch-none rounded-2xl arcade-screen"
        />
        {phase === 'ready' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <Icon name="game.sheep-drive" className="text-5xl" />
            <p className="text-sm text-fairway-100">
              Tap or drag to send your sheepdog — the flock runs away from it. Herd all{' '}
              {FLOCK} sheep through the gate into the pen before the minute is up. Finish early
              for a time bonus.
            </p>
            <Button onClick={start}>Start</Button>
          </div>
        )}
      </div>

      <p className="flex h-16 shrink-0 items-center justify-center px-4 pb-4 pt-3 text-center text-sm text-fairway-100/80">
        <span className="line-clamp-2">{hint}</span>
      </p>
    </div>
  );
}
