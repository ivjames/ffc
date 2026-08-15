import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import GameTicketAward from './GameTicketAward';
import { useFitCanvas } from './useFitCanvas';
import { drawLogo } from './logo';
import { playWaterBump, playTick, playScore, playBuzz, playFanfare } from '../../lib/sound';
import type { Particle, Floater } from './fx';
import {
  TWO_PI,
  withAlpha,
  roundRectPath,
  drawShadow,
  drawSphere,
  spawnBurst,
  stepParticles,
  drawParticles,
  spawnFloater,
  stepFloaters,
  drawFloaters,
  decay,
  shakeOffset,
} from './fx';

// §12 Water Gun Race — a carnival balloon-race mini-game. Press-and-hold to
// spray a mounted water pistol at a clown board's small bullseye, which drifts
// side to side; while the stream sits on the bullseye your balloon inflates
// from the clown's hat. Three named CPU rivals fill their own balloons at tuned
// rates with brief random stalls — beatable but honest. First balloon to pop
// wins the heat; best of 3 heats. Canvas-rendered, client-side, offline.

// —— Geometry (logical units; the canvas scales to fit) ———————————————————————
const W = 340;
const H = 560;

const HEATS = 3;
const COUNT_STEP_MS = 700; // per digit of the "3, 2, 1" countdown
const GO_MS = 500; // beat of "GO!" after the digits, before the first heat
const COUNTDOWN_MS = 3 * COUNT_STEP_MS + GO_MS;
const INTER_MS = 1700; // reset beat between heats (winner floater plays out)

const GUN = { x: W / 2, y: H - 52 }; // barrel pivot of the mounted pistol
const BARREL_LEN = 40;

const BOARD = { x: 178, y: 318, r: 56 }; // clown face
const BULL_Y = 350; // the drifting bullseye rides across the mouth track
const BULL_R = 16;
const ON_TARGET_R = BULL_R + 4; // slight assist so grazing hits still count
const DRIFT_AMP = 50;

const BALLOON = { x: BOARD.x, y: 188, rMin: 8, rMax: 36 };

const PLAYER_RATE = 1 / 6000; // full balloon per ~6s of on-target spray

// CPU rivals fill in ~7.2–10s of active time plus ~2.5–3s of stalls, so the
// fastest clown pops around the 10s mark — a player holding the bullseye
// ~60%+ of the time wins the footrace.
const RIVALS = [
  { name: 'MO', color: '#f472b6', light: '#fbcfe8', dark: '#831843' },
  { name: 'ZIP', color: '#60a5fa', light: '#bfdbfe', dark: '#1e3a8a' },
  { name: 'SAL', color: '#fbbf24', light: '#fde68a', dark: '#78350f' },
] as const;
const RIVAL_POS = [
  { x: 38, y: 104 },
  { x: 38, y: 180 },
  { x: 38, y: 256 },
] as const;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

type Phase = 'ready' | 'countdown' | 'heat' | 'between' | 'done';
type HeatResult = 'you' | 'cpu';
type Racer = { fill: number; rate: number; stallLeft: number; nextStallIn: number };
type GS = {
  phase: Phase;
  heat: number; // 0-based
  results: HeatResult[];
  fill: number; // your balloon 0..1
  aim: { x: number; y: number } | null; // latest finger aim point
  spraying: boolean;
  onTarget: boolean;
  bull: { x: number; phase: number; speed: number; changeIn: number };
  racers: Racer[];
  countLeft: number; // ms remaining in the countdown (dt-driven, freezes hidden)
  interLeft: number; // ms remaining in the between-heats beat
  dripIn: number; // ms until the next stray-drip tick sound
};

function freshRacer(): Racer {
  return {
    fill: 0,
    rate: 1 / (7200 + Math.random() * 2800),
    stallLeft: 0,
    nextStallIn: 1200 + Math.random() * 1800,
  };
}

function freshBull(): GS['bull'] {
  const phase = Math.random() * TWO_PI;
  return {
    x: BOARD.x + DRIFT_AMP * Math.sin(phase),
    phase,
    speed: (0.0016 + Math.random() * 0.0014) * (Math.random() < 0.5 ? -1 : 1),
    changeIn: 1400 + Math.random() * 2200,
  };
}

