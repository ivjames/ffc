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
export const WALL_REST = 0.66; // energy kept on a bounce off a rail/wall
export const STOP_SPEED = 0.16; // below this the ball is "at rest"
export const MIN_SHOT = 3.0; // px/frame at 0% power
export const MAX_SHOT = 14.5; // px/frame at 100% power
export const CAPTURE_SPEED = 5.8; // a faster ball lips out of the cup
export const MAX_DRAG = 132; // drag length (field units) that maps to full power

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
  if (hole.water && hole.water.length && sdUnion(b.x, b.y, hole.water) < 0) {
    return 'water';
  }

  // Cup: a slow ball near the center drops; a near-miss gets a small magnet nudge
  // — deliberately tight so it rewards an accurate putt rather than a lucky one.
  const dxc = hole.cup.x - b.x;
  const dyc = hole.cup.y - b.y;
  const dc = Math.hypot(dxc, dyc);
  const s = Math.hypot(b.vx, b.vy);
  if (dc < HOLE_R && s < CAPTURE_SPEED) {
    b.x = hole.cup.x;
    b.y = hole.cup.y;
    b.vx = 0;
    b.vy = 0;
    return 'sunk';
  }
  if (dc < HOLE_R * 1.4 && s < CAPTURE_SPEED * 0.85) {
    b.vx += (dxc / dc) * 0.12;
    b.vy += (dyc / dc) * 0.12;
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

/** Advance the ball one frame. Sub-steps keep fast shots from tunnelling. */
export function stepPhysics(b: Ball, hole: Hole): Outcome {
  const speed = Math.hypot(b.vx, b.vy);
  const steps = Math.max(1, Math.ceil(speed / (BALL_R * 0.5)));
  for (let i = 0; i < steps; i++) {
    const px = b.x;
    const py = b.y;
    b.x += b.vx / steps;
    b.y += b.vy / steps;
    const outcome = resolve(b, hole);
    if (outcome === 'water') {
      // Drop back where it went in — the last spot before it touched water.
      b.x = px;
      b.y = py;
      b.vx = 0;
      b.vy = 0;
      return 'water';
    }
    if (outcome) return outcome;
  }
  // Surface friction: fairway/green normally, the rough collar around the green
  // edge, or — draggiest of all — a sand bunker.
  let fr = inRough(b.x, b.y, hole) ? FRICTION_ROUGH : FRICTION;
  if (hole.pits && hole.pits.length && sdUnion(b.x, b.y, hole.pits) < 0) fr = FRICTION_SAND;
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
// cup. Curved walls and blobby sand add variety. Validated by putt-sim.
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
  // 3 — dogleg right: two fairway lanes curving into a circular green.
  {
    par: 3,
    tee: { x: 92, y: 468 },
    cup: { x: 286, y: 168 },
    fairway: [cap(92, 498, 104, 268, 40), cap(104, 268, 286, 190, 40)],
    green: [disc(286, 168, 52)],
  },
  // 4 — wide fairway with a curved-wall chicane, into a round green.
  {
    par: 3,
    tee: { x: 180, y: 444 },
    cup: { x: 180, y: 138 },
    fairway: [cap(180, 452, 180, 196, 82)],
    green: [disc(180, 138, 60)],
    walls: [cap(94, 352, 176, 336, 12), cap(184, 258, 268, 244, 12)],
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
