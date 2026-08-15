// Darts policy — the same two-axis timing lock as Axe Throw (see ../sweep.mjs),
// on a real dartboard with real rules.
//
// This is the least forgiving game in the set, and deliberately so: the treble
// band is 12px deep (r 70..82) and sector 20's neighbours are 1 and 5, so a
// throw that misses the treble by a whisker sideways scores 1 instead of 60.
// That is the actual dartboard's cruelty, not a bot artifact, and it makes the
// score distribution wide and lumpy in exactly the way real darts is.
//
// Targets are chosen along the 20 sector (straight up from the bull), because
// scoreAt puts 20 straddling the top:
//   deg = (atan2(x-CX, CY-y)/D2R + 369) % 360, sector = ORDER[floor(deg/18)]
// so a point directly above the centre lands at deg 9 → ORDER[0] → 20.
import { jitter, pickWeighted, sigmaFor } from '../skill.mjs';
import { throwAt } from '../sweep.mjs';

const W = 340;
const H = 560;
const CX = 170;
const CY = 218;
const DARTS = 9;
const VISIT_SIZE = 3;

const SWEEP = {
  X0: 26,
  X1: W - 26,
  Y0: 74,
  Y1: 362,
  // Slower than Axe Throw's — the game widens the dwell because the beds are
  // only a few px tall, which also makes the bot's timing error cheaper here.
  xMs: 1750,
  yMs: 1500,
  // Guide spans y 54..386; the board surround ends at 218+160=378.
  probeY: 382,
};

// Along the 20 sector, straight up from the bull.
const TREBLE_20 = { x: CX, y: CY - 76, pts: 60 }; // r 70..82 → ×3
const INNER_20 = { x: CX, y: CY - 45, pts: 20 }; // fat single, r 15..70
const OUTER_20 = { x: CX, y: CY - 100, pts: 20 }; // single, r 82..118
const BULL = { x: CX, y: CY, pts: 50 }; // r<=7 for 50, <=15 for 25

export default {
  key: 'darts',
  route: '/arcade/darts',
  label: 'Darts',
  field: { W, H },
  ticketsFor: (score) => Math.min(100, Math.round(score / 4)),
  estRoundMs: DARTS * 6500 + 8000,
  needsStart: true,

  async play(d, { rng, skill }) {
    const targets = [TREBLE_20, INNER_20, OUTER_20, BULL];
    const weights = [
      0.05 + 2.4 * skill ** 2, // treble hunting is an expert's game
      1.3 - 0.5 * skill, // the fat single is the sane default
      0.6,
      0.1 + 0.5 * skill ** 2,
    ];
    const sigma = sigmaFor(skill, 34, 4);

    for (let i = 0; i < DARTS; i++) {
      const t = pickWeighted(rng, targets, weights);
      const aim = jitter(rng, t, sigma);
      const ok = await throwAt(d, aim, SWEEP);
      if (!ok) {
        await d.page.waitForTimeout(600);
        continue;
      }
      // flight 420 + score beat 850, plus the visit-total pause every third dart.
      const visitEnd = (i + 1) % VISIT_SIZE === 0 && i + 1 < DARTS;
      await d.page.waitForTimeout(1500 + (visitEnd ? 1700 : 0));
    }
  },
};
