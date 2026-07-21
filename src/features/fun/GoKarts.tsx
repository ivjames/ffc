import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useFitCanvas } from './useFitCanvas';
import { playClick, playStroke, playCup, playFanfare } from '../../lib/sound';
import type { Particle, Vec as FxVec } from './fx';
import {
  TWO_PI,
  withAlpha,
  roundRectPath,
  drawShadow,
  neonLine,
  spawnBurst,
  stepParticles,
  drawParticles,
  pushTrail,
  decay,
  shakeOffset,
  fxRandom,
} from './fx';

// §12 Go-Karts — the seventh attraction mini-game. A top-down 3-lap time trial.
// Pick from a catalogue of procedural circuits, then drag to lead your kart
// around: touch anywhere and it chases your finger like a lure — you lead it
// around the track instead of working a throttle and left/right steering by
// hand. Throttle scales with how far ahead you drag, so holding still brings it
// to a gentle stop. Solid walls line both edges of the asphalt: run wide and
// you scrape the barrier and slide along it instead of flying off across the
// grass. Fixed-timestep physics, client-side, offline.

// —— Field + physics (logical units; the canvas scales to fit) ————————————————
const W = 340;
const H = 560;
const TRACK_W = 54; // asphalt width — trimmed a touch so the infield reads and the lane races tighter
const WALL = 6; // barrier thickness drawn outside each asphalt edge
const KART_R = 7; // kart collision radius (half its body width)
const N = 90; // centerline samples per track
const LAPS = 3;

const FIXED = 1000 / 120;
const ACCEL = 0.06; // throttle pickup per substep at full lead
const MAX_SPEED = 2.3; // calmer top speed (was twitchy-fast)
const COAST = 0.985; // rolling resistance every substep
const WALL_SLIDE = 0.9; // fraction of along-wall speed kept when scraping a barrier
const WALL_BOUNCE = 0.2; // how much of the into-wall speed is reflected back off it
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

// The kart is projected onto the centerline using only samples within this many
// segments of where it currently is along the track — never the global nearest.
// A local window keeps the two legs of a self-crossing (figure-8) track
// independent at the bridge, and makes corner-cutting shortcuts impossible on
// every track (projection can't jump to a far-away leg).
const WIN = 6;

// —— Track catalogue ——————————————————————————————————————————————————————————
type Pt = { x: number; y: number };
// A self-crossing track carries its bridge: where the two legs cross, the angle
// of the leg that passes over, the arc-fraction of the leg that passes under,
// and a band around it wide enough to hide the kart while it's beneath the deck.
type Bridge = { x: number; y: number; angle: number; underF: number; bandF: number };
type Track = { id: string; name: string; blurb: string; pts: Pt[]; cum: number[]; total: number; bridge?: Bridge };

/** Sample a closed parametric curve into a centerline polyline + arc lengths. */
function buildTrack(
  id: string,
  name: string,
  blurb: string,
  shape: (t: number) => Pt,
  opts?: { bridge?: boolean },
): Track {
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) pts.push(shape((i / N) * Math.PI * 2));
  const cum: number[] = [0];
  let total = 0;
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % N];
    total += Math.hypot(q.x - p.x, q.y - p.y);
    cum.push(total);
  }

  let bridge: Bridge | undefined;
  if (opts?.bridge) {
    // Locate the self-crossing as the closest pair of non-adjacent samples. The
    // higher-arc leg passes over; the lower-arc leg passes under.
    let bestD = Infinity;
    let ci = 0;
    let cj = 0;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const idxGap = Math.min(j - i, N - (j - i));
        if (idxGap < 4) continue;
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d < bestD) {
          bestD = d;
          ci = i;
          cj = j;
        }
      }
    }
    const over = pts[(cj + 1) % N];
    bridge = {
      x: (pts[ci].x + pts[cj].x) / 2,
      y: (pts[ci].y + pts[cj].y) / 2,
      angle: Math.atan2(over.y - pts[cj].y, over.x - pts[cj].x),
      underF: ci / N,
      // Half-width of the arc stretch where the kart hides under the deck —
      // roughly the deck's half-width (the under-leg crosses it) plus the kart.
      bandF: (TRACK_W / 2 + WALL + 12) / total,
    };
  }
  return { id, name, blurb, pts, cum, total, bridge };
}

