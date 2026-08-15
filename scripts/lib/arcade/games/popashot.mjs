// Pop-a-Shot policy. Same apex model as Skee-Ball (a parabola sampled at its
// own apex), so the same inversion applies with this game's constants — but the
// round is governed by a 45-second clock rather than a ball count, so the policy
// shoots on a loop until the clock is done instead of counting shots.
//
// The last BONUS_MS of the clock slide the hoop side to side and triple the
// value of a make. Tracking that slide would need live state, so the bot plays
// the honest version of what a player without a read on the rhythm does: it
// keeps shooting at the hoop's home position and converts whatever the slide
// happens to line up. Makes in that window are worth 3, so the score still
// carries the bonus-period shape.
import { jitter, sigmaFor } from '../skill.mjs';

const W = 340;
const H = 560;
const START = { x: W / 2, y: 486 };
const GRAV = 0.5;
const MIN_V = 13;
const MAX_V = 25;
const MAX_DRAG = 300;
const RIM_Y = 176;
const HOOP_X = W / 2;

const CLOCK_MS = 45_000;
const FLIGHT_MS = 620;
const SHOT_GAP_MS = 900; // flight + the beat before the next ball racks

/** Drag delta whose apex lands on (tx,ty). See skeeball.mjs for the derivation. */
export function solve(tx, ty) {
  const dy = START.y - ty;
  if (dy <= 0) return null;
  const k = (START.x - tx) / (2 * dy);
  const n = Math.hypot(k, 1);
  const s = Math.sqrt(dy * (k * k + 1));
  if (s < MIN_V || s > MAX_V) return null;
  const len = ((s - MIN_V) / (MAX_V - MIN_V)) * MAX_DRAG;
  if (len < 12) return null;
  const ux = -k / n;
  const uy = -1 / n;
  if (uy > -0.35) return null; // must be aimed up at the hoop
  return { dx: ux * len, dy: uy * len };
}

export default {
  key: 'popashot',
  route: '/arcade/hoops',
  label: 'Pop-a-Shot',
  field: { W, H },
  ticketsFor: (score) => Math.min(100, Math.round(score * 1.5)),
  estRoundMs: CLOCK_MS + 6000,
  needsStart: true,

  async play(d, { rng, skill }) {
    // A swish needs |apexX - hoopX| <= 9; the rim catches out to 22 laterally
    // and 26 in depth. So sigma is tuned against a ~9px bullseye.
    const sigma = sigmaFor(skill, 30, 2.5);
    const deadline = Date.now() + CLOCK_MS - FLIGHT_MS;

    while (Date.now() < deadline) {
      let aim = jitter(rng, { x: HOOP_X, y: RIM_Y }, sigma);
      let sol = solve(aim.x, aim.y);
      if (!sol) {
        aim = jitter(rng, { x: HOOP_X, y: RIM_Y }, sigma * 0.4);
        sol = solve(aim.x, aim.y) ?? solve(HOOP_X, RIM_Y);
      }
      if (!sol) break;
      await d.swipe(START.x, 500, sol.dx, sol.dy, { steps: 4 });
      // Weak players are also SLOWER — fewer attempts in 45s is part of the
      // score spread, not just worse aim.
      await d.page.waitForTimeout(SHOT_GAP_MS + Math.round((1 - skill) * 500));
    }
  },
};