function freshGS(): GS {
  return {
    phase: 'ready',
    heat: 0,
    results: [],
    fill: 0,
    aim: null,
    spraying: false,
    onTarget: false,
    bull: freshBull(),
    racers: [freshRacer(), freshRacer(), freshRacer()],
    countLeft: COUNTDOWN_MS,
    interLeft: 0,
    dripIn: 300,
  };
}

function resetHeat(gs: GS) {
  gs.fill = 0;
  gs.onTarget = false;
  gs.bull = freshBull();
  gs.racers = [freshRacer(), freshRacer(), freshRacer()];
  gs.dripIn = 300;
}

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the race sim is never touched; they're advanced per
// animation frame with a real dt and only ever paint pixels. Built on the
// shared ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  particles: Particle[]; // water droplet scatter + balloon-pop bursts
  floaters: Floater[]; // POP! / heat-winner popups
  shake: number; // pop shake magnitude (px), decays to 0
  flash: number; // pop flash 0..1, decays to 0
  flashColor: string;
};

function freshFX(): FX {
  return { particles: [], floaters: [], shake: 0, flash: 0, flashColor: '#4ade80' };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). */
function updateFX(fx: FX, dt: number) {
  fx.particles = stepParticles(fx.particles, dt, 0.02, 260); // gravity so drops fall
  fx.floaters = stepFloaters(fx.floaters, dt);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
}

// —— drawing —————————————————————————————————————————————————————————————————
/** Carnival booth backdrop: night gradient, scalloped canopy, wooden counter.
 *  All offsets are index-derived (no RNG in the draw path). */
function drawBooth(ctx: CanvasRenderingContext2D) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#241332');
  bg.addColorStop(0.55, '#160c22');
  bg.addColorStop(1, '#0b0713');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Striped canopy with a scalloped bottom edge.
  const SW = 34;
  for (let i = 0, x = 0; x < W; i++, x += SW) {
    ctx.fillStyle = i % 2 === 0 ? '#b91c1c' : '#f1f5f9';
    ctx.fillRect(x, 0, SW, 30);
    ctx.beginPath();
    ctx.arc(x + SW / 2, 30, SW / 2, 0, Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 44, W, 4);

  // Wooden counter the pistol is bolted to.
  const wood = ctx.createLinearGradient(0, H - 44, 0, H);
  wood.addColorStop(0, '#5b3a1e');
  wood.addColorStop(1, '#33200e');
  ctx.fillStyle = wood;
  ctx.fillRect(0, H - 44, W, 44);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, H - 44, W, 2);

  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

/** Popped-balloon remnant: a few colored rubber scraps (deterministic). */
function drawScraps(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  const bits: Array<[number, number, number, number]> = [
    [-7, -3, 1.1, 2.4],
    [6, -6, 3.6, 4.9],
    [1, 6, 5.4, 6.4],
  ];
  for (const [dx, dy, a0, a1] of bits) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, 4, a0, a1);
    ctx.stroke();
  }
  ctx.restore();
}

/** The three CPU rivals as mini balloons + tags + fill gauges on the left edge. */
function drawRivals(ctx: CanvasRenderingContext2D, gs: GS) {
  roundRectPath(ctx, 14, 64, 52, 248, 12);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 8px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('RIVALS', 40, 78);
  ctx.restore();

  for (let i = 0; i < RIVALS.length; i++) {
    const spec = RIVALS[i];
    const r = gs.racers[i];
    const pos = RIVAL_POS[i];
    const rad = 5 + r.fill * 12;
    if (r.fill >= 1) {
      drawScraps(ctx, pos.x, pos.y, spec.color);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y + rad);
      ctx.lineTo(pos.x, pos.y + 22);
      ctx.stroke();
      drawSphere(ctx, pos.x, pos.y, rad, spec.light, spec.color, spec.dark);
    }
    // Name tag.
    roundRectPath(ctx, pos.x - 16, pos.y + 26, 32, 13, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 8px system-ui, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(spec.name, pos.x, pos.y + 35.5);
    ctx.restore();
    // Fill gauge.
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(pos.x - 17, pos.y + 43, 34, 4);
    ctx.fillStyle = spec.color;
    ctx.fillRect(pos.x - 17, pos.y + 43, 34 * r.fill, 4);
  }
}

/** Clown-face target board: backing disc, face, party hat, bullseye track and
 *  the drifting bullseye (lit while the stream is on it). */
