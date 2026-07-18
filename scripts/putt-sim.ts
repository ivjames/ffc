// Offline validation for the course. Not shipped — run with esbuild+node.
// Checks each hole is geometrically sane and actually completable.
import {
  W, H, BALL_R, HOLE_R, MIN_SHOT, MAX_SHOT,
  HOLES, sdUnion, sdSurface, stepPhysics, type Hole, type Ball, type Seg, type Outcome,
} from '../src/features/putt/world.ts';

// A cell the ball could rest in: on the playable surface, clear of walls, and
// not in the water (water sinks the ball, so a route must go around it). Sand
// is passable (just draggy), so it doesn't block the route.
function freeAt(x: number, y: number, h: Hole): boolean {
  if (sdSurface(x, y, h) > -BALL_R) return false;
  if (h.walls && h.walls.length && sdUnion(x, y, h.walls) < BALL_R) return false;
  if (h.water && h.water.length && sdUnion(x, y, h.water) < 0) return false;
  return true;
}

// A hazard blob must sit fully inside the surface, or the surface clip chops it
// into a crescent when drawn.
function insideSurface(segs: Seg[] | undefined, h: Hole): boolean {
  if (!segs) return true;
  return segs.every((s) => sdSurface(s.ax, s.ay, h) <= -s.r && sdSurface(s.bx, s.by, h) <= -s.r);
}

// BFS over free cells: is the cup reachable from the tee through the green,
// going around the walls? Proves the hole is completable in principle.
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
  if (sdSurface(h.tee.x, h.tee.y, h) > -(BALL_R + 2)) fail('tee not safely on the surface');
  if (sdUnion(h.cup.x, h.cup.y, h.green) > -(HOLE_R + 2)) fail('cup not safely inside the green');
  if (h.walls && sdUnion(h.cup.x, h.cup.y, h.walls) < HOLE_R) fail('cup overlaps a wall');
  if (h.pits && sdUnion(h.cup.x, h.cup.y, h.pits) < 0) fail('cup sits in the sand');
  if (h.water && sdUnion(h.cup.x, h.cup.y, h.water) < 0) fail('cup sits in the water');
  if (h.walls && sdUnion(h.tee.x, h.tee.y, h.walls) < BALL_R) fail('tee overlaps a wall');
  if (h.pits && sdUnion(h.tee.x, h.tee.y, h.pits) < 0) fail('tee starts in the sand');
  if (h.water && sdUnion(h.tee.x, h.tee.y, h.water) < 0) fail('tee starts in the water');
  if (!insideSurface(h.pits, h)) fail('a bunker spills past the surface (would be chopped)');
  if (!insideSurface(h.water, h)) fail('a water hazard spills past the surface (would be chopped)');
  if (h.water && h.walls && h.water.some((s) => sdUnion(s.ax, s.ay, h.walls!) < s.r))
    fail('a water hazard overlaps a wall');
  for (const s of [...h.fairway, ...h.green]) {
    const minX = Math.min(s.ax, s.bx) - s.r;
    const maxX = Math.max(s.ax, s.bx) + s.r;
    const minY = Math.min(s.ay, s.by) - s.r;
    const maxY = Math.max(s.ay, s.by) + s.r;
    if (minX < 2 || minY < 2 || maxX > W - 2 || maxY > H - 2) fail('surface segment spills past the field');
  }

  // Completability.
  if (!pathExists(h)) fail('no free path from tee to cup (blocked by walls)');

  // Shot-space stability + progress from the tee.
  let sunk1 = 0;
  let waters = 0;
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
      if (out === 'sunk') { sunk1++; bestDist = 0; continue; }
      if (out === 'water') {
        waters++;
        // the drop point must be on the surface and clear of walls (near the
        // rail is fine); it's the entry edge, so it may touch the water.
        if (sdSurface(b.x, b.y, h) > 0) fail('a water drop lands off the surface');
        if (h.walls && sdUnion(b.x, b.y, h.walls) < 0) fail('a water drop lands in a wall');
        continue;
      }
      bestDist = Math.min(bestDist, Math.hypot(b.x - h.cup.x, b.y - h.cup.y));
    }
  }
  if (nans) fail(`${nans} shots produced NaN`);
  if (timeouts) fail(`${timeouts} shots never came to rest`);
  if (bestDist > 120 && sunk1 === 0) fail(`no tee shot gets near the cup (best ${bestDist.toFixed(0)}px)`);

  const waterNote = h.water ? ` · ${waters} splashes` : '';
  console.log(`  ✓ path ok · ${sunk1} one-shot sinks · best approach ${bestDist.toFixed(0)}px${waterNote}`);
}

console.log(failures === 0 ? '\nALL HOLES VALID ✓' : `\n${failures} PROBLEM(S) ✗`);
if (failures > 0) process.exit(1);
