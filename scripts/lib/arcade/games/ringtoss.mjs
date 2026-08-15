// Ring Toss policy. The simplest inversion in the set: the flick is a pure
// polar aim — direction points, length carries.
//
// Forward model (src/features/fun/RingToss.tsx landingFor):
//   power = min(|drag|/MAX_DRAG, 1)      d = MIN_D + power*(MAX_D - MIN_D)
//   land  = START + (drag/|drag|) * d
// so the drag that lands on T is just û(T-START) scaled back through d⁻¹. The
// only constraint is that |T-START| falls inside [MIN_D, MAX_D] — the near/far
// edges of what a flick can carry — which every bottle neck does.
import { jitter, pickWeighted, sigmaFor } from '../skill.mjs';

const W = 340;
const H = 560;
const START = { x: W / 2, y: 505 };
const MAX_DRAG = 260;
const MIN_D = 150;
const MAX_D = 420;
const RINGS = 8;

// Bottle field, mirroring buildBottles(): 4 rows × 5 columns in perspective,
// back row small and tight, front row large and spread.
const ROWS = 4;
const COLS = 5;
const ROW_Y0 = 178;
const ROW_Y1 = 330;
const BODY_H = 42;
const NECK_H = 16;
const RED = new Set(['1,2', '2,1', '2,3']); // the 5-point necks

function bottles() {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    const t = r / (ROWS - 1);
    const y = ROW_Y0 + t * (ROW_Y1 - ROW_Y0);
    const s = 0.6 + t * 0.4;
    const gap = 40 + t * 18;
    for (let c = 0; c < COLS; c++) {
      const x = W / 2 + (c - (COLS - 1) / 2) * gap;
      out.push({
        // The neck is what a landing ring is measured against, not the base.
        x,
        y: y - (BODY_H + NECK_H * 0.75) * s,
        pts: RED.has(`${r},${c}`) ? 5 : 2,
        s,
      });
    }
  }
  return out;
}

const NECKS = bottles();

/** Drag delta that drops the ring on (tx,ty), or null if out of carry range. */
export function solve(tx, ty) {
  const vx = tx - START.x;
  const vy = ty - START.y;
  const dist = Math.hypot(vx, vy);
  if (dist < MIN_D || dist > MAX_D) return null;
  const ux = vx / dist;
  const uy = vy / dist;
  if (uy / 1 > -0.35) return null; // must be flicked up at the bottles
  const len = ((dist - MIN_D) / (MAX_D - MIN_D)) * MAX_DRAG;
  if (len < 14) return null; // the game's deadzone
  return { dx: ux * len, dy: uy * len };
}

export default {
  key: 'ringtoss',
  route: '/arcade/rings',
  label: 'Ring Toss',
  field: { W, H },
  ticketsFor: (score) => score * 2,
  perShotMs: 2400, // flight 620 + settle 620 + next 1050
  estRoundMs: RINGS * 2400 + 4000,
  needsStart: true,

  async play(d, { rng, skill }) {
    // Reachable necks only — the very front row can fall inside MIN_D.
    const targets = NECKS.filter((n) => solve(n.x, n.y));
    const weights = targets.map((n) => (n.pts === 5 ? 0.15 + 3.2 * skill ** 2 : 1));
    // Bands are scale-normalized in the game (RINGER_D = 12 at s=1), so a back-row
    // bottle is a physically smaller target; scatter is in raw logical units.
    const sigma = sigmaFor(skill, 34, 3);

    for (let i = 0; i < RINGS; i++) {
      const t = pickWeighted(rng, targets, weights);
      let aim = jitter(rng, t, sigma * t.s);
      let sol = solve(aim.x, aim.y);
      if (!sol) {
        aim = jitter(rng, t, sigma * t.s * 0.4);
        sol = solve(aim.x, aim.y) ?? solve(t.x, t.y);
      }
      if (!sol) continue;
      await d.swipe(START.x, 520, sol.dx, sol.dy);
      await d.page.waitForTimeout(this.perShotMs);
    }
  },
};
