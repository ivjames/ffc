import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playStroke, playUndo, playFanfare } from '../../lib/sound';

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
  swung: boolean;
  swingAt: number;
  ball: Ball;
  outcome: Outcome | null;
  resultAt: number;
};

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function newPitch(gs: GS, now: number) {
  gs.phase = 'pitch';
  gs.pitchStart = now;
  gs.travelMs = rnd(TRAVEL_MIN, TRAVEL_MAX);
  gs.swung = false;
  gs.swingAt = 0;
  gs.outcome = null;
  gs.ball = { x: W / 2, y: MOUND_Y, vx: 0, vy: 0 };
}

function freshGS(now: number): GS {
  const gs: GS = {
    phase: 'pitch',
    pitchNo: 0,
    total: 0,
    pitchStart: now,
    travelMs: TRAVEL_MIN,
    swung: false,
    swingAt: 0,
    ball: { x: W / 2, y: MOUND_Y, vx: 0, vy: 0 },
    outcome: null,
    resultAt: 0,
  };
  newPitch(gs, now);
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

// —— drawing —————————————————————————————————————————————————————————————————
function draw(ctx: CanvasRenderingContext2D, gs: GS, now: number) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0e1626';
  ctx.fillRect(0, 0, W, H);

  // Cage netting hint (faint verticals).
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 30; x < W; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // Pitcher's mound.
  ctx.fillStyle = '#3a4a63';
  ctx.beginPath();
  ctx.ellipse(W / 2, MOUND_Y, 34, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Strike zone at the plate.
  ctx.strokeStyle = 'rgba(56,189,248,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(W / 2 - 46, PLATE_Y - 40, 92, 60);

  // Home plate.
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.moveTo(W / 2 - 22, PLATE_Y + 34);
  ctx.lineTo(W / 2 + 22, PLATE_Y + 34);
  ctx.lineTo(W / 2 + 22, PLATE_Y + 46);
  ctx.lineTo(W / 2, PLATE_Y + 56);
  ctx.lineTo(W / 2 - 22, PLATE_Y + 46);
  ctx.closePath();
  ctx.fill();

  // Bat — swings from ready to follow-through on contact.
  const ready = -0.7;
  const swung = 1.15;
  let angle = ready;
  if (gs.swung) angle = ready + (swung - ready) * clamp((now - gs.swingAt) / 150, 0, 1);
  ctx.save();
  ctx.translate(W / 2 + 30, PLATE_Y + 30);
  ctx.rotate(angle);
  ctx.strokeStyle = '#d4a24e';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -54);
  ctx.stroke();
  ctx.restore();

  // Ball.
  ctx.beginPath();
  ctx.arc(gs.ball.x, gs.ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Outcome text.
  if (gs.phase === 'result' && gs.outcome) {
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle =
      gs.outcome.kind === 'hr'
        ? '#4ade80'
        : gs.outcome.kind === 'hit'
          ? '#fbbf24'
          : gs.outcome.kind === 'foul'
            ? '#f59e0b'
            : '#94a3b8';
    ctx.fillText(gs.outcome.label, W / 2, H / 2);
  }
}

export default function BattingCages() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS(0));

  const [phase, setPhase] = useState<Phase>('pitch');
  const [pitchNo, setPitchNo] = useState(0);
  const [total, setTotal] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

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
    let pausedAt = 0;
    const frame = (now: number) => {
      const gs = gsRef.current;
      if (document.hidden) {
        if (!pausedAt) pausedAt = now;
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      if (pausedAt) {
        // Shift absolute timers by the paused span so nothing jumps.
        const gap = now - pausedAt;
        gs.pitchStart += gap;
        gs.resultAt += gap;
        gs.swingAt += gap;
        pausedAt = 0;
      }
      const dt = Math.min(now - last, 100);
      last = now;

      if (gs.phase === 'pitch') {
        // Kinematic descent from absolute time so timing stays framerate-exact.
        const p = (now - gs.pitchStart) / gs.travelMs;
        gs.ball.y = MOUND_Y + (PLATE_Y - MOUND_Y) * p;
        // No swing and the ball has passed the plate → strike.
        if (!gs.swung && now - (gs.pitchStart + gs.travelMs) > LATE_CUTOFF) {
          gs.outcome = { label: 'Strike!', pts: 0, kind: 'miss' };
          gs.ball.vx = 0;
          gs.ball.vy = 7;
          gs.phase = 'result';
          gs.resultAt = now;
          setOutcome(gs.outcome);
          setPhase('result');
          playUndo();
        }
      } else if (gs.phase === 'result') {
        // Animate the ball off the bat (or past the plate).
        gs.ball.vy += 0.25 * (dt / 16); // gravity
        gs.ball.x += gs.ball.vx * (dt / 16);
        gs.ball.y += gs.ball.vy * (dt / 16);
        if (now - gs.resultAt >= RESULT_MS) {
          if (gs.pitchNo + 1 >= PITCHES) {
            gs.phase = 'done';
            setPhase('done');
            playFanfare();
          } else {
            gs.pitchNo += 1;
            newPitch(gs, now);
            setPitchNo(gs.pitchNo);
            setPhase('pitch');
          }
        }
      }

      draw(ctx, gs, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const onSwing = useCallback(() => {
    const gs = gsRef.current;
    if (gs.phase !== 'pitch' || gs.swung) return;
    const now = performance.now();
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
    setOutcome(oc);
    setTotal(gs.total);
    setPhase('result');
    if (oc.kind === 'hr') playFanfare();
    else if (oc.kind === 'hit' || oc.kind === 'foul') playStroke();
    else playUndo();
  }, []);

  const restart = useCallback(() => {
    gsRef.current = freshGS(performance.now());
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
      : 'Tap to swing — time it at the plate.';

  return (
    <Screen>
      <TopBar title="Batting Cages" back="/fun" />
      <Content>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-fairway-50">
            Pitch <span className="text-fairway-100">{Math.min(pitchNo + 1, PITCHES)}</span>
            <span className="font-normal text-fairway-400"> / {PITCHES}</span>
          </span>
          <span className="text-fairway-300">
            Runs <span className="font-bold text-fairway-100">{total}</span>
          </span>
        </div>

        <canvas
          ref={canvasRef}
          onPointerDown={onSwing}
          className="block w-full touch-none rounded-2xl border border-fairway-800"
          style={{ aspectRatio: `${W} / ${H}` }}
        />

        <p className="mt-3 min-h-[2.5rem] text-center text-sm text-fairway-100/80">{hint}</p>
      </Content>
    </Screen>
  );
}
