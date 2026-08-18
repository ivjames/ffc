// Bowling policy.
//
// The launch inverts trivially — it is the same direction/power swipe as the
// other lane games — but unlike Skee-Ball the OUTCOME does not, because what
// happens after contact is a ball↔pin↔pin physics sim. There is no closed form
// for "which gesture leaves no pins standing".
//
// So this one is calibrated rather than solved: the aim line is a measured
// constant, found by sweeping the lateral offset and keeping what actually
// scored, and skill perturbs that line the same way it perturbs a solved one.
// Everything downstream is still the shipped game's own physics.
//
// The measured answer is worth recording because it contradicts real bowling:
// straight up the middle is the strike line HERE. Sweeping the lateral offset
// at expert skill gave 300 / 176 / 79 / 59 for offsets of 0 / 6 / 11 / 16 px —
// monotonically worse the further off centre. Real bowling wants the 1–3
// pocket because a real ball deflects; this sim's rack transmits a centred hit
// straight through, and any offset only costs energy. So the pocket intuition
// is exactly wrong here, and the constant below is the measurement, not a
// theory.
import { clamp, gauss, sigmaFor } from '../skill.mjs';

const W = 340;
const H = 560;
const START = { x: W / 2, y: H - 40 };
const MAX_DRAG = 260;
const PIN_GAP_X = 22;

// Measured strike line: lateral drag offset at full power. Positive is right of
// centre — into the 1–3 pocket. See CALIBRATION at the bottom for how to re-find
// this if the lane constants ever move.
const AIM_DX = 0;
const POWER = 0.94; // near-full; too hard deflects, too soft leaves wood standing

/** Drag for a lateral offset (logical px at the pins) and power 0..1. */
export function shot(offsetX, power) {
  const len = clamp(power, 0, 1) * MAX_DRAG;
  // The swipe must read as "up the lane" (dy/len <= -0.3), which every sane
  // offset satisfies at this length.
  const dy = -Math.sqrt(Math.max(1, len * len - offsetX * offsetX));
  return { dx: offsetX, dy };
}

export default {
  key: 'bowling',
  route: '/arcade/bowling',
  label: 'Bowling',
  field: { W, H },
  ticketsFor: (score) => Math.round(score / 3),
  // 10 frames, up to 21 deliveries, each with a pin-settle beat.
  estRoundMs: 21 * 3200 + 8000,

  async play(d, { rng, skill }) {
    // Scatter is in logical px of lateral aim error at the pins. A pocket is a
    // few px wide, so even a small sigma changes strikes into spares.
    const sigma = sigmaFor(skill, 13, 1.2);

    // 10 frames can need up to 21 deliveries; the round ends on its own, so
    // just keep bowling until the end card shows up.
    for (let ball = 0; ball < 24; ball++) {
      if (await d.page.getByRole('button', { name: /^(Play|Race) again$/ }).isVisible().catch(() => false)) {
        break;
      }
      const offset = AIM_DX + gauss(rng) * sigma;
      const power = clamp(POWER + gauss(rng) * 0.03 * (1 - skill), 0.55, 1);
      const s = shot(offset, power);
      await d.swipe(START.x, START.y - 10, s.dx, s.dy, { steps: 5 });
      await d.page.waitForTimeout(3200); // roll + pin settle + rack reset
    }
  },
};

// CALIBRATION
//   The aim line above is empirical, so it is only as good as the lane it was
//   measured on. To re-find it after a physics or layout change:
//
//     for x in -12 -6 0 6 12; do
//       node scripts/arcade-bot.mjs --game bowling --rounds 3 --skill 1 --seed 1
//     done
//
//   with AIM_DX temporarily set to each x, and keep the offset with the best
//   mean. A healthy expert line should clear the score floor in arcade-bot.mjs
//   comfortably; if nothing does, the pins moved and the constant needs redoing
//   rather than nudging.
