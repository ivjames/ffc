// Water Gun Race policy — sustained tracking, the last input class in the set.
//
// Everything before this is discrete: solve a gesture, or time one tap. Here
// the score comes from a CONTINUOUS act — the stream fills your balloon only
// while the held pointer sits within 20px of a bullseye that drifts on a
// sinusoid whose speed is re-rolled every 1.4–3.6s (freshBull/changeIn). The
// re-rolls make prediction pointless, so the bot simply tracks: probe the
// track row for the bullseye's red ring, move the captured pointer onto it,
// repeat until the round ends.
//
// Tracking is easy at machine cadence — the bull's top lateral speed is
// ~0.15px/ms and a probe+move cycle costs ~20ms, so the bot's lag is a few px
// against a 20px window. The contest is against the CPU rivals' clock instead:
// a player on the bullseye ~95% of the time fills in ~6.3s and beats the
// fastest rival's ~10s; one on it half the time takes ~12s and loses. So the
// skill knob maps to on-target FRACTION (via re-aim cadence and aim wobble),
// and the win rate falls out of the race the game itself runs.
import { clamp, gauss, lerp, sigmaFor } from '../skill.mjs';

const W = 340;
const H = 560;
const BOARD_X = 178;
const BULL_Y = 350;
const DRIFT_AMP = 50;
const HEATS = 3;

// THE TRAP IN THIS GAME: the stream does not land at the finger. toField()
// subtracts AIM_LIFT = 72 from the pointer's y — a touch-ergonomics offset so
// the player's own hand never hides the bullseye. A bot that puts the pointer
// ON the bullseye is therefore aiming 72px above it, a fixed miss on every
// sample, and scores zero while looking perfectly on-target in every probe.
// (Diagnosed from a screenshot: the stream visibly terminated above the
// track.) The pointer must ride BELOW the bull by exactly this much:
const AIM_LIFT = 72;
const HAND_Y = BULL_Y + AIM_LIFT;

// Track scan bounds: the drift range plus the ring radius, and nothing more —
// the clown face art behind the track also carries reds.
const SCAN_X0 = BOARD_X - DRIFT_AMP - 18;
const SCAN_X1 = BOARD_X + DRIFT_AMP + 18;

/** Bullseye centre on the track row: the red ring is the only red RUN of ring
 *  width inside the drift range (the white core splits it into two short runs,
 *  so adjacent runs are merged before the width test). */
function bullX(run, { from, span }) {
  const n = run.w;
  const runs = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    let m = false;
    if (i < n) {
      const r = run.px[i * 4];
      const g = run.px[i * 4 + 1];
      const b = run.px[i * 4 + 2];
      m = run.px[i * 4 + 3] > 60 && r > 170 && g < 95 && b < 95;
    }
    if (m && start < 0) start = i;
    else if (!m && start >= 0) {
      runs.push([start, i]);
      start = -1;
    }
  }
  if (!runs.length) return null;
  // Merge runs split by the white centre ring, then take the widest cluster.
  const merged = [];
  for (const [s, e] of runs) {
    const last = merged[merged.length - 1];
    if (last && s - last[1] < 14) last[1] = e;
    else merged.push([s, e]);
  }
  merged.sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
  const [s, e] = merged[0];
  if (e - s < 3) return null;
  return from + ((s + e) / 2 / n) * span;
}

export default {
  key: 'watergunrace',
  route: '/arcade/watergun',
  label: 'Water Gun Race',
  field: { W, H },
  ticketsFor: (wins) => wins * 25,
  /** The end card is a "you – cpu" heat tally in .text-4xl, not the usual
   *  .text-5xl headline; the score is the FIRST number (your heat wins). */
  readScore: async (page) => {
    const raw = (await page.locator('.text-4xl').first().textContent()) ?? '';
    return raw.trim().split(/\D+/)[0] ?? '';
  },
  // 3 heats × (countdown + ~6–12s race) + inter-heat beats.
  estRoundMs: HEATS * 16_000 + 12_000,
  needsStart: true,

  async play(d, { rng, skill }) {
    // Aim wobble in px and re-aim cadence in ms. Together they set the
    // on-target fraction: an expert re-aims every ~25ms with ~2px wobble
    // (fraction ≈ 0.95), a beginner every ~140ms with ~15px wobble against a
    // 20px window (fraction ≈ 0.5) — enough to lose to the mid rival.
    // Tuned against the rivals' 9.5–13s fill clock: the first cut (σ15/140ms)
    // still held ~60% on-target and swept every heat at skill 0.15 — the race
    // only becomes losable when tracking degrades past the fastest rival's
    // pace, which needs the beginner end pushed to ~40% on-target.
    const sigma = sigmaFor(skill, 24, 2);
    const reaimMs = Math.round(lerp(210, 25, clamp(skill, 0, 1)));

    // Press once and hold — the game captures the pointer, and pointer moves
    // keep updating the aim while spraying. resetHeat never clears `spraying`,
    // so one hold carries across all three heats.
    const start = d.toClient(BOARD_X, HAND_Y);
    await d.page.mouse.move(start.x, start.y);
    await d.page.mouse.down();

    const deadline = Date.now() + this.estRoundMs;
    let sinceCheck = 0;
    while (Date.now() < deadline) {
      // The end card is the only exit signal; check it on a budget rather
      // than every cycle (the check is a full locator round trip).
      if (++sinceCheck >= 25) {
        sinceCheck = 0;
        if (await d.page.getByRole('button', { name: /^(Play|Race) again$/ }).isVisible().catch(() => false)) {
          break;
        }
      }
      let x = null;
      try {
        const row = await d.probeRow(BULL_Y, { x0: SCAN_X0, x1: SCAN_X1 });
        x = bullX(row, { from: SCAN_X0, span: SCAN_X1 - SCAN_X0 });
      } catch {
        break; // canvas unmounted — the round is over
      }
      if (x !== null) {
        const p = d.toClient(
          clamp(x + gauss(rng) * sigma, SCAN_X0, SCAN_X1),
          HAND_Y + gauss(rng) * sigma * 0.5,
        );
        await d.page.mouse.move(p.x, p.y);
      }
      await d.page.waitForTimeout(reaimMs);
    }
    await d.page.mouse.up().catch(() => {});
  },
};