const CX = W / 2;
const CY = H / 2 + 6;
// Superellipse coordinate: signed |v|^e. With e < 1 it squares an oval off into
// a rounded-rectangle "circuit" outline — long straights joined by four corners
// — instead of a plain ellipse. Used by Grand Prix for a real track shape.
const se = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;
// Local projection (see WIN) means legs that pass close together are just tight
// corners, not corridor merges — so shapes are free to pinch or even cross.
// Every layout is still checked offline (scripts/scratchpad) to fit the canvas
// and stay drivable end to end.
const TRACKS: Track[] = [
  buildTrack('speedway', 'Speedway', 'Wide and fast — flat out', (t) => ({
    x: CX + 126 * Math.cos(t),
    y: 280 + 224 * Math.sin(t),
  })),
  buildTrack('sunset', 'Sunset Loop', 'A gentle S-bend', (t) => ({
    x: CX + 108 * Math.cos(t) + 22 * Math.sin(2 * t),
    y: CY + 196 * Math.sin(t),
  })),
  // A boomerang laid on its side: a tall crescent sweeping the length of the
  // canvas. The cos(2t) term bows the loop out to one side into the wing; the
  // 37px x-offset recenters that one-sided bow. The longest lap in the set.
  buildTrack('boomerang', 'Boomerang', 'One big sweeping bend', (t) => ({
    x: CX - 37 + 94 * Math.cos(t) + 53 * Math.cos(2 * t),
    y: CY + 230 * Math.sin(t),
  })),
  // A true hourglass: the polar radius pinches to a narrow waist at mid-height
  // (small at the sides, r = 1 − 0.5·cos2t) and bulges into a lobe top and bottom.
  buildTrack('hourglass', 'Hourglass', 'Squeeze through the middle', (t) => {
    const r = 1 - 0.5 * Math.cos(2 * t);
    return { x: CX + 100 * r * Math.cos(t), y: CY + 150 * r * Math.sin(t) };
  }),
  // A pronounced slalom: a slim body with a big sin(3t) sway so the S actually
  // reads. Tighter apexes than the others, but the ±width tube stays drivable.
  buildTrack('esses', 'The Esses', 'Wiggle city — technical', (t) => ({
    x: CX + 82 * Math.cos(t) + 34 * Math.sin(3 * t),
    y: CY + 204 * Math.sin(t),
  })),
  // A squared-off superellipse circuit — long straights into four defined
  // corners, a proper racetrack outline rather than another wavy loop.
  buildTrack('grand-prix', 'Grand Prix', 'The long lap — corner after corner', (t) => ({
    x: CX + 112 * se(Math.cos(t), 0.64),
    y: CY + 214 * se(Math.sin(t), 0.7),
  })),
  // A real snake: the whole ribbon is swept along an S-shaped spine
  // (sin(π·cos t)) instead of an oval with wavy sides, so it slithers down the
  // canvas with a thin winding seam rather than reading as another slalom.
  buildTrack('serpent', 'Serpent', 'Long, snaking esses — stay smooth', (t) => ({
    x: CX + 48 * Math.sin(Math.PI * Math.cos(t)) + 68 * Math.sin(t),
    y: CY - 206 * Math.cos(t),
  })),
  buildTrack(
    'crossover',
    'Crossover',
    'Over the bridge, then under',
    (t) => ({ x: CX + 85 * Math.sin(2 * t), y: CY + 160 * Math.cos(t) }),
    { bridge: true },
  ),
];

