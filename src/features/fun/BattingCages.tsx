import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useFitCanvas } from './useFitCanvas';
import { playStroke, playUndo, playFanfare } from '../../lib/sound';
import type { Particle, Vec as FxVec } from './fx';
import {
  TWO_PI,
  withAlpha,
  roundRectPath,
  drawShadow,
  drawSphere,
  spawnBurst,
  stepParticles,
  drawParticles,
  pushTrail,
  decay,
  shakeOffset,
} from './fx';

// §12 Batting Cages — the fifth attraction mini-game. Balls are pitched down the
// cage at varying speeds; tap to swing and time your contact at the plate. Nail
// it for a home run, catch it a hair off for a hit, whiff for a strike. Ten
// pitches. Timing-skill, canvas-rendered, client-side, offline.

// —— Cage geometry (logical units; the canvas scales to fit) ——————————————————
const W = 340;
const H = 560;
const MOUND_Y = 72;
const PLATE_Y = 464; // the ideal contact line
const BALL_R = 11;

// Swing timing windows around the ideal contact time (ms).
const PERFECT = 70; // → home run
const GOOD = 145; // → hit
const CONTACT = 215; // → foul (contact, no score)
const LATE_CUTOFF = 240; // ms past ideal with no swing → strike

const PITCHES = 10;
const RESULT_MS = 780; // hold on the outcome before the next pitch
const TRAVEL_MIN = 880;
const TRAVEL_MAX = 1360;
// Randomized beat between the batter holding down and the ball leaving the
// mound, so the release can't be timed off the press alone.
const DELAY_MIN = 250;
const DELAY_MAX = 900;

type Kind = 'hr' | 'hit' | 'foul' | 'miss';
type Outcome = { label: string; pts: number; kind: Kind };
type Phase = 'pitch' | 'result' | 'done';
type Ball = { x: number; y: number; vx: number; vy: number };
type GS = {
  phase: Phase;
  pitchNo: number; // 0-based
  total: number;
  pitchStart: number;
  travelMs: number;
  loaded: boolean; // batter is holding, bat wound back
  loadAt: number;
  swung: boolean;
  swingAt: number;
  ball: Ball;
  outcome: Outcome | null;
  resultAt: number;
};

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function newPitch(gs: GS) {
  gs.phase = 'pitch';
  gs.pitchStart = 0; // 0 → not pitched yet; holding down to load starts the pitch
  gs.travelMs = rnd(TRAVEL_MIN, TRAVEL_MAX);
  gs.loaded = false;
  gs.loadAt = 0;
  gs.swung = false;
  gs.swingAt = 0;
  gs.outcome = null;
  gs.ball = { x: W / 2, y: MOUND_Y, vx: 0, vy: 0 };
}

function freshGS(): GS {
  const gs: GS = {
    phase: 'pitch',
    pitchNo: 0,
    total: 0,
    pitchStart: 0,
    travelMs: TRAVEL_MIN,
    loaded: false,
    loadAt: 0,
    swung: false,
    swingAt: 0,
    ball: { x: W / 2, y: MOUND_Y, vx: 0, vy: 0 },
    outcome: null,
    resultAt: 0,
  };
  newPitch(gs);
  return gs;
}

/** Outcome for a swing `dt` ms from ideal contact (negative = early). */
function outcomeFor(dt: number): Outcome {
  const ad = Math.abs(dt);
  if (ad <= PERFECT) return { label: 'HOME RUN 💥', pts: 4, kind: 'hr' };
  if (ad <= GOOD) return { label: 'Base hit!', pts: 2, kind: 'hit' };
  if (ad <= CONTACT) return { label: 'Foul tip', pts: 0, kind: 'foul' };
  return { label: dt < 0 ? 'Swung early' : 'Swung late', pts: 0, kind: 'miss' };
}

/** Launch velocity off the bat for the hit animation. */
function contactVelocity(kind: Kind): { vx: number; vy: number } {
  switch (kind) {
    case 'hr':
      return { vx: rnd(-3, 3), vy: -9.5 };
    case 'hit':
      return { vx: rnd(-4.5, 4.5), vy: -6 };
    case 'foul':
      return { vx: rnd(-7, 7), vy: -4.5 };
    default:
      return { vx: 0, vy: 7 }; // whiff — ball keeps going to the catcher
  }
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the timing sim is never touched; they're advanced per
// animation frame with a real dt and only ever paint pixels. Built on the shared
// ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent ball positions → motion streak
  particles: Particle[]; // spark bursts on contact / home runs
  shake: number; // screen-shake magnitude (px), decays to 0
  flash: number; // contact flash 0..1, decays to 0
  flashColor: string;
  pitchSeen: number; // last pitchStart drawn — to reset the trail per pitch
};

