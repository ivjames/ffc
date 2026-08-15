// High Striker policy — the timing class, and the reason the driver can read
// pixels.
//
// The power meter sweeps on a triangle wave whose phase lives in a React ref
// (gs.meterBase) that nothing outside the component can read, and which is
// re-based from a rAF frame on every swing, so dead reckoning from a known
// start time drifts immediately. Instead the bot does what a player does: it
// LOOKS at the meter, works out where in the sweep it is, and taps when the bar
// will be where it wants it.
//
// Meter geometry (drawMeter in src/features/fun/HighStriker.tsx): the bar fills
// upward from the bottom, so the fill's top edge sits at
//   yTop = METER.y + 2 + (METER.h - 4) * (1 - value)
// and inverting that from a probed column gives the live value. The zone ticks
// are also drawn bright, but they are exactly 1px tall, so the fill edge is
// found by requiring a contiguous run of bright pixels rather than one hit.
//
// Because the meter is re-read before every swing, phase error never
// accumulates across a round — each swing is an independent measurement.
import { clamp, gauss, sigmaFor } from '../skill.mjs';

const W = 340;
const H = 560;
const METER = { x: 296, y: 336, w: 20, h: 156 };
const METER_MS = 1050; // full 0→100→0 triangle period
const HALF = METER_MS / 2;
const SWINGS = 5;

// Fill top edge as a function of value, and its inverse.
const FILL_TOP = METER.y + 2;
const FILL_H = METER.h - 4;
const valueFromTop = (yTop) => clamp(1 - (yTop - FILL_TOP) / FILL_H, 0, 1);

// CDP round trip for a mouse press, compensated out of the scheduled tap. Small
// and fairly stable; what is left over reads as ordinary human timing error.
const INPUT_LATENCY_MS = 12;
const MIN_LEAD_MS = 90; // don't try to hit a target we are already on top of

/** Locate the fill's top edge in a probed column; null if the bar reads empty. */
function fillTop(run, y0, span) {
  const n = run.h;
  const bright = [];
  for (let i = 0; i < n; i++) {
    const r = run.px[i * 4];
    const g = run.px[i * 4 + 1];
    const b = run.px[i * 4 + 2];
    bright.push(r + g + b > 200);
  }
  // The fill is tall; the zone ticks are 1px. Require 4 consecutive bright
  // samples so a tick can never be mistaken for the top of the bar.
  const RUN = 4;
  for (let i = 0; i + RUN <= n; i++) {
    let ok = true;
    for (let j = 0; j < RUN; j++) if (!bright[i + j]) ok = false;
    if (ok) return y0 + (i / n) * span;
  }
  return null;
}

/** Read the meter's current value (0..1) together with the page clock. */
async function readMeter(d) {
  const y0 = METER.y;
  const span = METER.h;
  const run = await d.probeCol(METER.x + METER.w / 2, { y0, y1: y0 + span });
  const top = fillTop(run, y0, span);
  if (top === null) return { t: run.t, v: 0 };
  return { t: run.t, v: valueFromTop(top) };
}

/**
 * Phase of the sweep, in ms since the wave's last zero, from two readings.
 * One sample gives the value but not the direction (0.4 rising and 0.4 falling
 * look identical), so a second sample a beat later disambiguates.
 */
function phaseFrom(a, b) {
  const rising = b.v > a.v;
  const u = rising ? b.v * HALF : METER_MS - b.v * HALF;
  return { u, at: b.t, rising };
}

export default {
  key: 'highstriker',
  route: '/arcade/striker',
  label: 'High Striker',
  field: { W, H },
  // best/2, +10 for ringing the bell (HighStriker.tsx's GameTicketAward call).
  ticketsFor: (best) => Math.round(best / 2) + (best >= 100 ? 10 : 0),
  estRoundMs: SWINGS * 4200 + 6000,
  needsStart: true,

  async play(d, { rng, skill }) {
    // How far below a perfect 100 this player habitually taps; sigma is in
    // POWER points.
    //
    // NOTE ON THIS GAME'S SPREAD: the headline is the BEST of five swings, which
    // compresses scores toward 100 no matter how wide this sigma gets — the
    // best of five draws is near the top even for a loose player. That is the
    // game's own shape, not a bot artifact, so it is left alone rather than
    // faked into a wider distribution; expect high-Ticket, low-variance rounds
    // here relative to the ball-count games.
    const sigma = sigmaFor(skill, 40, 2);

    for (let swing = 0; swing < SWINGS; swing++) {
      // Two probes to fix value + direction. Re-measured every swing, so the
      // per-swing re-base of meterBase costs us nothing.
      const a = await readMeter(d);
      await d.page.waitForTimeout(90);
      const b = await readMeter(d);
      const { u, at } = phaseFrom(a, b);

      // Aim a little under the peak — overshooting the top just walks back down
      // the other side, so the miss is one-sided in practice.
      const targetPower = clamp(1 - Math.abs(gauss(rng) * (sigma / 100)), 0.05, 1);
      const uStar = targetPower * HALF; // rising edge

      let dt = ((uStar - u) % METER_MS + METER_MS) % METER_MS;
      if (dt < MIN_LEAD_MS) dt += METER_MS;

      // `at` is a page-clock reading taken during the probe; the elapsed local
      // time since that call is already spent, so subtract it from the wait.
      const spent = (await d.pageNow()) - at;
      const wait = Math.max(0, dt - spent - INPUT_LATENCY_MS);
      await d.page.waitForTimeout(wait);
      await d.tap(W / 2, 472); // the striker pad — any tap swings

      // Puck flight, stall, fall and bounce, then the meter resumes.
      await d.page.waitForTimeout(4000);
    }
  },
};
