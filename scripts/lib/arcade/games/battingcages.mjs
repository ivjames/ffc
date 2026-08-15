// Batting Cages policy — swing timing against a pitch whose SPEED is the
// unknown, which makes it the first game where the bot has to estimate a
// velocity rather than read a position.
//
// The input is a hold-release pair: pressing loads the bat and starts the
// pitch (after a random 250–900ms beat), and the RELEASE is the swing —
// outcomeFor() scores the release time against pitchStart + travelMs, with
// travelMs drawn fresh per pitch from 880–1360ms. Neither the delay nor the
// travel time is knowable in advance, so dead reckoning is out; but the ball
// itself is a white sphere flying straight down the x = W/2 column, so the bot
// watches it: probe the column, take two fixes, fit the (constant) velocity,
// and release when the predicted plate arrival is one probe-latency away.
//
// The scoring windows are wide — ±70ms is a HOME RUN, against the ~±10ms this
// rig executes a planned release at (measured on the claw's stop) — so unlike
// the claw there is no precision fight here: an expert bot homers nearly every
// pitch, and the skill knob is almost purely the human-error term.
import { clamp, gauss, sigmaFor } from '../skill.mjs';

const W = 340;
const H = 560;
const MOUND_Y = 72;
const PLATE_Y = 464; // ideal contact line
const PITCHES = 10;
const RESULT_MS = 780;

// Watch the ball over this column band. Starts below the mound so the ball is
// clear of the pitcher art, ends above the plate to leave polling room.
const WATCH_Y0 = 110;
const WATCH_Y1 = 450;
const FIRE_LEAD_MS = 10;

/** Ball centre in a probed column: centroid of the near-white run (the ball is
 *  the only white sphere in the lane; the cage art is darker and warm). */
function ballY(run, { from, span }) {
  const n = run.h;
  let wSum = 0;
  let wPos = 0;
  for (let i = 0; i < n; i++) {
    const r = run.px[i * 4];
    const g = run.px[i * 4 + 1];
    const b = run.px[i * 4 + 2];
    if (run.px[i * 4 + 3] < 60) continue;
    if (r < 205 || g < 205 || b < 205) continue; // near-white only
    const w = r + g + b;
    wSum += w;
    wPos += w * i;
  }
  if (wSum <= 0) return null;
  return from + (wPos / wSum / n) * span;
}

export default {
  key: 'battingcages',
  route: '/arcade/batting',
  label: 'Batting Cages',
  field: { W, H },
  ticketsFor: (score) => score * 2,
  // hold + delay + travel + result beat, per pitch.
  estRoundMs: PITCHES * 3400 + 8000,
  needsStart: true,

  async play(d, { rng, skill }) {
    // Human error on the release, in ms. ±70 is a homer, ±145 a hit, ±215 a
    // foul — so this range walks a player from "mostly homers" down to "fouls
    // and whiffs with the odd hit".
    const sigmaMs = sigmaFor(skill, 130, 12);

    const sample = async () => {
      // The round can end while a poll is in flight (the canvas unmounts under
      // the probe) — treat that as "gone", never as a crash.
      try {
        const run = await d.probeCol(W / 2, { y0: WATCH_Y0, y1: WATCH_Y1 });
        const y = ballY(run, { from: WATCH_Y0, span: WATCH_Y1 - WATCH_Y0 });
        return y === null ? null : { t: run.t, y };
      } catch {
        return 'gone';
      }
    };

    for (let pitch = 0; pitch < PITCHES; pitch++) {
      if (await d.page.getByRole('button', { name: 'Play again' }).isVisible().catch(() => false)) {
        break; // a desynced pitch count must not out-run the round
      }
      // Load the bat — the press also starts the pitch clock.
      const at = d.toClient(W / 2, 300);
      await d.page.mouse.move(at.x, at.y);
      await d.page.mouse.down();

      // This pitch's human error, decided before the ball is even thrown —
      // a player commits to their read, they don't re-roll it mid-flight.
      const jitterMs = gauss(rng) * sigmaMs;

      // Watch for the ball, then fit velocity against an ANCHORED first fix.
      // Adjacent 12ms samples cannot carry a velocity: the centroid wobbles
      // ±2px probe to probe while the ball only truly moves ~0.15px in that
      // window, so a consecutive-sample fit is nearly all noise — measured, it
      // sent everyone's release early and cost the expert a third of their
      // homers. Fitting against the first fix over a ≥40px baseline averages
      // the wobble away; the velocity is constant per pitch (one travelMs draw
      // in newPitch), so a single wide-baseline fit is exact.
      let anchor = null;
      let released = false;
      for (let i = 0; i < 400 && !released; i++) {
        const cur = await sample();
        if (cur === 'gone') break;
        if (!cur) {
          await d.page.waitForTimeout(12);
          continue;
        }
        if (!anchor || cur.y < anchor.y) {
          anchor = cur; // first sight of this pitch (or a new pitch re-arming)
          continue;
        }
        if (cur.y - anchor.y >= 40) {
          const v = (cur.y - anchor.y) / (cur.t - anchor.t); // px/ms downward
          const eta = (PLATE_Y - cur.y) / v; // ms until ideal contact
          const fireIn = eta + jitterMs - FIRE_LEAD_MS;
          // Commit as soon as the crossing is inside a short prediction
          // window, and TRUST the fit across it. Demanding the ball still be
          // in view at fire time (an earlier <24ms gate) silently excluded
          // slow pitches, which leave the watch band while eta is still
          // ~48ms — every one of them fell through to the timeout swing and
          // scored zero. The wide-baseline v is exact (constant per pitch),
          // so a ≤140ms extrapolation costs nothing.
          if (fireIn < 140) {
            await d.page.waitForTimeout(Math.max(0, fireIn));
            await d.page.mouse.up(); // the release IS the swing
            released = true;
            break;
          }
        }
      }
      if (!released) await d.page.mouse.up(); // lost the ball — swing anyway

      // Result beat, then the next pitch loads.
      await d.page.waitForTimeout(RESULT_MS + 500);
    }
  },
};
