// Claw Machine policy — one-tap timing on a sweeping trolley, plus a target
// that has to be FOUND before it can be aimed at.
//
// The timing half is High Striker again: the trolley sweeps the rail on a
// triangle wave (SWEEP_X0..SWEEP_X1 over SWEEP_MS) whose base is re-set from a
// rAF frame, so the bot probes the rail row for the trolley, samples twice for
// direction, and schedules the stop. The shared phase helpers in ../sweep.mjs
// do that arithmetic; only the "where is it" read is local, because the
// trolley is a slate-grey block rather than an amber guide line.
//
// The targeting half is new: prizes live in a physics pile that settles, so
// their seeded coordinates are only where they STARTED. Measured after the
// pile comes to rest, the gold stars sit ~20px below their seeds (y≈448, not
// 426) — so the pit is probed for amber runs before every credit rather than
// trusting the layout. Between credits the pile shifts again (extraction wakes
// the neighbours), which is why the probe is per-credit, not per-round.
//
// The stop has to be PRECISE for the good stuff. The grip rubric is
//   c = 1 − |clawX − prize.x| / (prize.r + 8)
// judged against per-rarity bands: a rare star (r=15) holds only at c ≥ 0.5
// (|dx| ≤ 11.5px) and survives the carry only at c ≥ 0.82 (|dx| ≤ 4.1px). At
// 0.32 px/ms of sweep, a secure rare grab is a ~13ms timing window.
//
// That window is where this game diverges from High Striker, and the measured
// numbers are worth keeping. A purely SCHEDULED stop (phase → one long wait →
// tap) fired early by −3 to −17px, bimodally — High Striker never showed this
// because a triangle wave's PEAK absorbs timing error (position is
// second-order in time there), while the claw stop is mid-ramp and first-order.
// No single latency constant can fix a bimodal error, so the stop is two-phase:
// the schedule only aims to arrive ~150ms EARLY, then the bot polls the
// trolley's real position and fires when it is one probe-latency short of the
// aim. Measured stop error with poll-fire: ±3px — inside the rare-secure band.
import { clamp, gauss, sigmaFor } from '../skill.mjs';
import { phaseOf, waitFor } from '../sweep.mjs';

const W = 340;
const H = 560;
const SWEEP_X0 = 88;
const SWEEP_X1 = 312;
const SWEEP_MS = 1400;
const RAIL_ROW = 86; // through the trolley body; the rail bar itself ends above
const CREDITS = 5;
const SWEEP_SPEED = (SWEEP_X1 - SWEEP_X0) / (SWEEP_MS / 2); // px/ms
const EARLY_MS = 150; // coarse schedule aims this far ahead of the crossing
const FIRE_LEAD_MS = 10; // fire when the trolley is this many ms short

// The amber-extent centre is NOT the star's physics centre. drawPrize shades
// each plush with a light highlight, and the star's cream highlight (#fef3c7,
// r−b = 55) fails the r−b > 90 amber gate — the detected extent loses the
// highlight side. Measured on the fresh pile by sweeping aim offsets and
// reading the game's own grip notes (aim −12 → loose, −6 → SOLID, −3 → loose,
// −8 → SOLID against a widest-run midpoint of 198), the true centre sat ~7px
// left of the detection. But that offset is NOT a constant: after an
// extraction re-piles the pit, the star settles at a new rotation, the
// highlight bite moves to a different side, and a fixed correction points
// precisely at the wrong spot — which showed up as experts securing the first
// star and going loose on the second, every round. So the centre is taken
// from the BOUNDING BOX of the whole amber cluster across all scanned rows
// (a symmetric shape's bbox stays centred under rotation), with a small fixed
// nudge for the highlight bite that the bbox still loses on one edge:
const STAR_BIAS = -2;

// The cabinet walls paint fixed bright bands at both edges of the rail row, so
// the scan is clipped to strictly inside them.
const SCAN_X0 = 24;
const SCAN_X1 = 316;

/** Trolley centre on the rail row, or null. Intensity-weighted centroid of the
 *  bright pixels — the trolley is the only bright thing between the walls. */
function trolleyX(run, { from, span }) {
  const n = run.w;
  let wSum = 0;
  let wPos = 0;
  for (let i = 0; i < n; i++) {
    const r = run.px[i * 4];
    const g = run.px[i * 4 + 1];
    const b = run.px[i * 4 + 2];
    if (run.px[i * 4 + 3] < 60) continue;
    const lum = r + g + b;
    if (lum < 190) continue;
    wSum += lum;
    wPos += lum * i;
  }
  if (wSum <= 0) return null;
  return from + (wPos / wSum / n) * span;
}