function freshFX(): FX {
  return { trail: [], particles: [], shake: 0, flash: 0, flashColor: '#ffffff', pitchSeen: -1 };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, gs: GS, dt: number) {
  // A brand-new pitch: wipe the streak (no ghost line from the old ball) and
  // kick up a little dust off the mound as the pitcher releases.
  if (gs.pitchStart !== fx.pitchSeen) {
    fx.trail.length = 0;
    if (fx.pitchSeen !== -1) spawnBurst(fx.particles, W / 2, MOUND_Y + 2, 7, 70, '#8a97ad');
    fx.pitchSeen = gs.pitchStart;
  }
  pushTrail(fx.trail, gs.ball.x, gs.ball.y, 14);
  fx.particles = stepParticles(fx.particles, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0025);
}

/** Kick off the contact juice for a swing outcome, at the ball's position. */
function contactFX(fx: FX, kind: Kind, x: number, y: number) {
  switch (kind) {
    case 'hr':
      fx.shake = 9;
      fx.flash = 1;
      fx.flashColor = '#ef4444';
      spawnBurst(fx.particles, x, y, 30, 360, '#fecaca');
      spawnBurst(fx.particles, x, y, 16, 200, '#ffffff');
      break;
    case 'hit':
      fx.shake = 6;
      fx.flash = 0.5;
      fx.flashColor = '#fbbf24';
      spawnBurst(fx.particles, x, y, 18, 240, '#fde68a');
      break;
    case 'foul':
      fx.shake = 3;
      fx.flash = 0.28;
      fx.flashColor = '#f59e0b';
      spawnBurst(fx.particles, x, y, 10, 170, '#fcd34d');
      break;
    default:
      // Whiff / strike — a faint puff of missed air, no shake.
      spawnBurst(fx.particles, x, y, 6, 90, '#64748b');
  }
}

// —— drawing —————————————————————————————————————————————————————————————————
/** A lit baseball: soft shadow, top-lit off-white body, red seams, and a bright
 *  specular hotspot — the workhorse round object of the scene. */
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number) {
  drawShadow(ctx, x, y + BALL_R + 3, BALL_R * 0.95, BALL_R * 0.4, 0.28);
  drawSphere(ctx, x, y, BALL_R, '#ffffff', '#eef1f5', '#b7c0cc');
  ctx.save();
  ctx.strokeStyle = withAlpha('#ef4444', 0.9);
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x - BALL_R * 0.62, y, BALL_R * 1.2, -0.85, 0.85);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + BALL_R * 0.62, y, BALL_R * 1.2, Math.PI - 0.85, Math.PI + 0.85);
  ctx.stroke();
  ctx.restore();
}

