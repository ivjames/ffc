// Two-axis sweep aiming — shared by Axe Throw and Darts, which use the same
// mechanic: a vertical guide sweeps left↔right and a tap locks the x; then a
// horizontal guide sweeps up↕down and a second tap locks the y. The projectile
// sticks where the two cross, so hitting a point is a pure timing problem on
// each axis.
//
// Both axes ride the same triangle wave used by the meter in highstriker.mjs,
// but they are solved by DIFFERENT means, because the games hand us a freebie:
//
//   X — phase unknown. gs.sweepBase was last set from a rAF frame at the end of
//       the previous throw, so it cannot be dead-reckoned. The bot probes the
//       canvas for the glowing amber guide line, samples twice to get direction,
//       and schedules the tap. Same technique as the High Striker meter.
//
//   Y — phase KNOWN. Locking x runs `gs.sweepBase = now` inside the pointerdown
//       handler (AxeThrow.tsx onTap, Darts.tsx likewise), so the vertical sweep
//       restarts from the bot's own tap. Its phase is therefore whatever the
//       clock said when we pressed, and the y tap is plain dead reckoning off a
//       timestamp we measured ourselves — no second probe, and no accumulated
//       error, since the next throw re-probes x from scratch.
//
// The guides are drawn with fx.neonLine in amber (#fbbf24) plus a glow, so the
// line is several pixels wide with a bright core. Matching takes the
// intensity-weighted centroid of the amber run rather than the single best
// pixel, which recovers the line's position to well under a pixel and shrugs off
// the glow's falloff.

const AMBER = [251, 191, 36];

/** Triangle wave 0→1→0, matching the games' own triWave. */
export const triWave = (t, period) => {
  const u = ((t % period) + period) / period % 1;
  return u < 0.5 ? u * 2 : 2 - u * 2;
};

/**
 * Locate the amber sweep guide in a probed run, as an intensity-weighted
 * centroid in logical units. Returns null when no convincing amber is present
 * (the guide is not drawn in every phase, so "absent" is a real answer).
 */
export function findGuide(run, { from, span }) {
  const n = run.w ?? run.h;
  let wSum = 0;
  let wPos = 0;
  for (let i = 0; i < n; i++) {
    const r = run.px[i * 4];
    const g = run.px[i * 4 + 1];
    const b = run.px[i * 4 + 2];
    // Amber-dominant and bright. Deliberately strict: the boards themselves
    // carry warm browns and low-alpha amber sparkle, and a nearest-colour match
    // would happily lock onto those when the guide is off-screen.
    if (r < 170 || b > 130 || g < 110 || g > 240 || r - b < 90) continue;
    const w = r + g - b; // brightest at the line's core
    wSum += w;
    wPos += w * i;
  }
  if (wSum <= 0) return null;
  return from + ((wPos / wSum) / n) * span;
}

/**
 * Phase of a sweep, in ms since its last zero, from two probes of the same axis.
 * A single reading fixes the value but not the direction — 0.4 rising and 0.4
 * falling are the same picture — so the second sample disambiguates.
 *
 * @param {{t:number, v:number}} a earlier sample  @param {{t:number, v:number}} b later
 * @returns {{ u: number, at: number, rising: boolean }}
 */
export function phaseOf(a, b, period) {
  const rising = b.v >= a.v;
  const half = period / 2;
  return { u: rising ? b.v * half : period - b.v * half, at: b.t, rising };
}

/**
 * Delay from phase `u` until the wave next reads `target` on its RISING edge.
 * Rising-edge only, so a late tap overshoots toward the far end of the sweep
 * rather than doubling back — the error stays one-sided and predictable.
 */
export function waitFor(u, target, period, minLeadMs = 90) {
  const uStar = target * (period / 2);
  let dt = (((uStar - u) % period) + period) % period;
  if (dt < minLeadMs) dt += period;
  return dt;
}

/**
 * Play one two-axis throw: probe and lock x, then dead-reckon and lock y.
 *
 * @param {import('./driver.mjs').ArcadeDriver} d
 * @param {{x:number,y:number}} aim target point in logical units
 * @param {object} cfg game geometry + sweep periods
 * @returns {Promise<boolean>} false when the x guide could not be found
 */
export async function throwAt(d, aim, cfg) {
  const { X0, X1, Y0, Y1, xMs, yMs, probeY, inputLatencyMs = 12 } = cfg;

  // —— X: probe, then schedule ——
  const sample = async () => {
    const run = await d.probeRow(probeY, { x0: X0 - 8, x1: X1 + 8 });
    const x = findGuide(run, { from: X0 - 8, span: X1 + 8 - (X0 - 8) });
    return x === null ? null : { t: run.t, v: (x - X0) / (X1 - X0) };
  };

  const a = await sample();
  await d.page.waitForTimeout(80);
  const b = await sample();
  if (!a || !b) return false;

  const px = phaseOf(a, b, xMs);
  const targetX = Math.min(1, Math.max(0, (aim.x - X0) / (X1 - X0)));
  const dtX = waitFor(px.u, targetX, xMs);
  const spentX = (await d.pageNow()) - px.at;
  await d.page.waitForTimeout(Math.max(0, dtX - spentX - inputLatencyMs));

  // The press rebases the vertical sweep, so capture when it actually landed.
  const lock = await d.tapTimed(d.W / 2, d.H - 60);

  // —— Y: dead reckoning from our own tap ——
  // sweepBase === lock.t, so the guide sits at Y0 at that instant and rises.
  const targetY = Math.min(1, Math.max(0, (aim.y - Y0) / (Y1 - Y0)));
  const dtY = waitFor(0, targetY, yMs);
  const spentY = (await d.pageNow()) - lock.t;
  await d.page.waitForTimeout(Math.max(0, dtY - spentY - inputLatencyMs));
  await d.tap(d.W / 2, d.H - 60);
  return true;
}