/** Project a point onto the track's centerline, searching only the segments
 * within WIN of `seg` (the kart's current segment). Returns the distance, the
 * arc-length fraction, the nearest point (for the wall normal), and the segment
 * it landed on (feed back in next step to keep the search local). */
function project(
  track: Track,
  x: number,
  y: number,
  seg: number,
): { dist: number; f: number; px: number; py: number; seg: number } {
  let best = Infinity;
  let bestS = 0;
  let bestX = x;
  let bestY = y;
  let bestI = seg;
  for (let d = -WIN; d <= WIN; d++) {
    const i = (((seg + d) % N) + N) % N;
    const p = track.pts[i];
    const q = track.pts[(i + 1) % N];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const segLen2 = dx * dx + dy * dy || 1;
    let u = ((x - p.x) * dx + (y - p.y) * dy) / segLen2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = p.x + u * dx;
    const py = p.y + u * dy;
    const dd = Math.hypot(x - px, y - py);
    if (dd < best) {
      best = dd;
      bestS = track.cum[i] + u * Math.hypot(dx, dy);
      bestX = px;
      bestY = py;
      bestI = i;
    }
  }
  return { dist: best, f: bestS / track.total, px: bestX, py: bestY, seg: bestI };
}

type Phase = 'select' | 'countdown' | 'race' | 'done';
// `seg` is the centerline segment the kart is currently on — it anchors the
// local projection (see project) and keeps the kart on its own leg at a crossing.
type Kart = { x: number; y: number; heading: number; speed: number; seg: number };
type GS = {
  phase: Exclude<Phase, 'select'>;
  track: Track;
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

function startKart(track: Track): Kart {
  const p0 = track.pts[0];
  const p1 = track.pts[1];
  return { x: p0.x, y: p0.y, heading: Math.atan2(p1.y - p0.y, p1.x - p0.x), speed: 0, seg: 0 };
}

function freshGS(now: number, track: Track): GS {
  return {
    phase: 'countdown',
    track,
    kart: startKart(track),
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
  // wall distance from the centerline, shove it back to the barrier and split its
  // velocity into along-wall and into-wall parts. It keeps most of the along-wall
  // speed (WALL_SLIDE) so it scrapes and slides, and a little of the into-wall
  // speed is reflected back out (WALL_BOUNCE) so it deflects off the barrier
  // rather than grinding to a dead stop against it.
  const pr = project(gs.track, k.x, k.y, k.seg);
  k.seg = pr.seg;
  if (pr.dist > WALL_DIST) {
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
      const rvx = tx * WALL_SLIDE - nx * vn * WALL_BOUNCE;
      const rvy = ty * WALL_SLIDE - ny * vn * WALL_BOUNCE;
      k.speed = Math.hypot(rvx, rvy);
      if (k.speed > 0.001) k.heading = Math.atan2(rvy, rvx);
    }
  }

  // Lap progress — count a forward wrap past start/finish, once past halfway.
  // The wall push-back above is perpendicular to travel, so pr.f still holds.
  const f = pr.f;
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

// —— juice: rendering-only effects (no gameplay state) ————————————————————————
// These live outside GS so the fixed-timestep sim is never touched; they're
// advanced per animation frame with a real dt and only ever paint pixels. Built
// on the shared ./fx toolkit so every Fun Zone game shares one visual language.
type FX = {
  trail: FxVec[]; // recent kart positions → speed streak
  skids: FxVec[]; // rubber laid down on the asphalt while drifting
  particles: Particle[]; // dust on wall scrapes, sparks on a lap
  shake: number; // camera shake magnitude (px), decays to 0
  flash: number; // lap flash 0..1, decays to 0
  flashColor: string;
  popup: string; // "Lap 2" / "Best lap!" text
  popupT: number; // popup life 0..1, decays to 0
  prevHead: number; // last frame heading → drift detection
  wasWall: boolean; // touching a barrier last frame → first-contact pop
};

function freshFX(): FX {
  return {
    trail: [],
    skids: [],
    particles: [],
    shake: 0,
    flash: 0,
    flashColor: '#06b6d4',
    popup: '',
    popupT: 0,
    prevHead: 0,
    wasWall: false,
  };
}

/** Advance the visual-only effects by `dt` ms (framerate-correct). Reads kart
 *  state and the (pure) track projection to lay a motion trail, drift skids and
 *  wall-scrape dust — all painted, never fed back into the sim. */
function updateFX(fx: FX, gs: GS, dt: number) {
  const k = gs.kart;
  fx.particles = stepParticles(fx.particles, dt, 0.02);
  fx.shake = decay(fx.shake, dt, 0.02);
  fx.flash = decay(fx.flash, dt, 0.0022);
  fx.popupT = decay(fx.popupT, dt, 0.0006);

  if (gs.phase !== 'race') {
    fx.prevHead = k.heading;
    fx.wasWall = false;
    return;
  }

  // Speed streak behind the kart.
  if (k.speed > 0.25) pushTrail(fx.trail, k.x, k.y, 20);

  // Drift skids: when the heading swings hard at speed, lay two rear-wheel marks.
  let dh = k.heading - fx.prevHead;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  if (k.speed > 0.9 && Math.abs(dh) > 0.05) {
    const bx = k.x - Math.cos(k.heading) * 8;
    const by = k.y - Math.sin(k.heading) * 8;
    const ox = -Math.sin(k.heading) * 4;
    const oy = Math.cos(k.heading) * 4;
    fx.skids.push({ x: bx + ox, y: by + oy });
    fx.skids.push({ x: bx - ox, y: by - oy });
    while (fx.skids.length > 120) fx.skids.shift();
  }
  fx.prevHead = k.heading;

  // Wall-scrape dust: re-project (read-only) to see if the kart is pinned to a
  // barrier. A bigger pop + shake on first contact, then a light continuous
  // spray while it grinds along.
  const pr = project(gs.track, k.x, k.y, k.seg);
  if (pr.dist > WALL_DIST - 1.2 && k.speed > 0.55) {
    const nx = (k.x - pr.px) / (pr.dist || 1);
    const ny = (k.y - pr.py) / (pr.dist || 1);
    const cx = pr.px + nx * WALL_DIST;
    const cy = pr.py + ny * WALL_DIST;
    if (!fx.wasWall) {
      spawnBurst(fx.particles, cx, cy, 9, 150, '#dff6ff');
      fx.shake = Math.max(fx.shake, 5);
    } else if (fxRandom() < 0.6) {
      spawnBurst(fx.particles, cx, cy, 2, 70, '#dff6ff');
      fx.shake = Math.max(fx.shake, 1.6);
    }
    fx.wasWall = true;
  } else {
    fx.wasWall = false;
  }
}

// —— drawing —————————————————————————————————————————————————————————————————
/** Trace a track's centerline as a closed path on the given context. */
function traceTrack(ctx: CanvasRenderingContext2D, track: Track) {
  ctx.beginPath();
  ctx.moveTo(track.pts[0].x, track.pts[0].y);
  for (let i = 1; i <= N; i++) {
    const p = track.pts[i % N];
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

/** A top-lit cyan racer: a soft ground shadow, a gradient-shaded body with a
 *  glossy roof highlight, dark tyres and a tinted cockpit. Body dimensions match
 *  the original (render-only change — collision still uses KART_R). */
function drawKart(ctx: CanvasRenderingContext2D, k: Kart) {
  ctx.save();
  ctx.translate(k.x, k.y);
  // Contact shadow sits on the track, un-rotated.
  drawShadow(ctx, 0, 3, 13, 8, 0.4);
  ctx.rotate(k.heading);

  // Dark tyres poking out from under the body.
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(-9, -9, 5, 3);
  ctx.fillRect(4, -9, 5, 3);
  ctx.fillRect(-9, 6, 5, 3);
  ctx.fillRect(4, 6, 5, 3);

  // Lit body: a cross-body gradient reads as a rounded, top-lit shell.
  const g = ctx.createLinearGradient(0, -7, 0, 7);
  g.addColorStop(0, '#a5f3fc');
  g.addColorStop(0.5, '#06b6d4');
  g.addColorStop(1, '#0e7490');
  roundRectPath(ctx, -11, -7, 22, 14, 3);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(3,20,28,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Glossy hood highlight toward the front.
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  roundRectPath(ctx, -7, -5, 6, 3, 1.5);
  ctx.fill();

  // Cockpit toward the front.
  ctx.fillStyle = '#08131a';
  roundRectPath(ctx, 1, -4.5, 7, 9, 2);
  ctx.fill();

  ctx.restore();
}

/** Draw the crossover bridge deck over the leg that passes on top: a drop
 * shadow, an asphalt deck with side rails, and plank lines across it. Drawn
 * after the ribbon so it masks the leg passing underneath. */
function drawBridge(ctx: CanvasRenderingContext2D, b: Bridge) {
  const len = TRACK_W + WALL * 2 + 30; // along travel — long enough to span the leg below
  const wd = TRACK_W + WALL * 2; // across — matches the over-leg's ribbon
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(-len / 2, -wd / 2 + 6, len, wd); // drop shadow
  ctx.fillStyle = '#3f4650';
  ctx.fillRect(-len / 2, -wd / 2, len, wd); // deck
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(-len / 2, -wd / 2, len, WALL); // rails
  ctx.fillRect(-len / 2, wd / 2 - WALL, len, WALL);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  for (let px = -len / 2 + 8; px < len / 2; px += 12) {
    ctx.beginPath();
    ctx.moveTo(px, -wd / 2 + WALL);
    ctx.lineTo(px, wd / 2 - WALL);
    ctx.stroke();
  }
  ctx.restore();
}

/** Circular distance between two arc-fractions, in [0, 0.5]. */
function arcGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

function draw(ctx: CanvasRenderingContext2D, gs: GS, now: number, fx: FX) {
  const track = gs.track;
  ctx.clearRect(0, 0, W, H);

  // —— Grass infield with depth ——
  const grass = ctx.createLinearGradient(0, 0, 0, H);
  grass.addColorStop(0, '#1a4526');
  grass.addColorStop(0.5, '#14361f');
  grass.addColorStop(1, '#0f2817');
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, W, H);
  // Soft overhead sheen on the grass.
  const glow = ctx.createRadialGradient(W / 2, H * 0.3, 20, W / 2, H * 0.3, H * 0.75);
  glow.addColorStop(0, 'rgba(120,200,150,0.10)');
  glow.addColorStop(1, 'rgba(120,200,150,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Barriers: a solid band the full track width plus a wall on each edge, drawn
  // under the asphalt so the asphalt masks the middle and leaves a wall ring.
  traceTrack(ctx, track);
  ctx.strokeStyle = '#0b0f14';
  ctx.lineWidth = TRACK_W + WALL * 2 + 2;
  ctx.stroke();
  // Wall ring, faintly lit so the barrier reads as a raised kerb.
  const wallGrad = ctx.createLinearGradient(0, 0, 0, H);
  wallGrad.addColorStop(0, '#eef4fb');
  wallGrad.addColorStop(1, '#c3ccd8');
  traceTrack(ctx, track);
  ctx.strokeStyle = wallGrad;
  ctx.lineWidth = TRACK_W + WALL * 2;
  ctx.stroke();
  // Asphalt on top, leaving the wall ring exposed on both edges.
  const asphalt = ctx.createLinearGradient(0, 0, 0, H);
  asphalt.addColorStop(0, '#474e59');
  asphalt.addColorStop(0.5, '#3a414b');
  asphalt.addColorStop(1, '#2f353e');
  traceTrack(ctx, track);
  ctx.strokeStyle = asphalt;
  ctx.lineWidth = TRACK_W;
  ctx.stroke();
  // Top-lit sheen streak down the asphalt.
  const sheen = ctx.createLinearGradient(0, 0, 0, H);
  sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  traceTrack(ctx, track);
  ctx.strokeStyle = sheen;
  ctx.lineWidth = TRACK_W;
  ctx.stroke();
  // Dashed centre lane marking.
  traceTrack(ctx, track);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 12]);
  ctx.stroke();
  ctx.setLineDash([]);

  // —— Drift skids: rubber laid on the asphalt (static, under everything) ——
  if (fx.skids.length) {
    ctx.save();
    ctx.fillStyle = 'rgba(10,12,16,0.30)';
    for (const s of fx.skids) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.6, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  // Start/finish line — a checkered band with a soft neon gate glow.
  const p0 = track.pts[0];
  const p1 = track.pts[1];
  const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  ctx.save();
  ctx.translate(p0.x, p0.y);
  ctx.rotate(ang + Math.PI / 2);
  const half = TRACK_W / 2;
  const sq = TRACK_W / 4;
  neonLine(ctx, -half, -sq - 1, half, -sq - 1, '#22d3ee', 3, 12);
  neonLine(ctx, -half, sq + 1, half, sq + 1, '#22d3ee', 3, 12);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#0b0f14';
      ctx.fillRect(-half + c * sq, -sq + r * sq, sq, sq);
    }
  }
  ctx.restore();

  // —— Dynamic layer (the moving world) ——
  // Camera shake jolts the moving pieces — the kart, its trail and the dust — on
  // impacts and laps. The bridge, like the walls and asphalt, is fixed track
  // infrastructure and is drawn OUTSIDE the shake: rattling the crossover deck on
  // a wall bump reads as the whole bridge wobbling, which it shouldn't.
  const s = fx.shake > 0.05 ? shakeOffset(fx.shake) : null;

  // Which leg the kart is on decides its layering against the fixed bridge deck:
  // near the bridge's under-arc it passes beneath the deck (draw deck last to hide
  // it); otherwise it rides over the top (draw deck first).
  const k = gs.kart;
  const b = track.bridge;
  const underBridge = b !== undefined && arcGap(gs.prevF, b.underF) < b.bandF;
  if (b && !underBridge) drawBridge(ctx, b);

  ctx.save();
  if (s) ctx.translate(s.x, s.y);

  // Lure: while dragging, show where you're leading the kart.
  if (gs.phase === 'race' && gs.touch.active) {
    ctx.save();
    ctx.shadowColor = 'rgba(251,191,36,0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(gs.touch.x, gs.touch.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251,191,36,0.30)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(251,191,36,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // Speed streak trailing the kart.
  for (let i = 0; i < fx.trail.length; i++) {
    const t = fx.trail[i];
    const kf = i / fx.trail.length;
    ctx.beginPath();
    ctx.arc(t.x, t.y, KART_R * (0.25 + kf * 0.7), 0, TWO_PI);
    ctx.fillStyle = `rgba(103,232,249,${0.02 + kf * 0.14})`;
    ctx.fill();
  }

  drawKart(ctx, k);

  // Dust / spark bursts, additive.
  drawParticles(ctx, fx.particles);
  ctx.restore();

  if (b && underBridge) drawBridge(ctx, b);

  // —— Lap flash overlay ——
  if (fx.flash > 0) {
    ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.22);
    ctx.fillRect(0, 0, W, H);
  }

  // —— Lap / best-lap popup, glowing and floating up ——
  if (fx.popupT > 0 && fx.popup) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, fx.popupT);
    ctx.fillStyle = '#ecfeff';
    ctx.shadowColor = 'rgba(6,182,212,0.9)';
    ctx.shadowBlur = 16;
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fx.popup, W / 2, H * 0.32 - (1 - fx.popupT) * 22);
    ctx.restore();
  }

  // Countdown.
  if (gs.phase === 'countdown') {
    const left = COUNTDOWN_MS - (now - gs.countStart);
    const n = Math.ceil(left / 800);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = 'rgba(251,191,36,0.7)';
    ctx.shadowBlur = 18;
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n > 3 ? '3' : n <= 0 ? 'GO!' : String(n), W / 2, H / 2);
    ctx.restore();
  }
}

