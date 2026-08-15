// Axe Throw policy — the two-axis timing class (see ../sweep.mjs for how the
// x and y locks are solved, which is not the same way for both).
//
// Scoring (AxeThrow.tsx scoreAt): concentric rings 1/2/3/4/5 outward-in, plus
// two small "clutch" dots in the top corners worth 7. The clutches are radius
// 15 against a 26-radius bullseye, so they are the ambitious target — worth
// chasing only once the bot's timing is tight enough to land inside them.
import { jitter, pickWeighted, sigmaFor } from '../skill.mjs';
import { throwAt } from '../sweep.mjs';

const W = 340;
const H = 560;
const CENTER = { x: W / 2, y: 220 };
const THROWS = 5;

const SWEEP = {
  X0: 22,
  X1: W - 22,
  Y0: 74,
  Y1: 366,
  xMs: 1300,
  yMs: 1100,
  // Row to probe for the vertical guide: the guide is drawn from y=60 to y=380,
  // and the board's outer ring ends at 220+150=370, so 376 sits in the guide's
  // span but below the board art — the amber line is the only warm thing there.
  probeY: 376,
};

const CLUTCH = [
  { x: CENTER.x - 100, y: CENTER.y - 100, pts: 7 },
  { x: CENTER.x + 100, y: CENTER.y - 100, pts: 7 },
];
const BULL = { x: CENTER.x, y: CENTER.y, pts: 5 };
// A fat mid-ring fallback: r=54 is the 4-ring, far more forgiving than the bull.
const SAFE = { x: CENTER.x, y: CENTER.y, pts: 4 };

export default {
  key: 'axethrow',
  route: '/arcade/axe',
  label: 'Axe Throw',
  field: { W, H },
  ticketsFor: (score) => score * 2,
  estRoundMs: THROWS * 6000 + 6000,
  needsStart: true,

  async play(d, { rng, skill }) {
    const targets = [...CLUTCH, BULL, SAFE];
    const weights = [
      0.05 + 2.2 * skill ** 2,
      0.05 + 2.2 * skill ** 2,
      0.7 + 0.9 * skill,
      1.2 - 0.6 * skill,
    ];
    // Sigma is in logical px of landing error, which here is timing error
    // converted through the sweep rate (~0.22 px/ms on x, ~0.27 on y).
    const sigma = sigmaFor(skill, 42, 5);

    for (let i = 0; i < THROWS; i++) {
      const t = pickWeighted(rng, targets, weights);
      const aim = jitter(rng, t, sigma);
      const ok = await throwAt(d, aim, SWEEP);
      if (!ok) {
        // Guide not found — the round may have moved on without us; give the
        // board a beat and try the next throw rather than hanging.
        await d.page.waitForTimeout(600);
        continue;
      }
      // flight 480 + next 800, plus slack for the score beat.
      await d.page.waitForTimeout(1600);
    }
  },
};
