// Arcade Putt — the pure "world": geometry + physics, no React, no canvas.
// Both the game component and the offline validation sim import this module, so
// there is a single source of truth for how the course plays.
//
// Everything smooth by construction. The only primitive is a CAPSULE: a segment
// (ax,ay)->(bx,by) inflated by radius r — a rounded "stadium". A disc is the
// degenerate case where the endpoints coincide. Unions of capsules give us
// rounded lanes, circular greens fed by narrow channels, curved walls (a chain
// of capsules along an arc), and blobby pits — all with no sharp corners.
//
// The playable surface has two parts: the FAIRWAY (approach lanes/channels) and
// the GREEN (the putting surface around the cup). They play the same except at
// the green's exposed edge, which carries a slow "rough" collar. Collision is
// signed-distance based: sdSurface keeps the ball on the playable surface,
// walls bounce it, pits (sand) bog it down.

export const W = 360;
export const H = 540;
export const BALL_R = 8;
export const HOLE_R = 13;

// Physics tuning (per-frame at ~60fps).
export const FRICTION = 0.985; // velocity retained each frame on fairway/green
export const FRICTION_ROUGH = 0.955; // the rough collar around the green's edge
export const FRICTION_SAND = 0.87; // a bunker bogs the ball down significantly
export const ROUGH_BAND = 12; // width of the rough collar inside the green edge
// Blend radius (px) for the smooth union that fillets hazard/rough junctions.
// A plain min-union of overlapping discs leaves a sharp concave "waist" at every
// crossing — a chain reads as a bunch of grapes. Smoothing the union rounds each
// waist into a fillet so a cluster renders (and plays) as one continuous blob.
// A blob's field grows by up to ~BLOB_K/4 px at a junction (along the interior
// ridge between two discs). That can slightly exceed the validator's 2px
// HAZARD_MARGIN, so a smooth contour may round out a touch toward the rail; the
// hazard renderer clips to the surface and the splash test is gated on-surface,
// so such a sliver is trimmed at the rail rather than spilling off the surface.
export const BLOB_K = 9;
export const WALL_REST = 0.66; // energy kept on a bounce off a rail/wall
export const STOP_SPEED = 0.16; // below this the ball is "at rest"
export const MIN_SHOT = 3.0; // px/frame at 0% power
export const MAX_SHOT = 14.5; // px/frame at 100% power
export const CAPTURE_SPEED = 5.8; // dead-centre drop speed; the capture radius shrinks to 0 at this speed
export const RIM_REST = 0.5; // energy kept when the ball catches the lip and rings out
export const MAX_DRAG = 132; // drag length (field units) that maps to full power
export const DROP_CLEAR = 4; // gap (px) left between the re-dropped ball and the pool edge

export type Seg = { ax: number; ay: number; bx: number; by: number; r: number };
export type Ball = { x: number; y: number; vx: number; vy: number };
export type Hole = {
  par: number;
  tee: { x: number; y: number };
  cup: { x: number; y: number };
  fairway: Seg[]; // approach lanes/channels — no rough
  green: Seg[]; // putting surface around the cup — has a rough collar at its edge
  walls?: Seg[]; // solid obstacles, incl. curved ones (bounce off)
  pits?: Seg[]; // sand bunkers (heavy drag) — kept fully inside the surface
  water?: Seg[]; // water hazards — ball sinks, reappears near entry with a penalty
  rough?: Seg[]; // patches of authored rough on the surface — slow, like the collar
};
export type Outcome = 'rolling' | 'stopped' | 'sunk' | 'water';

/** Capsule from A to B with radius r. */
export function cap(ax: number, ay: number, bx: number, by: number, r: number): Seg {
  return { ax, ay, bx, by, r };
}
/** A disc is a zero-length capsule. */
export function disc(x: number, y: number, r: number): Seg {
  return { ax: x, ay: y, bx: x, by: y, r };
}