const fmt = (ms: number) => (ms / 1000).toFixed(2);

/** Miniature preview of a track's silhouette for the picker. */
function TrackThumb({ track }: { track: Track }) {
  const size = 76;
  const pad = 11;
  let minx = Infinity;
  let maxx = -Infinity;
  let miny = Infinity;
  let maxy = -Infinity;
  for (const p of track.pts) {
    if (p.x < minx) minx = p.x;
    if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y;
    if (p.y > maxy) maxy = p.y;
  }
  const w = maxx - minx || 1;
  const h = maxy - miny || 1;
  const inner = size - pad * 2;
  const s = inner / Math.max(w, h);
  const ox = pad + (inner - w * s) / 2 - minx * s;
  const oy = pad + (inner - h * s) / 2 - miny * s;
  const d =
    track.pts
      .map((p, i) => `${i ? 'L' : 'M'}${(p.x * s + ox).toFixed(1)} ${(p.y * s + oy).toFixed(1)}`)
      .join(' ') + ' Z';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <path d={d} fill="none" stroke="#e2e8f0" strokeWidth={Math.max(6, (TRACK_W + WALL * 2) * s)} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke="#3f4650" strokeWidth={Math.max(4, TRACK_W * s)} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function GoKarts() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gsRef = useRef<GS | null>(null);
  const fxRef = useRef<FX>(freshFX());
  // Best lap per track id, held for the life of the screen so the picker can
  // show your personal best on each circuit.
  const bestsRef = useRef<Record<string, number>>({});

  const [phase, setPhase] = useState<Phase>('select');
  const [lap, setLap] = useState(0);
  const [raceTime, setRaceTime] = useState(0);
  const [best, setBest] = useState<number>(Infinity);

  const racing = phase === 'countdown' || phase === 'race';
  useFitCanvas(canvasRef, W, H, racing);

  const startRace = useCallback((track: Track) => {
    const gs = freshGS(performance.now(), track);
    gs.best = bestsRef.current[track.id] ?? Infinity;
    gsRef.current = gs;
    fxRef.current = freshFX();
    setPhase('countdown');
    setLap(0);
    setRaceTime(0);
    setBest(gs.best);
  }, []);

  useEffect(() => {
    if (!racing) return;
    const gs = gsRef.current;
    if (!gs) return;
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
        gs.countStart += performance.now() - hiddenAt;
        hiddenAt = 0;
        last = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const loop = (now: number) => {
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(loop);
        return;
      }
      const dt = Math.min(now - last, 100);
      last = now;
      const fx = fxRef.current;

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
            const isBest = lapMs < gs.best; // read before gs.best mutates (FX only)
            gs.lastLap = lapMs;
            if (lapMs < gs.best) {
              gs.best = lapMs;
              bestsRef.current[gs.track.id] = lapMs;
              setBest(lapMs);
            }
            gs.lapStart = gs.raceTime;
            // —— juice (rendering only): flash + spark burst on every lap, a
            // brighter one on a personal best ——
            fx.flash = 1;
            fx.flashColor = isBest ? '#06b6d4' : '#22d3ee';
            fx.shake = Math.max(fx.shake, isBest ? 6 : 4);
            spawnBurst(
              fx.particles,
              gs.kart.x,
              gs.kart.y,
              isBest ? 26 : 16,
              isBest ? 300 : 200,
              isBest ? '#a5f3fc' : '#67e8f9',
            );
            fx.popup = isBest ? 'Best lap!' : `Lap ${gs.laps}`;
            fx.popupT = 1;
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

      updateFX(fx, gs, dt);
      draw(ctx, gs, now, fx);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [racing]);

  const toField = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  }, []);

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      const gs = gsRef.current;
      if (!gs) return;
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
      if (gs?.touch.active) {
        const p = toField(e);
        gs.touch.x = p.x;
        gs.touch.y = p.y;
      }
    },
    [toField],
  );
  const onUp = useCallback(() => {
    if (gsRef.current) gsRef.current.touch.active = false;
  }, []);

  // —— Track picker —————————————————————————————————————————————————————————
  if (phase === 'select') {
    return (
      <Screen>
        <TopBar title="Go-Karts" back="/fun" />
        <Content>
          <p className="mb-3 text-sm text-fairway-100/80">
            Pick a track — drag to lead your kart around. {LAPS} laps, fastest lap wins.
          </p>
          <div className="flex flex-col gap-3">
            {TRACKS.map((tk) => {
              const b = bestsRef.current[tk.id];
              return (
                <button
                  key={tk.id}
                  onClick={() => {
                    playClick();
                    startRace(tk);
                  }}
                  className="flex items-center gap-3 rounded-2xl border border-fairway-800 bg-fairway-900/40 p-3 text-left transition active:scale-[0.99] active:bg-fairway-800/50"
                >
                  <TrackThumb track={tk} />
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-bold text-fairway-50">{tk.name}</div>
                    <div className="text-sm text-fairway-300">{tk.blurb}</div>
                    <div className="mt-0.5 text-xs text-fairway-400">
                      Best lap{' '}
                      <span className="font-semibold text-fairway-200">{b === undefined ? '—' : `${fmt(b)}s`}</span>
                    </div>
                  </div>
                  <span className="text-xl text-fairway-500">›</span>
                </button>
              );
            })}
          </div>
        </Content>
      </Screen>
    );
  }

  const track = gsRef.current!.track;

  // —— Results —————————————————————————————————————————————————————————————
  if (phase === 'done') {
    const total = gsRef.current!.raceTime;
    return (
      <Screen>
        <TopBar title="Go-Karts" back="/fun" right={<span className="pr-1 text-sm text-fairway-300">{track.name}</span>} />
        <Content>
          <div className="animate-trophy-pop mt-6 flex flex-col items-center gap-3 text-center">
            <span className="text-6xl">🏁</span>
            <div className="text-2xl font-black text-fairway-50">Race complete!</div>
            <div className="text-5xl font-black text-fairway-50">{fmt(total)}s</div>
            <p className="text-sm text-fairway-300">
              Best lap <span className="font-bold text-fairway-100">{best === Infinity ? '—' : `${fmt(best)}s`}</span>
              {' · '}
              {track.name} · {LAPS} laps
            </p>
          </div>
          <div className="mt-8 flex flex-col gap-3">
            <Button onClick={() => startRace(track)} sound="none">
              Race again
            </Button>
            <Button variant="ghost" onClick={() => setPhase('select')}>
              Pick another track
            </Button>
          </div>
        </Content>
      </Screen>
    );
  }

  // —— Race / countdown ————————————————————————————————————————————————————
  return (
    <div className="animate-page-in mx-auto flex h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title="Go-Karts" back="/fun" right={<span className="pr-1 text-sm text-fairway-300">{track.name}</span>} />
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 text-sm">
        <span className="font-bold text-fairway-50">
          Lap <span className="text-fairway-100">{Math.min(lap, LAPS)}</span>
          <span className="font-normal text-fairway-400"> / {LAPS}</span>
        </span>
        <span className="text-fairway-300">
          {fmt(raceTime)}s
          <span className="mx-2 text-fairway-700">·</span>
          Best {best === Infinity ? '—' : `${fmt(best)}s`}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="block touch-none rounded-2xl border border-fairway-800"
        />
      </div>

      <p className="min-h-[2.5rem] shrink-0 px-4 pb-4 pt-3 text-center text-sm text-fairway-100/80">
        {phase === 'countdown'
          ? 'Get ready…'
          : 'Drag to lead the kart — it follows your finger. Keep off the walls!'}
      </p>
    </div>
  );
}
