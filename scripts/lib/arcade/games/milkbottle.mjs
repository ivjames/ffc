// Milk Bottle policy — the second CALIBRATED game, for the same reason as
// bowling: the throw inverts, the outcome does not.
//
// launch() is the usual direction-and-power flick, so aiming the ball anywhere
// is trivial. But what the throw is WORTH depends on a topple cascade — a
// struck bottle knocks its neighbours, and a bottle whose supporters go down
// loses its footing (SUPPORTS in MilkBottle.tsx) — which has no closed form.
// So the aim point and power are measured by sweeping them and keeping what
// actually scored, and skill perturbs that line as usual.
//
// The 3-2-1 pyramid stands with its base row at y=316 (x = CX-28, CX, CX+28),
// and the game's own hint says a low hard ball into the base row takes the lot.
// True as far as it goes — but the sweep found the hint's obvious reading is
// the WORST one. Measured at expert skill:
//
//   aim x = CX      → 14      (dead centre, "square into the base row")
//   aim x = CX ± 14 → 30-33   (the SEAM between two base bottles)
//
// with 33 the theoretical maximum (18 bottles + three 5-point clean sweeps).
// Hitting the middle bottle square drives one bottle straight back and the
// impulse splits along SUPPORTS; hitting the seam puts the ball through two
// base bottles at once, and losing two supporters drops everything above them.
// Power then matters only at the margin (0.8 → 33, 1.0 → 30): too hard and the
// ball punches past before the cascade develops.
import { clamp, gauss, sigmaFor } from '../skill.mjs';

const W = 340;
const H = 560;
const CX = W / 2;
const START = { x: CX, y: 505 };
const MIN_V = 5;
const MAX_V = 12.5;
const MAX_DRAG = 280;
const RACKS = 3;
const THROWS_PER_RACK = 2;

// Measured aim: target point on the stack and throw power (0..1).
const AIM = { x: CX + 14, y: 300 };
const POWER = 0.8;

/** Drag delta that throws at (tx,ty) with the given power. */
export function shot(tx, ty, power) {
  const dx = tx - START.x;
  const dy = ty - START.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;
  if (uy > -0.35) return null; // must be flicked up at the stack
  const drag = clamp(power, 0, 1) * MAX_DRAG;
  if (drag < 12) return null; // the game's deadzone
  return { dx: ux * drag, dy: uy * drag };
}

export default {
  key: 'milkbottle',
  route: '/arcade/bottles',
  label: 'Milk Bottle Toss',
  field: { W, H },
  ticketsFor: (score) => score * 2,
  // 3 racks x 2 throws, each with a 3.2s sim cap plus the next-throw beat.
  estRoundMs: RACKS * THROWS_PER_RACK * 4600 + 9000,
  needsStart: true,

  async play(d, { rng, skill }) {
    // Scatter in logical px at the stack. The base row spans ~56px across three
    // bottles, so a sloppy throw still hits SOMETHING — it just clips a corner
    // instead of driving through the middle.
    const sigma = sigmaFor(skill, 30, 2.5);

    for (let i = 0; i < RACKS * THROWS_PER_RACK; i++) {
      if (await d.page.getByRole('button', { name: /^(Play|Race) again$/ }).isVisible().catch(() => false)) {
        break;
      }
      const aimX = AIM.x + gauss(rng) * sigma;
      const aimY = AIM.y + gauss(rng) * sigma * 0.4;
      const power = clamp(POWER + gauss(rng) * 0.05 * (1 - skill), 0.45, 1);
      const s = shot(aimX, aimY, power) ?? shot(AIM.x, AIM.y, POWER);
      if (!s) continue;
      await d.swipe(START.x, START.y - 8, s.dx, s.dy, { steps: 5 });
      await d.page.waitForTimeout(4600); // sim cap 3200 + next-throw beat 1000
    }
  },
};

// CALIBRATION
//   AIM/POWER above are measured, not derived — the topple cascade has no
//   closed form. To re-find them after a physics change, sweep one at a time
//   with the other fixed and keep the best mean:
//
//     AIM.x in {CX-14, CX, CX+14}   AIM.y in {300, 316, 330}   POWER in {0.7..1.0}
//   Sweep AIM.x FIRST — it dominates the other two by more than 2x.
//     node scripts/arcade-bot.mjs --game milkbottle --rounds 3 --skill 1
//
//   A healthy expert line clears the score floor in arcade-bot.mjs with room
//   to spare; if nothing does, the stack geometry moved and these want redoing
//   rather than nudging.