/** Amber (gold star) runs across a pit row → centre xs. Stars are the only
 *  strongly warm-bright bodies in the pile; the plush palette is pastel. */
function amberRuns(run, { from, span }) {
  const n = run.w;
  const out = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    let m = false;
    if (i < n) {
      const r = run.px[i * 4];
      const g = run.px[i * 4 + 1];
      const b = run.px[i * 4 + 2];
      m = run.px[i * 4 + 3] > 60 && r > 200 && g > 140 && r - b > 90;
    }
    if (m && start < 0) start = i;
    else if (!m && start >= 0) {
      if (i - start >= 4) out.push({ x: from + ((start + i) / 2 / n) * span, w: i - start });
      start = -1;
    }
  }
  return out;
}

// A NOTE ON THE GRADIENT: measured expert 40–50 vs beginner 20–55. The
// separation is real but modest, and it is the game's, not the bot's: the pile
// is dense (a prize every ~34px) and commons hold at |dx| ≤ 22px, so even a
// 25px-sloppy stop usually lands on SOMETHING that pays. Skill here buys
// consistency and secured stars, not a large mean gap — do not "fix" this by
// widening the sigma range; the forgiving pile is the shipped design.
export default {
  key: 'clawmachine',
  route: '/arcade/claw',
  label: 'Claw Machine',
  field: { W, H },
  ticketsFor: (score) => Math.min(100, score),
  // descend + grab + hoist + carry + release + between ≈ 7s a credit.
  estRoundMs: CREDITS * 9000 + 8000,
  needsStart: true,

  async play(d, { rng, skill }) {
    // Stop-position scatter in px. Rare-secure needs ~4px, rare-hold ~11px,
    // common-hold ~22px — so this sigma range spans "farms stars" down to
    // "wrestles a common in sometimes".
    const sigma = sigmaFor(skill, 26, 2.5);

    const sampleTrolley = async () => {
      const run = await d.probeRow(RAIL_ROW, { x0: SCAN_X0, x1: SCAN_X1 });
      const x = trolleyX(run, { from: SCAN_X0, span: SCAN_X1 - SCAN_X0 });
      return x === null ? null : { t: run.t, x, v: clamp((x - SWEEP_X0) / (SWEEP_X1 - SWEEP_X0), 0, 1) };
    };

    for (let credit = 0; credit < CREDITS; credit++) {
      // Find something worth grabbing FIRST, so the trolley phase sampled below
      // is still fresh when the schedule is computed. The pile keeps shifting
      // between credits, so this is a fresh read every time.
      // Amber intervals across the scan rows, clustered by x-overlap; the
      // star's centre is its cluster's bbox midpoint (rotation-stable), never
      // a single run's midpoint (rotation-skewed).
      const clusters = []; // { lo, hi, weight }
      // Scan ONLY the reachable zone, on both axes, because the amber gate has
      // two known impostors outside it:
      //   * the chute's trim at x≈48, y≈428 reads as a 50px amber run — wider
      //     than any star, and it sits at a row the first scans happened to
      //     step over. Aiming at it points outside the sweep range, the poll
      //     never fires, and the whole round scores zero. The sweep starts at
      //     88 precisely to stay clear of the chute, so clipping the scan to
      //     the sweep range excludes it on principle, not by tuning.
      //   * the bottom-row tan/orange plush also pass the gate, so the band
      //     stops short of the pit floor.
      //
      // The lower bound was 472 and is now 500, because the pit's ART CHANGED
      // under this policy: a later redesign reshaped the plush and let the pile
      // settle lower, which pushed the second gold star below the old band. The
      // bot then only ever saw one star and expert rounds fell from ~50 to a
      // mean of 22. --assert-skill is what caught it (best 5 against a floor of
      // 30) — this is exactly the drift that gate exists to find, and the fix
      // was re-running the band sweep: 472 -> 22, 500 -> 52, 520 -> 47.
      for (let y = 380; y <= 500; y += 8) {
        const row = await d.probeRow(y, { x0: SWEEP_X0 + 4, x1: SWEEP_X1 - 4 });
        for (const r of amberRuns(row, { from: SWEEP_X0 + 4, span: SWEEP_X1 - SWEEP_X0 - 8 })) {
          const lo = r.x - r.w / 2;
          const hi = r.x + r.w / 2;
          const c = clusters.find((k) => lo <= k.hi + 6 && hi >= k.lo - 6);
          if (c) {
            c.lo = Math.min(c.lo, lo);
            c.hi = Math.max(c.hi, hi);
            c.weight += r.w;
          } else {
            clusters.push({ lo, hi, weight: r.w });
          }
        }
      }
      const best = clusters.sort((p, q) => q.weight - p.weight)[0] ?? null;
      const starX = best ? (best.lo + best.hi) / 2 : null;
      // Wait for the trolley to be sweeping again: two reads that both find it
      // AND that differ — a parked trolley (delivering to the chute) or a
      // carry-phase one must not be mistaken for a live sweep.
      let a = null;
      let b = null;
      for (let tries = 0; tries < 60; tries++) {
        a = await sampleTrolley();
        await d.page.waitForTimeout(80);
        b = await sampleTrolley();
        // Both reads must find it, show real motion (a parked or carrying
        // trolley is not a sweep), and sit clear of the ends — a sample pair
        // that straddles a reversal reads the direction backwards and the
        // whole schedule lands mirrored.
        if (a && b && Math.abs(b.x - a.x) > 4 && b.v > 0.08 && b.v < 0.92) break;
        a = null;
        await d.page.waitForTimeout(140);
      }
      if (!a || !b) return; // round likely over — let the runner read the card

      // Everyone aims at the star while one is visible — that is what casual
      // players do too (it is the shiny thing on top of the pile), so skill is
      // expressed purely as stop precision, not as target choice. A first cut
      // that sent weak players at the "fat middle" instead produced an INVERTED
      // gradient: the pile's middle is exactly where the topmost prize is the
      // star, so beginners banked accidental 25s while experts ground out
      // hold-but-not-secure slips. With everyone on the star, a wide-sigma stop
      // mostly wriggles free (c < 0.5) or lands on a neighbouring common, which
      // is the honest outcome.
      // With no star on offer, aim at a bottom-row common. That row is pinned
      // to the pit floor by gravity, so its seeded x positions survive the
      // re-piling that extraction causes — unlike everything stacked above it.
      const FLOOR_ROW = [130, 164, 198, 232, 266];
      const targetX =
        starX !== null ? starX + STAR_BIAS : FLOOR_ROW[Math.floor(rng() * FLOOR_ROW.length)];

      const aimX = clamp(targetX + gauss(rng) * sigma, SWEEP_X0 + 2, SWEEP_X1 - 2);

      // Coarse phase: schedule the wait so we arrive EARLY, not on time.
      const ph = phaseOf(a, b, SWEEP_MS);
      const vStar = (aimX - SWEEP_X0) / (SWEEP_X1 - SWEEP_X0);
      const dt = waitFor(ph.u, vStar, SWEEP_MS);
      // Park the cursor now so the fire below is a bare down-edge.
      const at = d.toClient(W / 2, 300);
      await d.page.mouse.move(at.x, at.y);
      const spent = (await d.pageNow()) - ph.at;
      await d.page.waitForTimeout(Math.max(0, dt - spent - EARLY_MS));

      // Fine phase: poll the real trolley and fire one probe-latency short of
      // the aim. This reads position instead of predicting it, which is what
      // kills the scheduled stop's bimodal error.
      //
      // The loop is TIME-bounded, not iteration-bounded: an iteration count
      // only spans the early-arrival window because a probe happens to cost
      // ~8ms on this host — on a faster one, N cheap round trips can finish
      // before the trolley arrives, and a poll that gives up without pressing
      // desyncs the whole round (the game consumes no credit, the end card
      // never shows, and the runner times out). The deadline covers the
      // early lead plus one full sweep period, so even a missed crossing comes
      // back around; and if the deadline still expires, the bot presses
      // wherever the trolley is — a wasted credit keeps the round honest, a
      // skipped one hangs it.
      const fireBy = Date.now() + EARLY_MS + SWEEP_MS + 300;
      let prev = await sampleTrolley();
      let fired = false;
      while (Date.now() < fireBy) {
        const cur = await sampleTrolley();
        if (!cur || !prev) {
          prev = cur;
          await d.page.waitForTimeout(12);
          continue;
        }
        const dir = Math.sign(cur.x - prev.x) || 1;
        const remain = (aimX - cur.x) * dir; // px to the crossing, along travel
        if (remain <= SWEEP_SPEED * FIRE_LEAD_MS && remain > -SWEEP_SPEED * 40) {
          await d.page.mouse.down(); // any press stops the trolley
          await d.page.mouse.up();
          fired = true;
          break;
        }
        prev = cur;
        await d.page.waitForTimeout(4); // pace fast hosts; ~4px of travel max
      }
      if (!fired) {
        await d.page.mouse.down();
        await d.page.mouse.up();
      }

      // Descend, grab, hoist, carry, release, and the between-credits beat.
      await d.page.waitForTimeout(7000);
    }
  },
};
