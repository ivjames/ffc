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
// Collision is signed-distance based: sdUnion(p, shapes) is the distance from p
// to the union's surface, negative inside. We keep the ball inside the GREEN,
// outside the WALLS, and treat the PITS as hazards.

export const W = 360;
export const H = 540;
export const BALL_R = 8;
export const HOLE_R = 13;

// Physics tuning (per-frame at ~60fps).
export const FRICTION = 0.985; // velocity retained each frame on the fairway
export const FRICTION_ROUGH = 0.955; // the fringe/collar just inside the green edge
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
  green: Seg[]; // playable surface (union) — the ball must stay inside
  walls?: Seg[]; // solid obstacles, incl. curved ones (bounce off)
  pits?: Seg[]; // sand bunkers (heavy drag) — clipped to the green when drawn
};
export type Outcome = 'rolling' | 'stopped' | 'sunk';

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

/** Outward-pointing unit normal of the union's field at (px,py). */
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
// this substep, else null. (Sand is a drag zone handled per-frame, not here.)
function resolve(b: Ball, hole: Hole): 'sunk' | null {
  // Hard field-edge rail — a safety net so the ball can never end up off-screen
  // even where a green's rounded end meets the field boundary.
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

  // Keep the ball inside the green (its boundary is the rail).
  const g = sdUnion(b.x, b.y, hole.green);
  if (g > -BALL_R) {
    const [nx, ny] = gradUnion(b.x, b.y, hole.green); // points outward
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

  // Cup: a slow ball near the center drops; near-misses get a gentle magnet nudge.
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
  if (dc < HOLE_R * 2 && s < CAPTURE_SPEED) {
    b.vx += (dxc / dc) * 0.22;
    b.vy += (dyc / dc) * 0.22;
  }
  return null;
}

/** Advance the ball one frame. Sub-steps keep fast shots from tunnelling. */
export function stepPhysics(b: Ball, hole: Hole): Outcome {
  const speed = Math.hypot(b.vx, b.vy);
  const steps = Math.max(1, Math.ceil(speed / (BALL_R * 0.5)));
  for (let i = 0; i < steps; i++) {
    b.x += b.vx / steps;
    b.y += b.vy / steps;
    const outcome = resolve(b, hole);
    if (outcome) return outcome;
  }
  // Surface friction: fairway, the rough collar near the green edge, or — most
  // draggy of all — a sand bunker.
  let fr = sdUnion(b.x, b.y, hole.green) > -ROUGH_BAND ? FRICTION_ROUGH : FRICTION;
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
// Smooth greens (rounded lanes, circular greens + channels), curved walls, and
// blobby pits. Validated by sim.ts before shipping.
export const HOLES: Hole[] = [
  // 1 — warm-up: a straight rounded lane.
  {
    par: 2,
    tee: { x: 180, y: 468 },
    cup: { x: 180, y: 120 },
    green: [cap(180, 480, 180, 100, 56)],
  },
  // 2 — a narrow channel opening onto a circular green (the showcase).
  {
    par: 3,
    tee: { x: 180, y: 475 },
    cup: { x: 180, y: 140 },
    green: [cap(180, 500, 180, 205, 26), disc(180, 140, 74)],
  },
  // 3 — dogleg right: two lanes curving into a circular green.
  {
    par: 3,
    tee: { x: 92, y: 468 },
    cup: { x: 286, y: 168 },
    green: [cap(92, 498, 104, 268, 40), cap(104, 268, 286, 190, 40), disc(286, 168, 52)],
  },
  // 4 — wide green with a curved-wall chicane to weave through.
  {
    par: 3,
    tee: { x: 180, y: 444 },
    cup: { x: 180, y: 130 },
    green: [cap(180, 452, 180, 140, 82)],
    walls: [
      cap(94, 352, 176, 336, 12),
      cap(184, 258, 268, 244, 12),
    ],
  },
  // 5 — straight lane with a blobby pit hugging the left; veer right.
  {
    par: 3,
    tee: { x: 180, y: 472 },
    cup: { x: 180, y: 120 },
    green: [cap(180, 484, 180, 104, 52)],
    pits: [disc(150, 300, 26), disc(152, 334, 22), disc(150, 268, 20)],
  },
  // 6 — long S-curve lane into a circular green.
  {
    par: 4,
    tee: { x: 100, y: 480 },
    cup: { x: 256, y: 150 },
    green: [
      cap(100, 500, 112, 366, 38),
      cap(112, 366, 250, 306, 38),
      cap(250, 306, 256, 196, 38),
      disc(256, 150, 50),
    ],
  },
  // 7 — channel into a circular green with a bumper to curl around.
  {
    par: 3,
    tee: { x: 180, y: 476 },
    cup: { x: 212, y: 134 },
    green: [cap(180, 500, 180, 214, 26), disc(180, 150, 76)],
    walls: [disc(150, 172, 18)],
  },
  // 8 — wide green: a curved wall pushes you right into a pit's reach.
  {
    par: 4,
    tee: { x: 180, y: 448 },
    cup: { x: 168, y: 132 },
    green: [cap(180, 456, 180, 118, 80)],
    walls: [cap(96, 344, 196, 322, 12)],
    pits: [disc(236, 244, 24), disc(238, 214, 20)],
  },
  // 9 — finale: dogleg lane, a pit to skirt, a bumper, into a circular green.
  {
    par: 5,
    tee: { x: 92, y: 476 },
    cup: { x: 280, y: 168 },
    green: [
      cap(92, 500, 104, 360, 36),
      cap(104, 360, 250, 300, 36),
      cap(250, 300, 278, 222, 36),
      disc(280, 172, 68),
    ],
    walls: [disc(252, 236, 15)],
    pits: [disc(120, 408, 22), disc(122, 378, 18)],
  },
];
