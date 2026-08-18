// Pinball policy — a free-moving ball like air hockey's puck, but without the
// luxury of a mallet that teleports. Here the only inputs are two flippers and
// a plunger, so the bot cannot position anything: it can only decide WHEN.
//
// The ball is found with findBlob() (the white sphere, same primitive air
// hockey uses), and the decision is geometric:
//   * ball down in the flipper zone and left of centre  → flip left
//   * ...right of centre                                → flip right
// Flipping early is worse than flipping late — a flipper that has already
// finished its swing when the ball arrives does nothing — so the trigger is a
// band just above the pivots rather than a predicted contact time.
//
// The plunger and the flippers share one gesture, which is a gift from the
// input handler: while the ball is racked the first press charges the plunger
// and the release launches it, and once the ball is live the same press works a
// flipper. So a press is never WRONG — the bot holds a long press when it
// believes the ball is racked (a charged launch) and taps briefly otherwise,
// and a misjudgement costs a stray flip rather than a stuck ball.
// A NOTE ON VARIANCE, because it will mislead anyone who spot-checks this:
// pinball's score is dominated by how long the ball stays alive and what it
// happens to hit, so a single round says almost nothing. Measured over five
// rounds each, expert means 8010 (p10 2250, p90 12900) against a beginner's
// 6800 (p10 4500, p90 9950) — the right order, but two-round samples showed
// the BEGINNER ahead purely by luck. Judge any change here on five rounds
// minimum, and do not "fix" a single bad round by retuning.
import { clamp, gauss, lerp } from '../skill.mjs';

const W = 340;
const H = 560;
const BALL_R = 7;
const FLIP_PIVOT_Y = 497;
const BALLS = 3;

// Ball is a white sphere (#ffffff core, #d7dee8 mid) — but NOT the only white
// on the deck: every pop bumper carries a white "100" label. Averaging all
// white pixels put the "ball" dead in the middle of the bumper cluster and
// left it there forever, so the find takes the largest CONNECTED component.
// The ball is one fat blob (~20 lattice cells at step 2); the labels are many
// thin ones.
const BALL_RGB = { rMin: 205, gMin: 205, bMin: 205 };

// Flip when the ball is in this band above the pivots — high enough that the
// swing is under way on arrival, low enough not to fire at a ball still up in
// the bumpers.
const FLIP_Y0 = FLIP_PIVOT_Y - 78;
const FLIP_Y1 = FLIP_PIVOT_Y + 22;

// The shooter lane runs up the right edge; a ball sitting there is racked.
const LANE_X = 316;

export default {
  key: 'pinball',
  route: '/arcade/pinball',
  label: 'Pinball',
  field: { W, H },
  ticketsFor: (score) => Math.min(100, Math.round(score / 200)),
  estRoundMs: 150_000,
  needsStart: true,

  async play(d, { rng, skill }) {
    // Timing error on the flip, in px of ball travel, and the polling cadence.
    const sigma = lerp(26, 3, clamp(skill, 0, 1));
    const cadenceMs = Math.round(lerp(70, 8, clamp(skill, 0, 1)));
    // Even a good player mistimes some flips outright.
    const missRate = 0.3 * (1 - clamp(skill, 0, 1)) ** 1.5;

    const deadline = Date.now() + this.estRoundMs;
    let sinceCheck = 0;
    let unseen = 0;
    let lastFlip = 0;

    while (Date.now() < deadline) {
      if (++sinceCheck >= 40) {
        sinceCheck = 0;
        if (await d.page.getByRole('button', { name: /^(Play|Race) again$/ }).isVisible().catch(() => false)) {
          break;
        }
      }

      let ball = null;
      try {
        ball = await d.findBlob({ x0: 0, y0: 0, x1: W, y1: H }, BALL_RGB, { step: 2, largest: true });
      } catch {
        break; // canvas unmounted — round over
      }

      const racked = !ball || (ball.x > LANE_X && ball.y > FLIP_PIVOT_Y - 120);
      if (racked) {
        unseen++;
        // Give it a few cycles before concluding the ball is racked — the ball
        // is briefly invisible behind bumper flash on a hard hit.
        if (unseen > 4) {
          const p = d.toClient(W - 24, H - 40);
          await d.page.mouse.move(p.x, p.y);
          await d.page.mouse.down();
          await d.page.waitForTimeout(520); // charge the plunger
          await d.page.mouse.up(); // release launches
          unseen = 0;
          await d.page.waitForTimeout(400);
        }
        await d.page.waitForTimeout(cadenceMs);
        continue;
      }
      unseen = 0;

      // Flip when the ball drops into the band, with a debounce so one
      // approach fires one flip rather than a burst across polls.
      const y = ball.y + gauss(rng) * sigma;
      if (y > FLIP_Y0 && y < FLIP_Y1 && Date.now() - lastFlip > 260) {
        lastFlip = Date.now();
        if (rng() >= missRate) {
          const side = ball.x < W / 2 ? W * 0.25 : W * 0.75;
          const p = d.toClient(side, H - 30);
          await d.page.mouse.move(p.x, p.y);
          await d.page.mouse.down();
          await d.page.waitForTimeout(90); // hold through the swing
          await d.page.mouse.up();
        }
      }
      await d.page.waitForTimeout(cadenceMs);
    }
  },
};
