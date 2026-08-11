// Shared projection math for synthetic (bot) player volume. Used by BOTH the
// admin control plane (routes/admin/syntheticBot.js) and the load bot
// (scripts/course-bot.mjs), so the players/year an operator sees in Master
// Control and the players/year the bot prints at launch come from ONE formula —
// no drift between the estimate and what actually runs.
import { WEEKDAY_KEYS } from "./venueHours.js";

// A tropical year is ~52.14 weeks; used to annualize a weekly open-hours budget.
export const WEEKS_PER_YEAR = 52.142857;

/**
 * Total open hours per week for a venue's `hours` object (the jsonb shape from
 * venueHours.js). Unknown/unset/`closed` days contribute 0 — fail-closed, the
 * same posture isVenueOpen takes. Handles same-day and overnight windows.
 */
export function weeklyOpenHours(hours) {
  if (!hours || typeof hours !== "object") return 0;
  let mins = 0;
  for (const key of WEEKDAY_KEYS) {
    const d = hours[key];
    if (!d || d === "closed") continue;
    const to = (s) => (s === "24:00" ? 1440 : Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)));
    const o = to(d.open);
    const c = to(d.close);
    mins += c > o ? c - o : 1440 - o + c; // same-day or overnight wrap
  }
  return mins / 60;
}

/**
 * Project annual synthetic volume for a cadence over a set of courses. Each
 * course carries `{ hours }` — its venue's hours object (or null).
 *
 *   plays        rounds per course per sweep
 *   intervalMin  minutes between sweeps (0 → no annual rate; treated as "as fast
 *                as possible", which has no fixed per-year projection)
 *   maxPlayers   players/round is uniform 1..maxPlayers, so avg = (1+max)/2
 *   ignoreHours  true → 24/7; false → only while each venue is open
 *
 * Returns rounds/players per year for the 24/7 ceiling (`max`), the hours-gated
 * expectation (`gated` — the realistic number when venues gate play), and
 * `effective` (whichever the ignoreHours flag selects).
 */
export function projectVolume({ courses, plays, intervalMin, maxPlayers, ignoreHours }) {
  const n = courses.length;
  const avgPlayers = (1 + maxPlayers) / 2;
  const sweepsPerHour = intervalMin > 0 ? 60 / intervalMin : 0;

  const maxRoundsPerYear = n * plays * sweepsPerHour * 24 * 365;

  // Gated: each course only plays while its venue is open, so its expected
  // sweeps/year ≈ (weekly open hours ÷ interval hours) × weeks/year.
  let gatedRoundsPerYear = 0;
  if (intervalMin > 0) {
    const intervalHours = intervalMin / 60;
    for (const c of courses) {
      gatedRoundsPerYear += plays * (weeklyOpenHours(c.hours) / intervalHours) * WEEKS_PER_YEAR;
    }
  }

  const effectiveRoundsPerYear = ignoreHours ? maxRoundsPerYear : gatedRoundsPerYear;
  return {
    avgPlayers,
    max: {
      roundsPerYear: maxRoundsPerYear,
      playersPerYear: maxRoundsPerYear * avgPlayers,
    },
    gated: {
      roundsPerYear: gatedRoundsPerYear,
      playersPerYear: gatedRoundsPerYear * avgPlayers,
    },
    effective: {
      roundsPerYear: effectiveRoundsPerYear,
      playersPerYear: effectiveRoundsPerYear * avgPlayers,
    },
  };
}
