// Air Hockey policy — a free-moving ball, which is the class that separates
// this from every earlier game. A puck is not constrained to a rail, a lane, or
// a row of holes: it goes wherever the physics sends it, at up to ~860 px/s.
//
// Two things make it tractable anyway:
//
//   1. findBlob() locates the white puck anywhere on the table from ONE
//      getImageData, so a full-table search costs about what a single row probe
//      costs. Searching two dimensions is otherwise the whole problem.
//   2. The mallet TELEPORTS to the pointer — `pl.x = clamp(gs.pointer.x, ...)`,
//      no easing — so the bot has instant positional control and never has to
//      steer. Placing the pointer IS placing the mallet.
//
// The aim is geometric rather than predictive. To send the puck at the CPU
// goal, the mallet has to contact it on the far side from that goal, so the
// bot parks at
//     strike = puck + normalise(puck − goal) · (PAD_R + PUCK_R)
// and lets its own motion toward that point supply the drive (the collision
// adds `padVx * 0.9`, so chasing the strike point is what hits hard). No
// interception maths, no lead: re-solving this every cycle tracks the puck
// naturally, because the strike point moves with it.
import { clamp, gauss, lerp, sigmaFor } from '../skill.mjs';

const W = 340;
const H = 560;
const MID = H / 2;
const PUCK_R = 13;
const PAD_R = 28;
const TARGET = 7; // goals to win
const GOAL = { x: W / 2, y: 0 }; // the CPU's goal — where we want the puck to go

// The puck is the only white sphere on the table (#ffffff core, #dbe4ee mid).
const PUCK_RGB = { rMin: 200, gMin: 200, bMin: 200 };

// Mallet travel limits, from the game's own clamp.
const PAD_Y0 = MID + 2;
const PAD_Y1 = H - PAD_R - 2;

export default {
  key: 'airhockey',
  route: '/arcade/airhockey',
  label: 'Air Hockey',
  field: { W, H },
  ticketsFor: (you) => you * 5 + (you >= TARGET ? 15 : 0),
  /** End card is a "you – cpu" tally in .text-4xl; our goals come first. */
  readScore: async (page) => {
    const raw = (await page.locator('.text-4xl').first().textContent()) ?? '';
    return raw.trim().split(/\D+/)[0] ?? '';
  },
  // First to 7; a one-sided game is quick, a close one is not.
  estRoundMs: 150_000,
  needsStart: true,

  async play(d, { rng, skill }) {
    // Positional error on the mallet, and how often the bot re-reads the table.
    const sigma = sigmaFor(skill, 26, 2);
    const cadenceMs = Math.round(lerp(90, 8, clamp(skill, 0, 1)));

    const deadline = Date.now() + this.estRoundMs;
    let sinceCheck = 0;

    while (Date.now() < deadline) {
      if (++sinceCheck >= 40) {
        sinceCheck = 0;
        if (await d.page.getByRole('button', { name: /^(Play|Race) again$/ }).isVisible().catch(() => false)) {
          break;
        }
      }

      let puck = null;
      try {
        puck = await d.findBlob({ x0: 0, y0: 0, x1: W, y1: H }, PUCK_RGB, { step: 2 });
      } catch {
        break; // canvas unmounted — round over
      }

      let target;
      if (!puck || puck.y < MID - PAD_R) {
        // Puck is up the CPU's end (or briefly unseen during a serve): hold the
        // middle of our own goal mouth rather than chasing it across the line —
        // the mallet cannot cross half anyway.
        target = { x: puck ? lerp(W / 2, puck.x, 0.5) : W / 2, y: PAD_Y1 - 6 };
      } else {
        // Get behind the puck on the goal's axis so contact drives it upfield.
        const dx = puck.x - GOAL.x;
        const dy = puck.y - GOAL.y;
        const len = Math.hypot(dx, dy) || 1;
        target = {
          x: puck.x + (dx / len) * (PAD_R + PUCK_R),
          y: puck.y + (dy / len) * (PAD_R + PUCK_R),
        };
      }

      const p = d.toClient(
        clamp(target.x + gauss(rng) * sigma, PAD_R, W - PAD_R),
        clamp(target.y + gauss(rng) * sigma * 0.5, PAD_Y0, PAD_Y1),
      );
      await d.page.mouse.move(p.x, p.y);
      await d.page.waitForTimeout(cadenceMs);
    }
  },

  /** Press once so the game takes the pointer, then let play() steer it. */
  async startGesture(d) {
    const p = d.toClient(W / 2, PAD_Y1 - 6);
    await d.page.mouse.move(p.x, p.y);
    await d.page.mouse.down();
  },
};