function drawClownBoard(ctx: CanvasRenderingContext2D, gs: GS) {
  const { x: cx, y: cy, r } = BOARD;
  drawShadow(ctx, cx, cy + r + 18, r * 0.9, 14, 0.35);

  // Painted backing disc.
  const disc = ctx.createRadialGradient(cx, cy - 12, 16, cx, cy, 70);
  disc.addColorStop(0, '#a21caf');
  disc.addColorStop(1, '#581c87');
  ctx.beginPath();
  ctx.arc(cx, cy, 68, 0, TWO_PI);
  ctx.fillStyle = disc;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Face.
  const face = ctx.createRadialGradient(cx - 14, cy - 18, 10, cx, cy, r);
  face.addColorStop(0, '#ffffff');
  face.addColorStop(1, '#dbe3ec');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TWO_PI);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Hair tufts.
  ctx.fillStyle = '#ea580c';
  for (const s of [-1, 1]) {
    for (const [dx, dy, hr] of [
      [50, -22, 12],
      [56, -4, 10],
      [44, -38, 11],
    ]) {
      ctx.beginPath();
      ctx.arc(cx + s * dx, cy + dy, hr, 0, TWO_PI);
      ctx.fill();
    }
  }

  // Eyes + brows.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * 20, cy - 16, 7, 9, 0, 0, TWO_PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + s * 20, cy - 14, 3.2, 0, TWO_PI);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + s * 20, cy - 26, 10, Math.PI * 1.15, Math.PI * 1.85);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Nose + smile.
  ctx.beginPath();
  ctx.arc(cx, cy + 2, 8, 0, TWO_PI);
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - 2.5, cy - 0.5, 2.2, 0, TWO_PI);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + 8, 30, Math.PI * 0.2, Math.PI * 0.8);
  ctx.strokeStyle = '#b91c1c';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Party hat + balloon nozzle poking out of its tip.
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(cx - 2.5, 214, 5, 12);
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy - 46);
  ctx.lineTo(cx + 26, cy - 46);
  ctx.lineTo(cx, cy - 90);
  ctx.closePath();
  ctx.fillStyle = '#2563eb';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy - 90, 6, 0, TWO_PI);
  ctx.fillStyle = '#facc15';
  ctx.fill();

  // Bullseye track (the slot the target drifts along).
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(cx - DRIFT_AMP - BULL_R, BULL_Y);
  ctx.lineTo(cx + DRIFT_AMP + BULL_R, BULL_Y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // The drifting bullseye — lights up while the stream is on it.
  const bx = gs.bull.x;
  if (gs.onTarget) {
    ctx.save();
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(bx, BULL_Y, BULL_R + 3, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }
  const rings: Array<[number, string]> = [
    [BULL_R, '#f8fafc'],
    [11, '#dc2626'],
    [6, '#f8fafc'],
    [2.5, '#dc2626'],
  ];
  for (const [rr, fill] of rings) {
    ctx.beginPath();
    ctx.arc(bx, BULL_Y, rr, 0, TWO_PI);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(bx, BULL_Y, BULL_R, 0, TWO_PI);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Your balloon inflating from the clown's hat, with a "YOU n%" label. */
function drawPlayerBalloon(ctx: CanvasRenderingContext2D, gs: GS, now: number) {
  if (gs.fill >= 1) {
    drawScraps(ctx, BALLOON.x, BALLOON.y, '#ef4444');
    return;
  }
  const bob = Math.sin(now * 0.0028) * 2;
  const rad = BALLOON.rMin + gs.fill * (BALLOON.rMax - BALLOON.rMin);
  const by = BALLOON.y - (rad - BALLOON.rMin) * 0.4 + bob;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(BALLOON.x, by + rad);
  ctx.lineTo(BALLOON.x, 218);
  ctx.stroke();
  drawSphere(ctx, BALLOON.x, by, rad, '#fecaca', '#ef4444', '#7f1d1d');
  ctx.beginPath();
  ctx.moveTo(BALLOON.x - 4, by + rad + 1);
  ctx.lineTo(BALLOON.x + 4, by + rad + 1);
  ctx.lineTo(BALLOON.x, by + rad - 4);
  ctx.closePath();
  ctx.fillStyle = '#b91c1c';
  ctx.fill();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillStyle = '#fecaca';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 4;
  ctx.fillText(`YOU ${Math.round(gs.fill * 100)}%`, BALLOON.x, by - rad - 8);
  ctx.restore();
}

/** The mounted pistol swiveling toward the aim point, plus the arcing stream
 *  while spraying. The stream path is deterministic per frame; its wet scatter
 *  lives in the fx particle list. */
function drawGun(ctx: CanvasRenderingContext2D, gs: GS) {
  const aim = gs.aim ?? { x: W / 2, y: 200 };
  const ang = Math.atan2(aim.y - GUN.y, aim.x - GUN.x);

  drawShadow(ctx, GUN.x, H - 26, 40, 8, 0.3);
  const ped = ctx.createLinearGradient(0, GUN.y + 6, 0, GUN.y + 32);
  ped.addColorStop(0, '#475569');
  ped.addColorStop(1, '#0f172a');
  roundRectPath(ctx, GUN.x - 22, GUN.y + 6, 44, 26, 8);
  ctx.fillStyle = ped;
  ctx.fill();

  // Stream first so the barrel overlaps its root.
  if (gs.phase === 'heat' && gs.spraying && gs.aim) {
    const tipX = GUN.x + Math.cos(ang) * (BARREL_LEN + 2);
    const tipY = GUN.y + Math.sin(ang) * (BARREL_LEN + 2);
    const cpx = (tipX + aim.x) / 2 + (aim.x - tipX) * 0.15;
    const cpy = (tipY + aim.y) / 2 + 20; // slight sag gives the jet its arc
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(125,211,252,0.35)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.quadraticCurveTo(cpx, cpy, aim.x, aim.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(224,242,254,0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    // Splash pancake at the landing point.
    ctx.beginPath();
    ctx.ellipse(aim.x, aim.y, 7, 3.5, 0, 0, TWO_PI);
    ctx.fillStyle = withAlpha('#bae6fd', 0.5);
    ctx.fill();
  }

  // Swivel + barrel.
  ctx.beginPath();
  ctx.arc(GUN.x, GUN.y, 10, 0, TWO_PI);
  ctx.fillStyle = '#475569';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.save();
  ctx.translate(GUN.x, GUN.y);
  ctx.rotate(ang);
  roundRectPath(ctx, 0, -7, 30, 14, 5);
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  roundRectPath(ctx, 2, -6, 26, 5, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fill();
  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(30, -4, 10, 8);
  ctx.fillStyle = '#0369a1';
  ctx.fillRect(38, -4, 2, 8);
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, fx: FX, now: number) {
  ctx.clearRect(0, 0, W, H);
  drawBooth(ctx);
  // Booth backdrop, above the clown target. Pushed right of center because the
  // RIVALS standings panel occupies the left edge during a heat — centering on
  // W/2 would tuck the mark half behind it.
  drawLogo(ctx, 205, 98, { width: 124, tint: '#f1f5f9', alpha: 0.42 });

  // —— Dynamic layer (shaken on pops) ——
  ctx.save();
  if (fx.shake > 0.05) {
    const s = shakeOffset(fx.shake);
    ctx.translate(s.x, s.y);
  }
  drawRivals(ctx, gs);
  drawClownBoard(ctx, gs);
  drawPlayerBalloon(ctx, gs, now);
  drawGun(ctx, gs);
  drawParticles(ctx, fx.particles);
  drawFloaters(ctx, fx.floaters);
  ctx.restore();

  // —— Pop flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }

  // "3, 2, 1, GO!" countdown before the first heat.
  if (gs.phase === 'countdown') {
    const n = Math.ceil((gs.countLeft - GO_MS) / COUNT_STEP_MS);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = '#7dd3fc';
    ctx.shadowColor = 'rgba(125,211,252,0.7)';
    ctx.shadowBlur = 18;
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n > 3 ? '3' : n <= 0 ? 'GO!' : String(n), W / 2, H / 2);
    ctx.restore();
  }
}

export default function WaterGunRace() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS>(freshGS());
  const fxRef = useRef<FX>(freshFX());

  const [phase, setPhase] = useState<Phase>('ready');
  const [heatNo, setHeatNo] = useState(0);
  const [results, setResults] = useState<HeatResult[]>([]);
  const [lastWinner, setLastWinner] = useState('');
  // One id per played round — the ticket award's idempotency key.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const active = phase !== 'done';
  useFitCanvas(canvasRef, W, H, active);

  const endHeat = useCallback((gs: GS, fx: FX, winner: 'you' | number) => {
    let label: string;
    if (winner === 'you') {
      gs.fill = 1;
      gs.results.push('you');
      label = `You take heat ${gs.heat + 1}!`;
      fx.shake = 7;
      fx.flash = 1;
      fx.flashColor = '#4ade80';
      spawnBurst(fx.particles, BALLOON.x, BALLOON.y - 14, 34, 340, '#fca5a5');
      spawnBurst(fx.particles, BALLOON.x, BALLOON.y - 14, 18, 220, '#bae6fd');
      spawnFloater(fx.floaters, W / 2, 250, 'POP!', '#4ade80', { size: 30, life: 1300 });
      playScore();
    } else {
      const spec = RIVALS[winner];
      const pos = RIVAL_POS[winner];
      gs.results.push('cpu');
      label = `${spec.name} takes heat ${gs.heat + 1}!`;
      fx.shake = 4;
      fx.flash = 0.7;
      fx.flashColor = '#ef4444';
      spawnBurst(fx.particles, pos.x, pos.y, 22, 260, spec.color);
      spawnFloater(fx.floaters, W / 2, 250, `${spec.name} WINS`, '#fca5a5', { size: 24, life: 1300 });
      playBuzz();
    }
    gs.phase = 'between';
    gs.interLeft = INTER_MS;
    setResults([...gs.results]);
    setLastWinner(label);
    setPhase('between');
  }, []);

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
    // Every timer here is a dt-decremented countdown (countLeft/interLeft/stalls),
    // so freezing time while hidden only needs `last` kept fresh. The hidden-rAF
    // branch handles that when frames still run; this visibilitychange reset
    // covers mobile browsers that suspend rAF entirely while backgrounded, so
    // the first visible frame doesn't swallow the away span (AxeThrow pattern).
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

      if (gs.phase === 'countdown') {
        gs.countLeft -= dt;
        if (gs.countLeft <= 0) {
          gs.phase = 'heat';
          setPhase('heat');
        }
      } else if (gs.phase === 'heat') {
        // Bullseye drift: smooth sinusoid with occasional speed/direction change.
        const b = gs.bull;
        b.changeIn -= dt;
        if (b.changeIn <= 0) {
          b.speed = (0.0016 + Math.random() * 0.0014) * (Math.random() < 0.5 ? -1 : 1);
          b.changeIn = 1400 + Math.random() * 2200;
        }
        b.phase += b.speed * dt;
        b.x = BOARD.x + DRIFT_AMP * Math.sin(b.phase);

        // Your stream: fill only while its landing point sits on the bullseye.
        gs.onTarget = false;
        if (gs.spraying && gs.aim) {
          const d = Math.hypot(gs.aim.x - b.x, gs.aim.y - BULL_Y);
          if (d <= ON_TARGET_R) {
            gs.onTarget = true;
            gs.fill = Math.min(1, gs.fill + dt * PLAYER_RATE);
            spawnBurst(fx.particles, b.x, BULL_Y, 1, 110, '#bae6fd');
          } else {
            spawnBurst(fx.particles, gs.aim.x, gs.aim.y, 1, 70, '#7dd3fc');
          }
          gs.dripIn -= dt;
          if (gs.dripIn <= 0) {
            playTick();
            gs.dripIn = 480 + Math.random() * 640;
          }
        }

        // CPU rivals: steady fill with brief random stalls.
        for (const r of gs.racers) {
          if (r.stallLeft > 0) {
            r.stallLeft -= dt;
            continue;
          }
          r.fill = Math.min(1, r.fill + r.rate * dt);
          r.nextStallIn -= dt;
          if (r.nextStallIn <= 0) {
            r.stallLeft = 350 + Math.random() * 650;
            r.nextStallIn = 1200 + Math.random() * 1800;
          }
        }

        // First balloon to 100% pops and takes the heat (you win same-frame ties).
        if (gs.fill >= 1) endHeat(gs, fx, 'you');
        else {
          const w = gs.racers.findIndex((r) => r.fill >= 1);
          if (w >= 0) endHeat(gs, fx, w);
        }
      } else if (gs.phase === 'between') {
        gs.interLeft -= dt;
        if (gs.interLeft <= 0) {
          const youWins = gs.results.filter((x) => x === 'you').length;
          const cpuWins = gs.results.length - youWins;
          if (youWins >= 2 || cpuWins >= 2 || gs.results.length >= HEATS) {
            gs.phase = 'done';
            setPhase('done');
            if (youWins > cpuWins) playFanfare();
          } else {
            gs.heat += 1;
            resetHeat(gs);
            spawnFloater(fx.floaters, W / 2, H / 2 - 60, `HEAT ${gs.heat + 1}!`, '#fbbf24', {
              size: 26,
              life: 900,
            });
            setHeatNo(gs.heat);
            gs.phase = 'heat';
            setPhase('heat');
          }
        }
      }

      updateFX(fx, dt);
      draw(ctx, gs, fx, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, endHeat]);

  // The stream lands a fixed offset ABOVE the finger: aiming directly under a
  // fingertip hides the bullseye behind the player's own hand, so the touch
  // point is a handle you drag around below the board while the splash stays
  // visible above it.
  const AIM_LIFT = 72;
  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * W, 12, W - 12),
      // Keep the aim above the counter so the jet always fires upward.
      y: clamp(((e.clientY - rect.top) / rect.height) * H - AIM_LIFT, 30, H - 130),
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      gs.aim = toField(e);
      gs.spraying = true;
      canvasRef.current?.setPointerCapture(e.pointerId);
      if (gs.phase === 'heat') playWaterBump(0.5);
    },
    [toField],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (gs.spraying) gs.aim = toField(e);
    },
    [toField],
  );
  const onPointerUp = useCallback(() => {
    gsRef.current.spraying = false;
  }, []);

  const start = useCallback(() => {
    const gs = freshGS();
    gs.phase = 'countdown';
    gsRef.current = gs;
    fxRef.current = freshFX();
    setPhase('countdown');
    setHeatNo(0);
    setResults([]);
    setLastWinner('');
    setSessionId(crypto.randomUUID());
  }, []);

  if (phase === 'done') {
    const youWins = results.filter((r) => r === 'you').length;
    const cpuWins = results.length - youWins;
    const won = youWins > cpuWins;
    const remark = won
      ? cpuWins === 0
        ? 'Flawless — the clowns never stood a chance! 💦'
        : 'Soaked past the whole clown crew! 💦'
      : youWins === 1
        ? 'So close — the clowns got you. 🤡'
        : 'The clowns got you. Dry off and rematch! 🤡';
    return (
      <Screen>
        <TopBar title="Water Gun Race" back="/arcade" />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">{won ? '🎈' : '🤡'}</span>
            <div className="text-2xl font-black text-fairway-50">
              {won ? 'You win the race!' : 'The clowns got you'}
            </div>
            <div className="text-4xl font-black text-fairway-50">
              {youWins} <span className="text-fairway-400">–</span> {cpuWins}
            </div>
            <p className="text-lg font-semibold text-fairway-100">{remark}</p>
          </div>
          {/* POS add-on: venues with gameRewards credit tickets for the round
              (25 tickets per heat won). */}
          <GameTicketAward game="watergunrace" tickets={youWins * 25} sessionId={sessionId} />
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
      ? 'Hold and drag below the target — the stream lands above your finger. First balloon to pop wins.'
      : phase === 'countdown'
        ? 'Get ready…'
        : phase === 'between'
          ? lastWinner
          : 'Hold to spray — keep the stream on the moving bullseye!';

  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Water Gun Race" back="/arcade" />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Heat <span className="text-fairway-100">{Math.min(heatNo + 1, HEATS)}</span>
          <span className="font-normal text-fairway-400"> / {HEATS}</span>
        </span>
        <span className="text-fairway-400">Best of {HEATS}</span>
        <span className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rounded-full ${
                results[i] === 'you' ? 'bg-positive' : results[i] === 'cpu' ? 'bg-danger' : 'bg-fairway-700'
              }`}
            />
          ))}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="col-start-1 row-start-1 block touch-none rounded-2xl border border-fairway-800"
        />
        {phase === 'ready' && (
          <div className="col-start-1 row-start-1 m-4 flex max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col items-center justify-center gap-4 rounded-2xl bg-black/70 px-6 py-5 text-center">
            <span className="text-5xl">🔫</span>
            <p className="text-sm text-fairway-100">
              Hold and drag below the clown — the stream lands just above your finger, so keep the
              drifting bullseye in view. On-target water inflates your
              balloon — pop it before MO, ZIP and SAL pop theirs. Best of {HEATS} heats.
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