/** A lit wooden bat drawn within the caller's rotated frame (barrel toward −y). */
function drawBat(ctx: CanvasRenderingContext2D) {
  const len = 56;
  // Contact shadow behind the barrel for a little lift off the surface.
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(1.5, 2);
  ctx.lineTo(1.5, -len + 2);
  ctx.stroke();
  ctx.restore();

  // Tapered wooden body: thin at the handle, thick at the barrel end.
  const wood = ctx.createLinearGradient(-5, 0, 5, -len);
  wood.addColorStop(0, '#7c4f22');
  wood.addColorStop(0.5, '#b9843c');
  wood.addColorStop(1, '#e7bd72');
  ctx.beginPath();
  ctx.moveTo(-2.4, 6);
  ctx.lineTo(2.4, 6);
  ctx.lineTo(5, -len);
  ctx.lineTo(-5, -len);
  ctx.closePath();
  ctx.fillStyle = wood;
  ctx.fill();
  // Rounded barrel cap + handle knob.
  ctx.beginPath();
  ctx.arc(0, -len, 5, 0, TWO_PI);
  ctx.fillStyle = '#e7bd72';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 6, 3.4, 0, TWO_PI);
  ctx.fillStyle = '#5f3c19';
  ctx.fill();
  // Glossy highlight streak along the barrel.
  ctx.strokeStyle = 'rgba(255,240,210,0.6)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-2, 0);
  ctx.lineTo(-3, -len + 4);
  ctx.stroke();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);

  // —— Stadium backdrop: lit sky above, dark cage floor below ——
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1c2b46');
  bg.addColorStop(0.45, '#121e33');
  bg.addColorStop(1, '#0a1220');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Warm overhead stadium-light sheen.
  const sheen = ctx.createRadialGradient(W / 2, H * 0.12, 12, W / 2, H * 0.12, H * 0.62);
  sheen.addColorStop(0, 'rgba(255,196,196,0.14)');
  sheen.addColorStop(1, 'rgba(255,196,196,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  // Corner vignette for depth.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.74);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // —— Cage netting: a faint diamond mesh, fading toward the foreground ——
  ctx.save();
  ctx.strokeStyle = 'rgba(180,205,235,0.05)';
  ctx.lineWidth = 1;
  const gap = 34;
  for (let d = -H; d < W + H; d += gap) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + H, H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d - H, H);
    ctx.stroke();
  }
  ctx.restore();

  // —— Outfield fence: a soft red glowing arc up the cage (distance marker) ——
  ctx.save();
  ctx.strokeStyle = withAlpha('#ef4444', 0.35);
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(239,68,68,0.55)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(W / 2, MOUND_Y + 240, 250, Math.PI * 1.16, Math.PI * 1.84);
  ctx.stroke();
  ctx.restore();

  // —— Pitcher's mound: a lit dirt hummock ——
  drawShadow(ctx, W / 2, MOUND_Y + 8, 36, 12, 0.35);
  const mound = ctx.createRadialGradient(W / 2, MOUND_Y - 5, 4, W / 2, MOUND_Y + 4, 36);
  mound.addColorStop(0, '#5a6c88');
  mound.addColorStop(1, '#293650');
  ctx.beginPath();
  ctx.ellipse(W / 2, MOUND_Y, 34, 14, 0, 0, TWO_PI);
  ctx.fillStyle = mound;
  ctx.fill();

  // —— Strike zone: a glowing red frame at the plate ——
  ctx.save();
  roundRectPath(ctx, W / 2 - 46, PLATE_Y - 40, 92, 60, 8);
  ctx.strokeStyle = withAlpha('#ef4444', 0.6);
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(239,68,68,0.8)';
  ctx.shadowBlur = 11;
  ctx.stroke();
  ctx.restore();

  // —— Home plate: lit off-white pentagon ——
  const plate = ctx.createLinearGradient(0, PLATE_Y + 30, 0, PLATE_Y + 56);
  plate.addColorStop(0, '#ffffff');
  plate.addColorStop(1, '#b9bfca');
  ctx.beginPath();
  ctx.moveTo(W / 2 - 22, PLATE_Y + 34);
  ctx.lineTo(W / 2 + 22, PLATE_Y + 34);
  ctx.lineTo(W / 2 + 22, PLATE_Y + 46);
  ctx.lineTo(W / 2, PLATE_Y + 56);
  ctx.lineTo(W / 2 - 22, PLATE_Y + 46);
  ctx.closePath();
  ctx.fillStyle = plate;
  ctx.fill();

  // Bat — held horizontal over the plate at rest, dropped down to load while
  // holding, then swept up-and-forward toward the ball on release. The barrel is
  // drawn straight up (angle 0) and canvas angles run clockwise from there; the
  // plate is to the left of the pivot (9 o'clock, -PI/2), so loading drops the
  // barrel down and the swing sweeps clockwise up the plate side into the ball.
  const REST = -Math.PI / 2; // horizontal, barrel pointing toward the plate
  const COCK = -Math.PI; // dropped straight down to load
  const SWING = -0.2; // clockwise up through the plate, finishing toward the ball
  let angle = REST;
  if (gs.swung) {
    angle = COCK + (SWING - COCK) * clamp((now - gs.swingAt) / 160, 0, 1);
  } else if (gs.phase === 'pitch' && gs.loaded) {
    angle = REST + (COCK - REST) * clamp((now - gs.loadAt) / 220, 0, 1);
  }
  ctx.save();
  ctx.translate(W / 2 + 30, PLATE_Y + 26);
  ctx.rotate(angle);
  drawBat(ctx);
  ctx.restore();

  // —— Dynamic layer (shaken on solid contact) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }

  // Ball motion trail — a fast red-white streak (drawn under the ball).
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const k = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, BALL_R * (0.28 + k * 0.72), 0, TWO_PI);
    ctx.fillStyle = `rgba(255,220,220,${0.03 + k * 0.14})`;
    ctx.fill();
  }

  drawBall(ctx, gs.ball.x, gs.ball.y);
  drawParticles(ctx, fx.particles);
  ctx.restore();

  // —— Contact flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.26);
    ctx.fillRect(0, 0, W, H);
  }

  // —— Outcome text, with a soft glow ——
  if (gs.phase === 'result' && gs.outcome) {
    const hr = gs.outcome.kind === 'hr';
    const color = hr
      ? '#4ade80'
      : gs.outcome.kind === 'hit'
        ? '#fbbf24'
        : gs.outcome.kind === 'foul'
          ? '#f59e0b'
          : '#94a3b8';
    ctx.save();
    ctx.font = `bold ${hr ? 32 : 26}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = hr ? 22 : 12;
    ctx.fillText(gs.outcome.label, W / 2, H / 2);
    ctx.restore();
  }
}

export default function BattingCages() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The ball sits on the mound until the batter holds down, so a fresh state is
  // safe to build with no clock reading — the pitch clock only starts on press.
  const gsRef = useRef<GS>(null!);
  if (!gsRef.current) gsRef.current = freshGS();
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('pitch');
  const [pitchNo, setPitchNo] = useState(0);
  const [total, setTotal] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const playing = phase !== 'done';
  useFitCanvas(canvasRef, W, H, playing);

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
    // Pause via visibilitychange, not a hidden-rAF branch: mobile browsers
    // suspend requestAnimationFrame while backgrounded, so a hidden frame may
    // never run to record the pause. Shift the absolute timers by the away span
    // on resume so nothing jumps (a held pitch isn't retroactively struck).
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = performance.now();
      } else if (hiddenAt) {
        const gap = performance.now() - hiddenAt;
        const gs = gsRef.current;
        if (gs.pitchStart) gs.pitchStart += gap; // 0 → not pitched; keep the sentinel
        gs.resultAt += gap;
        gs.swingAt += gap;
        gs.loadAt += gap;
        hiddenAt = 0;
        last = performance.now();
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
      const dt = Math.min(now - last, 100);
      last = now;

      if (gs.phase === 'pitch') {
        if (!gs.pitchStart) {
          // The ball waits on the mound until the batter holds down to pitch.
          gs.ball.y = MOUND_Y;
        } else {
          // Kinematic descent from absolute time so timing stays framerate-exact.
          // p stays 0 during the pre-launch delay (pitchStart is in the future),
          // holding the ball on the mound until its randomized release moment.
          const p = Math.max(0, (now - gs.pitchStart) / gs.travelMs);
          gs.ball.y = MOUND_Y + (PLATE_Y - MOUND_Y) * p;
          // No swing and the ball has passed the plate → strike (watched or held
          // too long without releasing).
          if (!gs.swung && now - (gs.pitchStart + gs.travelMs) > LATE_CUTOFF) {
            gs.loaded = false;
            gs.outcome = { label: 'Strike!', pts: 0, kind: 'miss' };
            gs.ball.vx = 0;
            gs.ball.vy = 7;
            gs.phase = 'result';
            gs.resultAt = now;
            contactFX(fxRef.current, 'miss', gs.ball.x, gs.ball.y);
            setOutcome(gs.outcome);
            setPhase('result');
            playUndo();
          }
        }
      } else if (gs.phase === 'result') {
        // Animate the ball off the bat (or past the plate).
        gs.ball.vy += 0.25 * (dt / 16); // gravity
        gs.ball.x += gs.ball.vx * (dt / 16);
        gs.ball.y += gs.ball.vy * (dt / 16);
        // Keep the batted ball inside the cage — it caroms off the netting and
        // ground and settles rather than flying off-frame and vanishing while
        // the outcome text is still up. Impulses fire on contact, so they stay
        // framerate-independent.
        const groundY = H - BALL_R - 4;
        if (gs.ball.y > groundY) {
          gs.ball.y = groundY;
          gs.ball.vy *= -0.34; // damped bounce off the ground
          gs.ball.vx *= 0.6; // ground friction
          if (Math.abs(gs.ball.vy) < 1.2) gs.ball.vy = 0; // come to rest
        } else if (gs.ball.y < BALL_R) {
          gs.ball.y = BALL_R;
          gs.ball.vy = Math.abs(gs.ball.vy) * 0.4; // off the top netting
        }
        if (gs.ball.x < BALL_R) {
          gs.ball.x = BALL_R;
          gs.ball.vx = Math.abs(gs.ball.vx) * 0.5; // off the side netting
        } else if (gs.ball.x > W - BALL_R) {
          gs.ball.x = W - BALL_R;
          gs.ball.vx = -Math.abs(gs.ball.vx) * 0.5;
        }
        if (now - gs.resultAt >= RESULT_MS) {
          if (gs.pitchNo + 1 >= PITCHES) {
            gs.phase = 'done';
            setPhase('done');
            playFanfare();
          } else {
            gs.pitchNo += 1;
            newPitch(gs);
            setPitchNo(gs.pitchNo);
            setPhase('pitch');
          }
        }
      }

      updateFX(fxRef.current, gs, dt);
      draw(ctx, gs, fxRef.current, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [playing]);

  // Press to pitch and load: holding down releases the pitch and winds the bat
  // back, ready to swing. The ball waits on the mound until this moment.
  const onPress = useCallback((e: React.PointerEvent) => {
    const gs = gsRef.current;
    if (gs.phase !== 'pitch' || gs.swung || gs.loaded) return;
    // Capture the pointer so the release is delivered even if the finger drags
    // off the canvas — otherwise `loaded` sticks and later pitches are ignored.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const now = performance.now();
    gs.loaded = true;
    gs.loadAt = now;
    // Launch the ball a randomized beat after the hold, not instantly.
    if (!gs.pitchStart) gs.pitchStart = now + rnd(DELAY_MIN, DELAY_MAX);
  }, []);

  // Release to swing: contact timing is the moment the batter lets go.
  const onRelease = useCallback(() => {
    const gs = gsRef.current;
    if (gs.phase !== 'pitch' || gs.swung || !gs.loaded) return;
    const now = performance.now();
    gs.loaded = false;
    gs.swung = true;
    gs.swingAt = now;
    const dt = now - (gs.pitchStart + gs.travelMs); // <0 early, >0 late
    const oc = outcomeFor(dt);
    gs.outcome = oc;
    gs.total += oc.pts;
    const v = contactVelocity(oc.kind);
    gs.ball.vx = v.vx;
    gs.ball.vy = v.vy;
    gs.phase = 'result';
    gs.resultAt = now;
    contactFX(fxRef.current, oc.kind, gs.ball.x, gs.ball.y);
    setOutcome(oc);
    setTotal(gs.total);
    setPhase('result');
    if (oc.kind === 'hr') playFanfare();
    else if (oc.kind === 'hit' || oc.kind === 'foul') playStroke();
    else playUndo();
  }, []);

  const restart = useCallback(() => {
    gsRef.current = freshGS();
    fxRef.current = freshFX();
    setPhase('pitch');
    setPitchNo(0);
    setTotal(0);
    setOutcome(null);
  }, []);

  if (phase === 'done') {
    const remark =
      total >= 28 ? 'Home run derby champ! 🏆' : total >= 18 ? 'Big bat! ⚾️' : total >= 10 ? 'Solid contact! 👍' : 'Keep swinging! 🎮';
    return (
      <Screen>
        <TopBar title="Batting Cages" back="/fun" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">⚾️</span>
            <div className="text-5xl font-black text-fairway-50">{total}</div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
            <p className="text-sm text-fairway-400">across {PITCHES} pitches</p>
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
    phase === 'result' && outcome
      ? outcome.pts > 0
        ? `${outcome.label} +${outcome.pts}`
        : outcome.label
      : 'Hold to pitch and wind up, release to swing as the ball reaches the plate.';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Batting Cages" back="/fun" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Pitch <span className="text-fairway-100">{Math.min(pitchNo + 1, PITCHES)}</span>
          <span className="font-normal text-fairway-400"> / {PITCHES}</span>
        </span>
        <span className="text-fairway-300">
          Runs <span className="font-bold text-fairway-100">{total}</span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPress}
          onPointerUp={onRelease}
          onPointerCancel={onRelease}
          className="block touch-none rounded-2xl border border-fairway-800"
        />
      </div>

      <p className="flex h-16 shrink-0 items-center justify-center px-4 pb-4 pt-3 text-center text-sm text-fairway-100/80">
        <span className="line-clamp-2">{hint}</span>
      </p>
    </div>
  );
}
