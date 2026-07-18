// Offline validation for the course. Not shipped — run with esbuild+node.
// Checks each hole is geometrically sane and actually completable.
import {
  W, H, BALL_R, HOLE_R, MIN_SHOT, MAX_SHOT, MAX_DRAG,
  HOLES, sdUnion, stepPhysics, type Hole, type Ball, type Outcome,
} from '../src/features/putt/world.ts';

function freeAt(x: number, y: number, h: Hole): boolean {
  if (sdUnion(x, y, h.green) > -BALL_R) return false;
  if (h.walls && h.walls.length && sdUnion(x, y, h.walls) < BALL_R) return false;
  if (h.pits && h.pits.length && sdUnion(x, y, h.pits) < 0) return false;
  return true;
}

// BFS over free cells: is the cup reachable from the tee through the green,
// going around walls and pits? Proves the hole is completable in principle.
function pathExists(h: Hole): boolean {
  const step = 4;
  const cols = Math.floor(W / step);
  const rows = Math.floor(H / step);
  const key = (c: number, r: number) => r * cols + c;
  const snap = (p: { x: number; y: number }) => ({
    c: Math.round(p.x / step),
    r: Math.round(p.y / step),
  });
  const start = snap(h.tee);
  const goal = snap(h.cup);
  const seen = new Set<number>();
  const q: Array<[number, number]> = [[start.c, start.r]];
  seen.add(key(start.c, start.r));
  while (q.length) {
    const [c, r] = q.shift()!;
    if (Math.abs(c - goal.c) <= 1 && Math.abs(r - goal.r) <= 1) return true;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const k = key(nc, nr);
      if (seen.has(k)) continue;
      if (!freeAt(nc * step, nr * step, h)) continue;
      seen.add(k);
      q.push([nc, nr]);
    }
  }
  return false;
}

function simShot(h: Hole, from: { x: number; y: number }, angle: number, power: number) {
  const speed = MIN_SHOT + power * (MAX_SHOT - MIN_SHOT);
  const b: Ball = { x: from.x, y: from.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  let out: Outcome = 'rolling';
  for (let f = 0; f < 6000; f++) {
    out = stepPhysics(b, h);
    if (Number.isNaN(b.x) || Number.isNaN(b.y)) return { out: 'nan' as const, b };
    if (out !== 'rolling') return { out, b };
  }
  return { out: 'timeout' as const, b };
}

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log('  ✗ ' + msg);
};

for (let i = 0; i < HOLES.length; i++) {
  const h = HOLES[i];
  console.log(`Hole ${i + 1} (par ${h.par})`);

  // Geometry sanity.
  if (sdUnion(h.tee.x, h.tee.y, h.green) > -(BALL_R + 2)) fail('tee not safely inside green');
  if (sdUnion(h.cup.x, h.cup.y, h.green) > -(HOLE_R + 2)) fail('cup not safely inside green');
  if (h.walls && sdUnion(h.cup.x, h.cup.y, h.walls) < HOLE_R) fail('cup overlaps a wall');
  if (h.pits && sdUnion(h.cup.x, h.cup.y, h.pits) < HOLE_R) fail('cup overlaps a pit');
  if (h.walls && sdUnion(h.tee.x, h.tee.y, h.walls) < BALL_R) fail('tee overlaps a wall');
  if (h.pits && sdUnion(h.tee.x, h.tee.y, h.pits) < 0) fail('tee overlaps a pit');
  for (const s of h.green) {
    const minX = Math.min(s.ax, s.bx) - s.r;
    const maxX = Math.max(s.ax, s.bx) + s.r;
    const minY = Math.min(s.ay, s.by) - s.r;
    const maxY = Math.max(s.ay, s.by) + s.r;
    if (minX < 2 || minY < 2 || maxX > W - 2 || maxY > H - 2) fail('green segment spills past the field');
  }

  // Completability.
  if (!pathExists(h)) fail('no free path from tee to cup (blocked by walls/pits)');

  // Shot-space stability + progress from the tee.
  let sunk1 = 0;
  let pits = 0;
  let clear = 0; // non-pit terminations
  let timeouts = 0;
  let nans = 0;
  let bestDist = Infinity;
  const angles = 48;
  for (let a = 0; a < angles; a++) {
    const ang = (a / angles) * Math.PI * 2;
    for (let p = 0.15; p <= 1.0001; p += 0.05) {
      const { out, b } = simShot(h, h.tee, ang, p);
      if (out === 'nan') { nans++; continue; }
      if (out === 'timeout') { timeouts++; continue; }
      if (out === 'sunk') { sunk1++; clear++; bestDist = 0; continue; }
      if (out === 'pit') { pits++; continue; }
      clear++;
      bestDist = Math.min(bestDist, Math.hypot(b.x - h.cup.x, b.y - h.cup.y));
    }
  }
  if (nans) fail(`${nans} shots produced NaN`);
  if (timeouts) fail(`${timeouts} shots never came to rest`);
  if (clear === 0) fail('every shot from the tee falls in a pit (unavoidable hazard)');
  if (bestDist > 120 && sunk1 === 0) fail(`no tee shot gets near the cup (best ${bestDist.toFixed(0)}px)`);

  console.log(
    `  ✓ path ok · ${sunk1} one-shot sinks · best approach ${bestDist.toFixed(0)}px · ${pits} pit / ${clear} clear`,
  );
}

console.log(failures === 0 ? '\nALL HOLES VALID ✓' : `\n${failures} PROBLEM(S) ✗`);
if (failures > 0) process.exit(1);
