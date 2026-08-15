// Skee-Ball policy. The reference implementation for a swipe game: the launch
// is a closed-form function of the drag, so it inverts exactly.
//
// Forward model (src/features/fun/SkeeBall.tsx):
//   len   = |drag|,  power = min(len/MAX_DRAG, 1),  s = MIN_V + power*(MAX_V-MIN_V)
//   v     = (drag/len) * s
//   t_apex= -vy/GRAV ;  land = (X0 + vx*t, Y0 + vy*t + GRAV*t²/2)
//
// Substituting the unit aim u and speed s, the apex reduces to
//   land.x = X0 - 2*ux*uy*s²      land.y = Y0 - uy²*s²
// so for a target (tx,ty), with k = (X0-tx) / (2*(Y0-ty)):
//   u = (-k,-1)/√(k²+1)           s = √((Y0-ty)*(k²+1))
// which is exact, and lands every ring inside the legal speed band.
import { jitter, pickWeighted, sigmaFor } from '../skill.mjs';

const W = 360;
const H = 560;
const START = { x: W / 2, y: 500 };
const MIN_V = 11;
const MAX_V = 25;
const MAX_DRAG = 300;
const BALLS = 9;

const HOLES = [
  { cx: 88, cy: 74, R: 18, pts: 100 },
  { cx: W - 88, cy: 74, R: 18, pts: 100 },
  { cx: W / 2, cy: 96, R: 26, pts: 50 },
  { cx: W / 2, cy: 160, R: 30, pts: 40 },
  { cx: W / 2, cy: 226, R: 32, pts: 30 },
  { cx: W / 2, cy: 292, R: 34, pts: 20 },
  { cx: W / 2, cy: 358, R: 36, pts: 10 },
];

/** Drag delta that lands the ball on (tx,ty), or null if out of the speed band. */
export function solve(tx, ty) {
  const dy = START.y - ty;
  if (dy <= 0) return null;
  const k = (START.x - tx) / (2 * dy);
  const n = Math.hypot(k, 1);
  const s = Math.sqrt(dy * (k * k + 1));
  if (s < MIN_V || s > MAX_V) return null;
  const len = ((s - MIN_V) / (MAX_V - MIN_V)) * MAX_DRAG;
  if (len < 10) return null; // the game's deadzone — would not release
  return { dx: (-k / n) * len, dy: (-1 / n) * len };
}

export default {
  key: 'skeeball',
  route: '/arcade/skeeball',
  label: 'Skee-Ball',
  field: { W, H },
  // 1 ticket per 10 points (SkeeBall.tsx's GameTicketAward call).
  ticketsFor: (score) => Math.round(score / 10),
  // flight 560 + sink 440 + next 850, plus a frame of slack.
  perShotMs: 2000,
  estRoundMs: BALLS * 2000 + 1500,

  async play(d, { rng, skill }) {
    // Ambition: good players go corner-hunting for 100s, weak players are
    // better off (and behave more like real ones) lobbing at the fat rings.
    const weights = HOLES.map((h) => {
      if (h.pts === 100) return 0.05 + 2.6 * skill ** 2;
      if (h.pts === 50) return 0.8 + 0.7 * skill;
      if (h.pts === 40) return 1.0;
      return 1.1 - 0.7 * skill; // 30/20/10 — the bail-out rings
    });
    const sigma = sigmaFor(skill, 46, 3.5);

    for (let ball = 0; ball < BALLS; ball++) {
      const target = pickWeighted(rng, HOLES, weights);
      // Perturb the AIM, then solve: the bot commits to a wrong line and the
      // game decides what that line actually hits.
      let aim = jitter(rng, { x: target.cx, y: target.cy }, sigma);
      let sol = solve(aim.x, aim.y);
      if (!sol) {
        // Scattered outside the reachable band — pull back toward the target
        // rather than skipping the ball (a real player still throws).
        aim = jitter(rng, { x: target.cx, y: target.cy }, sigma * 0.35);
        sol = solve(aim.x, aim.y) ?? solve(target.cx, target.cy);
      }
      if (!sol) continue;
      await d.swipe(START.x, 520, sol.dx, sol.dy);
      await d.page.waitForTimeout(this.perShotMs);
    }
  },
};