/** Signed distance from (px,py) to one capsule (negative inside). */
function sdSeg(px: number, py: number, s: Seg): number {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const len2 = ex * ex + ey * ey;
  let t = 0;
  if (len2 > 1e-9) {
    t = ((px - s.ax) * ex + (py - s.ay) * ey) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const cx = s.ax + ex * t;
  const cy = s.ay + ey * t;
  return Math.hypot(px - cx, py - cy) - s.r;
}

/** Signed distance to a union of capsules (min over the set). */
export function sdUnion(px: number, py: number, segs: Seg[]): number {
  let d = Infinity;
  for (const s of segs) {
    const ds = sdSeg(px, py, s);
    if (ds < d) d = ds;
  }
  return d;
}

/** Polynomial smooth-min: a min that rounds the crease where the two fields
 *  meet, with blend width k. Reduces to Math.min as the inputs pull apart. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Signed distance to a *smooth* union of capsules — a min-union with every
 *  concave junction filleted (blend width BLOB_K). This is what turns a chain of
 *  overlapping discs from a bunch of grapes into a single blob, used for both the
 *  hazard/rough rendering and the collision that matches it. */
export function sdBlob(px: number, py: number, segs: Seg[]): number {
  let d = Infinity;
  for (const s of segs) {
    const ds = sdSeg(px, py, s);
    d = d === Infinity ? ds : smin(d, ds, BLOB_K);
  }
  return d;
}

/** Signed distance to the whole playable surface (fairway ∪ green). */
export function sdSurface(px: number, py: number, h: Hole): number {
  return Math.min(sdUnion(px, py, h.fairway), sdUnion(px, py, h.green));
}

/** Outward-pointing unit normal of the playable-surface field. */
function gradSurface(px: number, py: number, h: Hole): [number, number] {
  const e = 0.6;
  const dx = sdSurface(px + e, py, h) - sdSurface(px - e, py, h);
  const dy = sdSurface(px, py + e, h) - sdSurface(px, py - e, h);
  const l = Math.hypot(dx, dy) || 1e-6;
  return [dx / l, dy / l];
}

/** Outward-pointing unit normal of a capsule-union field. */
function gradUnion(px: number, py: number, segs: Seg[]): [number, number] {
  const e = 0.6;
  const dx = sdUnion(px + e, py, segs) - sdUnion(px - e, py, segs);
  const dy = sdUnion(px, py + e, segs) - sdUnion(px, py - e, segs);
  const l = Math.hypot(dx, dy) || 1e-6;
  return [dx / l, dy / l];
}

/** Reflect the ball's velocity about normal (nx,ny) with restitution. */
function reflect(b: Ball, nx: number, ny: number) {
  const vd = b.vx * nx + b.vy * ny;
  b.vx -= (1 + WALL_REST) * vd * nx;
  b.vy -= (1 + WALL_REST) * vd * ny;
}

// Resolve the ball against one substep of motion. Returns 'sunk' if it dropped
// or 'water' if it splashed this substep, else null. (Surface friction is
// applied per-frame, not here.)
function resolve(b: Ball, hole: Hole): 'sunk' | 'water' | null {
  // Hard field-edge rail — a safety net so the ball can never end up off-screen
  // even where a surface's rounded end meets the field boundary.
  if (b.x < BALL_R) {
    b.x = BALL_R;
    if (b.vx < 0) b.vx = -b.vx * WALL_REST;
  } else if (b.x > W - BALL_R) {
    b.x = W - BALL_R;
    if (b.vx > 0) b.vx = -b.vx * WALL_REST;
  }
  if (b.y < BALL_R) {
    b.y = BALL_R;
    if (b.vy < 0) b.vy = -b.vy * WALL_REST;
  } else if (b.y > H - BALL_R) {
    b.y = H - BALL_R;
    if (b.vy > 0) b.vy = -b.vy * WALL_REST;
  }

  // Keep the ball on the playable surface (its boundary is the rail).
  const g = sdSurface(b.x, b.y, hole);
  if (g > -BALL_R) {
    const [nx, ny] = gradSurface(b.x, b.y, hole); // points outward
    const pen = g + BALL_R;
    b.x -= nx * pen;
    b.y -= ny * pen;
    if (b.vx * nx + b.vy * ny > 0) reflect(b, nx, ny);
  }

  // Bounce off solid walls (curved bars, bumpers).
  if (hole.walls && hole.walls.length) {
    const o = sdUnion(b.x, b.y, hole.walls);
    if (o < BALL_R) {
      const [nx, ny] = gradUnion(b.x, b.y, hole.walls); // points away from wall
      const pen = BALL_R - o;
      b.x += nx * pen;
      b.y += ny * pen;
      if (b.vx * nx + b.vy * ny < 0) reflect(b, nx, ny);
    }
  }

  // Water: signal a splash once the ball's center is over the water. The caller
  // drops the ball back at the point it entered from (on the surface) and adds
  // the penalty stroke.
  // Gate on being on the surface too: the rendered pool is clipped to the
  // surface, so a splash can only happen where water is actually drawn — never on
  // a sliver of the smooth blob that rounds out past the rail.
  if (
    hole.water &&
    hole.water.length &&
    sdBlob(b.x, b.y, hole.water) < 0 &&
    sdSurface(b.x, b.y, hole) < 0
  ) {
    return 'water';
  }

  // Cup rim. The hole drops the ball only when its center is inside a capture
  // radius that shrinks with speed: dead-center it's the full HOLE_R, and it
  // narrows to nothing at CAPTURE_SPEED. So a centered ball at a crawl falls,
  // but a fast one — or one whose center only grazes the rim — is not captured.
  // There is no magnet: nothing draws a near-miss toward the cup.
  const dxc = hole.cup.x - b.x;
  const dyc = hole.cup.y - b.y;
  const dc = Math.hypot(dxc, dyc);
  if (dc < HOLE_R) {
    const s = Math.hypot(b.vx, b.vy);
    const depth = 1 - dc / HOLE_R; // 0 at the rim → 1 dead-center
    if (s < CAPTURE_SPEED * depth) {
      b.x = hole.cup.x;
      b.y = hole.cup.y;
      b.vx = 0;
      b.vy = 0;
      return 'sunk';
    }
    // Not captured: the ball catches the FAR lip. The rim reflects the ball's
    // outward motion back inward as it tries to climb out the far side, while
    // its sideways motion carries it around — so it rings the rim. A ball with
    // pace escapes and lips out; a slow one rattles and drops. The near lip is
    // never reflected, so a gentle centered putt rolls in and falls freely.
    const ox = dc > 1e-6 ? -dxc / dc : 0; // outward radial (cup → ball)
    const oy = dc > 1e-6 ? -dyc / dc : 0;
    const vr = b.vx * ox + b.vy * oy; // > 0 while climbing out the far side
    if (vr > 0) {
      b.vx -= (1 + RIM_REST) * vr * ox;
      b.vy -= (1 + RIM_REST) * vr * oy;
    }
  }
  return null;
}

/** True when (x,y) is on the rough collar: inside the green, near its edge, and
 *  not on the fairway — so the approach lane stays clear of rough where it
 *  meets the green. */
export function inRough(x: number, y: number, h: Hole): boolean {
  const sdG = sdUnion(x, y, h.green);
  return sdG < 0 && sdG > -ROUGH_BAND && sdUnion(x, y, h.fairway) >= 0;
}

/** Where a splashed ball re-drops: the nearest spot to the splash (sx,sy) that
 *  is on the surface, clear of walls, and fully outside the pool (by DROP_CLEAR,
 *  so the ball isn't touching the water). Spiral outward and take the first hit,
 *  which — since the radius only grows — is the closest such spot. Falls back to
 *  the nearest merely-outside-the-pool point, then to the splash itself. */
function waterDropPoint(hole: Hole, sx: number, sy: number): { x: number; y: number } {
  let nearestOutside: { x: number; y: number } | null = null;
  for (let rad = BALL_R; rad <= 80; rad += 3) {
    for (let a = 0; a < 18; a++) {
      const ang = (a / 18) * Math.PI * 2 + rad * 0.7; // twist per ring: no axis bias
      const x = sx + Math.cos(ang) * rad;
      const y = sy + Math.sin(ang) * rad;
      if (x < BALL_R || x > W - BALL_R || y < BALL_R || y > H - BALL_R) continue;
      if (sdSurface(x, y, hole) > -BALL_R) continue; // whole ball must sit on the surface
      if (hole.walls && hole.walls.length && sdUnion(x, y, hole.walls) < BALL_R) continue;
      if (hole.water && sdBlob(x, y, hole.water) < 0) continue; // never re-drop inside the pool
      if (!hole.water || sdBlob(x, y, hole.water) >= BALL_R + DROP_CLEAR) return { x, y };
      if (!nearestOutside) nearestOutside = { x, y };
    }
  }
  return nearestOutside ?? { x: sx, y: sy };
}

/** Advance the ball one frame. Sub-steps keep fast shots from tunnelling. On a
 *  splash, `info` (if given) receives the splash point — where the ball went
 *  under — while the ball itself is left at the safe re-drop spot. */
export function stepPhysics(
  b: Ball,
  hole: Hole,
  info?: { splashX: number; splashY: number },
): Outcome {
  const speed = Math.hypot(b.vx, b.vy);
  const steps = Math.max(1, Math.ceil(speed / (BALL_R * 0.5)));
  for (let i = 0; i < steps; i++) {
    b.x += b.vx / steps;
    b.y += b.vy / steps;
    const outcome = resolve(b, hole);
    if (outcome === 'water') {
      // The ball's centre is over the water here — that's the splash point. Sink
      // it there (for the animation), then re-drop it clear of the pool.
      if (info) {
        info.splashX = b.x;
        info.splashY = b.y;
      }
      const drop = waterDropPoint(hole, b.x, b.y);
      b.x = drop.x;
      b.y = drop.y;
      b.vx = 0;
      b.vy = 0;
      return 'water';
    }
    if (outcome) return outcome;
  }
  // Surface friction: fairway/green normally, the rough (the green's collar or an
  // authored rough patch), or — draggiest of all — a sand bunker.
  let fr = FRICTION;
  if (inRough(b.x, b.y, hole)) fr = FRICTION_ROUGH;
  else if (hole.rough && hole.rough.length && sdBlob(b.x, b.y, hole.rough) < 0) fr = FRICTION_ROUGH;
  if (hole.pits && hole.pits.length && sdBlob(b.x, b.y, hole.pits) < 0) fr = FRICTION_SAND;
  b.vx *= fr;
  b.vy *= fr;
  if (Math.hypot(b.vx, b.vy) < STOP_SPEED) {
    b.vx = 0;
    b.vy = 0;
    return 'stopped';
  }
  return 'rolling';
}

// --- The course: nine holes ------------------------------------------------
// Each hole is a fairway (approach) feeding a green (putting surface) around the
// cup. Curved walls, blobby sand/water and patches of rough down the edges add
// variety. Hazards and rough are smooth-unioned (sdBlob) so a cluster of discs
// renders and plays as one filleted blob, never a bunch of grapes. Validated by
// putt-sim.
export const HOLES: Hole[] = [
  // 1 — warm-up: straight fairway into a round green.
  {
    par: 2,
    tee: { x: 180, y: 470 },
    cup: { x: 180, y: 140 },
    fairway: [cap(180, 486, 180, 176, 34)],
    green: [disc(180, 140, 56)],
  },
  // 2 — a narrow channel opening onto a circular green (the showcase).
  {
    par: 3,
    tee: { x: 180, y: 475 },
    cup: { x: 180, y: 140 },
    fairway: [cap(180, 500, 180, 205, 26)],
    green: [disc(180, 140, 74)],
  },
  // 3 — dogleg right: two fairway lanes curving into a circular green, with a
  // strip of rough hugging the inside (left) edge of the approach.
  {
    par: 3,
    tee: { x: 92, y: 468 },
    cup: { x: 286, y: 168 },
    fairway: [cap(92, 498, 104, 268, 40), cap(104, 268, 286, 190, 40)],
    green: [disc(286, 168, 52)],
    rough: [disc(66, 430, 18), disc(70, 392, 18), disc(74, 356, 18)],
  },
  // 4 — wide fairway with a curved-wall chicane, into a round green; patches of
  // rough tuck into the lower corners so the widest lines get punished.
  {
    par: 3,
    tee: { x: 180, y: 444 },
    cup: { x: 180, y: 138 },
    fairway: [cap(180, 452, 180, 196, 82)],
    green: [disc(180, 138, 60)],
    walls: [cap(94, 352, 176, 336, 12), cap(184, 258, 268, 244, 12)],
    rough: [disc(120, 430, 22), disc(118, 400, 20), disc(244, 410, 20), disc(242, 382, 18)],
  },
  // 5 — fairway with a blobby bunker hugging the left; veer right onto the green.
  {
    par: 3,
    tee: { x: 180, y: 472 },
    cup: { x: 180, y: 120 },
    fairway: [cap(180, 484, 180, 158, 52)],
    green: [disc(180, 120, 52)],
    pits: [disc(156, 300, 24), disc(158, 332, 20), disc(156, 270, 18)],
  },
  // 6 — a pond guards the left approach; skirt it on the way to the green.
  {
    par: 3,
    tee: { x: 180, y: 470 },
    cup: { x: 180, y: 120 },
    fairway: [cap(180, 480, 180, 168, 58)],
    green: [disc(180, 120, 52)],
    water: [disc(150, 322, 24), disc(152, 352, 20)],
  },
  // 7 — channel into a circular green with a bumper to curl around.
  {
    par: 3,
    tee: { x: 180, y: 476 },
    cup: { x: 212, y: 134 },
    fairway: [cap(180, 500, 180, 214, 26)],
    green: [disc(180, 150, 76)],
    walls: [disc(150, 172, 18)],
  },
  // 8 — wide fairway: a curved wall pushes you right, toward a pond.
  {
    par: 4,
    tee: { x: 180, y: 450 },
    cup: { x: 168, y: 132 },
    fairway: [cap(180, 456, 180, 178, 80)],
    green: [disc(168, 132, 56)],
    walls: [cap(96, 344, 196, 322, 12)],
    water: [disc(228, 242, 26), disc(230, 212, 20)],
    rough: [disc(118, 430, 22), disc(116, 400, 20)],
  },
  // 9 — finale: dogleg fairway, a bunker to skirt, a bumper, into a round green.
  {
    par: 5,
    tee: { x: 92, y: 476 },
    cup: { x: 280, y: 172 },
    fairway: [cap(92, 500, 104, 360, 36), cap(104, 360, 250, 300, 36), cap(250, 300, 278, 226, 36)],
    green: [disc(280, 172, 68)],
    walls: [disc(252, 236, 15)],
    pits: [disc(110, 406, 22), disc(118, 378, 18)],
  },
];
