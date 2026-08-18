// Shooting Gallery policy — reactive, like whack-a-mole, but the targets
// actually move.
//
// It stays tractable because the ducks only move along KNOWN LINES. Each shelf
// draws its ducks at a fixed y (`sh.y + 6`) in its own body colour, and the
// gold duck runs a single high wire. So the bot never has to track anything
// frame to frame: it scans a handful of horizontal lines for runs of the right
// colour, and each scan is a complete, independent read of where every target
// is right now.
//
// Colour is also the value: the shelves are sky blue (15), orange (10) and
// yellow (5). So scanning them in that order returns targets already sorted by
// worth, and the policy simply shoots the best thing it can see, stopping the
// scan as soon as it finds one.
//
// Lead is not worth computing. The fastest shelf moves 112 px/s while a
// probe-then-tap cycle costs ~20-30 ms — under 4 px of travel, well inside the
// duck. Aiming where it IS beats predicting where it will be.
import { clamp, gauss, sigmaFor } from '../skill.mjs';

const W = 340;
const H = 560;
const GAME_MS = 45_000;
const MAG = 6;
const RELOAD_MS = 800;

// Where each shelf's ducks actually PAINT — measured, not derived. drawDuck is
// anchored at `sh.y + 6`, but that anchor is the duck's feet on the shelf and
// the front board is drawn over it, so a probe there reads solid shelf timber
// (uniform 168,120,72 across the full width). The body sits above the anchor by
// an amount that grows with the shelf's perspective scale — scanning for each
// body colour put the bands at 180-200, 275-305 and 375-410, so these are their
// centres.
//
// The gold duck on the high wire is deliberately not listed: it is rare, and
// guessing its palette risks false positives that would waste shells on
// scenery. Missing it costs 25 points occasionally; chasing a wrong colour
// would cost far more.
const LINES = [
  { y: 186, pts: 15, rgb: [125, 211, 252], name: 'blue' },
  { y: 290, pts: 10, rgb: [253, 186, 116], name: 'orange' },
  { y: 391, pts: 5, rgb: [253, 224, 71], name: 'yellow' },
];

/**
 * Centres of colour runs along a probed row, in logical x.
 *
 * A duck is a contiguous stretch of its body colour, so runs — not single
 * pixels — are what identify one, and the run's centre is where to shoot. Short
 * runs are dropped: the shelves carry piping and nail heads in related tones,
 * and a stray pixel or two of those would otherwise read as a target.
 */
function findRuns(run, rgb, { from, span, tol = 42, minRun = 4 }) {
  const n = run.w;
  const hits = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    let match = false;
    if (i < n) {
      const r = run.px[i * 4];
      const g = run.px[i * 4 + 1];
      const b = run.px[i * 4 + 2];
      const a = run.px[i * 4 + 3];
      match =
        a > 60 &&
        Math.abs(r - rgb[0]) < tol &&
        Math.abs(g - rgb[1]) < tol &&
        Math.abs(b - rgb[2]) < tol;
    }
    if (match && start < 0) start = i;
    else if (!match && start >= 0) {
      if (i - start >= minRun) hits.push(from + ((start + i) / 2 / n) * span);
      start = -1;
    }
  }
  return hits;
}

export default {
  key: 'shootinggallery',
  route: '/arcade/gallery',
  label: 'Shooting Gallery',
  field: { W, H },
  ticketsFor: (score) => Math.min(100, Math.round(score / 4)),
  estRoundMs: GAME_MS + 9000,
  needsStart: true,

  async play(d, { rng, skill }) {
    // Aim scatter in logical px, and how long the player dithers between shots.
    const sigma = sigmaFor(skill, 26, 2);
    const reactMs = Math.round(150 - 120 * clamp(skill, 0, 1));

    let shells = MAG;
    const deadline = Date.now() + GAME_MS - 800;

    while (Date.now() < deadline) {
      if (shells <= 0) {
        // A six-shell magazine with an auto-reload makes spray-and-pray costly,
        // so wait it out rather than tapping into an empty gun.
        await d.page.waitForTimeout(RELOAD_MS + 60);
        shells = MAG;
        continue;
      }

      // Scan best-paying line first and stop early — usually one round trip.
      let target = null;
      for (const line of LINES) {
        const row = await d.probeRow(line.y);
        const xs = findRuns(row, line.rgb, { from: 0, span: W });
        if (xs.length) {
          // Prefer one that is well inside the frame: a duck half off the edge
          // is about to leave, and its run centre is skewed by the clipping.
          const mid = xs.sort((p, q) => Math.abs(p - W / 2) - Math.abs(q - W / 2))[0];
          target = { x: mid, y: line.y };
          break;
        }
        if (Date.now() >= deadline) return;
      }

      if (!target) {
        await d.page.waitForTimeout(60);
        continue;
      }

      await d.tap(
        clamp(target.x + gauss(rng) * sigma, 6, W - 6),
        clamp(target.y + gauss(rng) * sigma * 0.4, 6, H - 6),
      );
      shells--;
      await d.page.waitForTimeout(reactMs);
    }
  },
};
