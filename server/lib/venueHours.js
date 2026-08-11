// Venue business hours — a small, dependency-free model shared by the server
// (validation + storage on the location row, exposure via /api/content) and the
// load bot (scripts/course-bot.mjs gates synthetic play on "is this venue open
// right now, in its own timezone").
//
// Shape (jsonb on location.hours; null = unknown/unset):
//   { "mon": {"open":"12:00","close":"21:00"}, "tue": "closed", ... }
// Keys are any subset of the 7 weekday keys below; a missing day is treated as
// closed. Times are 24h "HH:MM"; close may be "24:00" (midnight) and may be
// earlier than open to mean an overnight close (e.g. open 20:00 close 02:00).
//
// This models one BASE WEEKLY pattern only. Two known follow-ups, deliberately
// not represented here (circling back later):
//   - date-specific overrides (holidays, private-event closures/early-closes);
//   - seasonal variation — real hours shift by season (e.g. summer vs
//     school-year), so the single weekly pattern is a point-in-time snapshot.
// A future model would carry an effective-date-ranged set of weekly patterns
// plus per-date exceptions; until then, keep hours current by editing them in
// Master Control (the bot re-reads them live each sweep).

// Index matches JS Date.getDay() / Intl weekday: 0=Sun .. 6=Sat.
export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// 00:00..23:59 for open; close additionally allows exactly "24:00".
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm) {
  if (hhmm === "24:00") return 24 * 60;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Validate + normalize an hours value for storage.
 *   null / undefined / "" → { value: null }  (unset)
 *   valid object          → { value: {<day>: {open,close} | "closed"} }
 *   invalid               → { error }
 * Unknown day keys, malformed times, and open===close are rejected. `null` for
 * a day is normalized to the string "closed".
 */
export function normalizeHours(value) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "hours must be an object keyed by weekday (mon..sun), or null" };
  }
  const out = {};
  for (const key of Object.keys(value)) {
    if (!WEEKDAY_KEYS.includes(key)) {
      return { error: `hours has unknown day key ${JSON.stringify(key)} (use mon,tue,wed,thu,fri,sat,sun)` };
    }
    const v = value[key];
    if (v === "closed" || v === null) {
      out[key] = "closed";
      continue;
    }
    if (typeof v !== "object" || Array.isArray(v)) {
      return { error: `hours.${key} must be {open,close} or "closed"` };
    }
    const { open, close } = v;
    if (typeof open !== "string" || !HHMM.test(open)) {
      return { error: `hours.${key}.open must be "HH:MM" in 00:00..23:59` };
    }
    if (typeof close !== "string" || !(HHMM.test(close) || close === "24:00")) {
      return { error: `hours.${key}.close must be "HH:MM" in 00:00..24:00` };
    }
    if (open === close) {
      return { error: `hours.${key} open and close cannot be equal` };
    }
    out[key] = { open, close };
  }
  return { value: out };
}

// Weekday index (0=Sun..6=Sat, matching WEEKDAY_KEYS) + minutes-since-midnight
// for an instant, in a given IANA zone. Caller guarantees a real `tz`.
function tzParts(tz, at) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  let weekday = "mon";
  let hour = 0;
  let minute = 0;
  for (const p of fmt.formatToParts(at)) {
    if (p.type === "weekday") weekday = p.value.slice(0, 3).toLowerCase();
    else if (p.type === "hour") hour = Number(p.value) % 24; // "24" at midnight → 0
    else if (p.type === "minute") minute = Number(p.value);
  }
  return { index: WEEKDAY_KEYS.indexOf(weekday), minutes: hour * 60 + minute };
}

/**
 * Is the venue open at instant `at` (default now), evaluated in its own tz?
 *   - Unknown/unset hours (null) → false; missing tz → false (callers that gate
 *     on this fail closed — an unknown zone can't be evaluated).
 *   - A missing or "closed" day → false.
 *   - Same-day window: open <= t < close.
 *   - Overnight window (close <= open): the PRE-midnight slice (t >= open)
 *     belongs to today; the POST-midnight slice (t < close) belongs to the
 *     PREVIOUS day's entry — so after midnight we check yesterday's window, not
 *     today's. (Thu 01:00 is open only if WEDNESDAY has an overnight window
 *     reaching 01:00, never because Thursday itself does.)
 */
export function isVenueOpen(hours, tz, at = new Date()) {
  if (!hours || typeof hours !== "object") return false;
  if (!tz) return false;
  const { index, minutes } = tzParts(tz, at);
  if (index < 0) return false;

  // Today's window: same-day, or the pre-midnight part of an overnight window.
  const today = hours[WEEKDAY_KEYS[index]];
  if (today && today !== "closed") {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (close > open) {
      if (minutes >= open && minutes < close) return true; // same-day
    } else if (minutes >= open) {
      return true; // overnight, pre-midnight (today, after open)
    }
  }

  // Carryover: yesterday's overnight window spilling past midnight into today.
  const prev = hours[WEEKDAY_KEYS[(index + 6) % 7]];
  if (prev && prev !== "closed") {
    const open = toMinutes(prev.open);
    const close = toMinutes(prev.close);
    if (close <= open && minutes < close) return true; // overnight, post-midnight
  }
  return false;
}
