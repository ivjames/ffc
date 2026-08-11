// Venue business hours — a small, dependency-free model shared by the server
// (validation + storage on the location row, exposure via /api/content), the
// player app (src/lib/venueHours.ts is a line-for-line mirror), and the load
// bot (scripts/course-bot.mjs gates synthetic play on "is this venue open right
// now, in its own timezone").
//
// A venue's schedule has THREE layers, resolved most-specific first for any
// given calendar date (all evaluated in the venue's own tz):
//   1. overrides  — per-date exceptions: { "2026-08-18": "closed",
//                   "2026-08-28": {"open":"11:00","close":"19:00"} }
//   2. seasons    — date-ranged weekly patterns (inclusive [from,to]):
//                   [{ from, to, weekly, label? }]. Later match wins on overlap.
//   3. weekly     — the base/default weekly pattern (the fallback):
//                   { "mon": {"open":"12:00","close":"21:00"}, "tue": "closed" }
// A date with no override and in no season falls back to `weekly` (so the bot &
// app keep working past the last published calendar date). A missing weekday, a
// missing season day, or an explicit "closed" all mean closed.
//
// A `schedule` passed to the evaluators below is { weekly, seasons, overrides }
// (any of them null/absent). Times are 24h "HH:MM"; close may be "24:00"
// (midnight) and may be earlier than open to mean an overnight close (e.g. open
// 20:00 close 02:00) — the post-midnight slice belongs to the PREVIOUS date.

// Index matches JS Date.getDay() / Intl weekday: 0=Sun .. 6=Sat.
export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// 00:00..23:59 for open; close additionally allows exactly "24:00".
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function toMinutes(hhmm) {
  if (hhmm === "24:00") return 24 * 60;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// True for a real calendar date "YYYY-MM-DD" (rejects e.g. 2026-13-40).
function isValidYmd(s) {
  if (typeof s !== "string" || !YMD.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Validate a single day's value: "closed"/null → "closed"; {open,close} checked.
// Returns { value } | { error } (error message uses `where` for context).
function validateDayValue(v, where) {
  if (v === "closed" || v === null) return { value: "closed" };
  if (typeof v !== "object" || Array.isArray(v)) {
    return { error: `${where} must be {open,close} or "closed"` };
  }
  const { open, close } = v;
  if (typeof open !== "string" || !HHMM.test(open)) {
    return { error: `${where}.open must be "HH:MM" in 00:00..23:59` };
  }
  if (typeof close !== "string" || !(HHMM.test(close) || close === "24:00")) {
    return { error: `${where}.close must be "HH:MM" in 00:00..24:00` };
  }
  if (open === close) return { error: `${where} open and close cannot be equal` };
  return { value: { open, close } };
}

/**
 * Validate + normalize a weekly pattern for storage.
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
    const day = validateDayValue(value[key], `hours.${key}`);
    if (day.error) return { error: day.error };
    out[key] = day.value;
  }
  return { value: out };
}

/**
 * Validate + normalize per-date overrides for storage.
 *   null / undefined / "" → { value: null }
 *   { "YYYY-MM-DD": {open,close} | "closed" } → { value: normalized }
 *   invalid → { error }
 */
export function normalizeHoursOverrides(value) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "hours_overrides must be an object keyed by YYYY-MM-DD, or null" };
  }
  const out = {};
  for (const key of Object.keys(value)) {
    if (!isValidYmd(key)) {
      return { error: `hours_overrides has invalid date key ${JSON.stringify(key)} (use YYYY-MM-DD)` };
    }
    const day = validateDayValue(value[key], `hours_overrides.${key}`);
    if (day.error) return { error: day.error };
    out[key] = day.value;
  }
  return { value: out };
}

/**
 * Validate + normalize seasons (date-ranged weekly patterns) for storage.
 *   null / undefined / "" → { value: null }
 *   [{ from, to, weekly, label? }] → { value: normalized array }
 *   invalid → { error }
 */
export function normalizeHoursSeasons(value) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (!Array.isArray(value)) return { error: "hours_seasons must be an array of {from,to,weekly}, or null" };
  const out = [];
  for (let i = 0; i < value.length; i++) {
    const s = value[i];
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      return { error: `hours_seasons[${i}] must be an object {from,to,weekly}` };
    }
    if (!isValidYmd(s.from)) return { error: `hours_seasons[${i}].from must be YYYY-MM-DD` };
    if (!isValidYmd(s.to)) return { error: `hours_seasons[${i}].to must be YYYY-MM-DD` };
    if (s.from > s.to) return { error: `hours_seasons[${i}] from must be <= to` };
    const weekly = normalizeHours(s.weekly);
    if (weekly.error) return { error: `hours_seasons[${i}].weekly: ${weekly.error}` };
    if (!weekly.value) return { error: `hours_seasons[${i}].weekly is required` };
    if (s.label !== undefined && s.label !== null && typeof s.label !== "string") {
      return { error: `hours_seasons[${i}].label must be a string` };
    }
    const norm = { from: s.from, to: s.to, weekly: weekly.value };
    if (typeof s.label === "string" && s.label) norm.label = s.label;
    out.push(norm);
  }
  return { value: out };
}

// --- evaluation ------------------------------------------------------------

// { ymd: "YYYY-MM-DD", index: 0..6 (Sun..Sat), minutes } for `at` in `tz`.
function tzDateParts(tz, at) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  let weekday = "mon";
  let year = "1970";
  let month = "01";
  let day = "01";
  let hour = 0;
  let minute = 0;
  for (const p of fmt.formatToParts(at)) {
    if (p.type === "weekday") weekday = p.value.slice(0, 3).toLowerCase();
    else if (p.type === "year") year = p.value;
    else if (p.type === "month") month = p.value;
    else if (p.type === "day") day = p.value;
    else if (p.type === "hour") hour = Number(p.value) % 24; // "24" at midnight → 0
    else if (p.type === "minute") minute = Number(p.value);
  }
  return { ymd: `${year}-${month}-${day}`, index: WEEKDAY_KEYS.indexOf(weekday), minutes: hour * 60 + minute };
}

// The calendar date one day before `ymd` (pure date math, tz-independent).
function prevYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/**
 * The effective hours entry ({open,close} | "closed") for a given calendar date
 * + weekday, resolving overrides → season → base weekly. Exported so callers can
 * render "today's hours" without re-deriving the date.
 */
export function effectiveDayHours(schedule, ymd, weekdayIndex) {
  const key = WEEKDAY_KEYS[weekdayIndex];
  const overrides = schedule?.overrides;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, ymd)) {
    return overrides[ymd];
  }
  const seasons = schedule?.seasons;
  if (Array.isArray(seasons)) {
    let match = null;
    for (const s of seasons) {
      if (s && s.from <= ymd && ymd <= s.to) match = s; // later match wins
    }
    if (match) return match.weekly[key] ?? "closed";
  }
  return schedule?.weekly?.[key] ?? "closed";
}

// Does an entry's window cover `minutes`? `side` = "today" (same-day + the
// pre-midnight part of an overnight window) or "carryover" (the post-midnight
// part of a previous-date overnight window).
function entryCovers(entry, minutes, side) {
  if (!entry || entry === "closed") return false;
  const open = toMinutes(entry.open);
  const close = toMinutes(entry.close);
  if (close > open) {
    return side === "today" && minutes >= open && minutes < close; // same-day
  }
  // overnight window
  if (side === "today") return minutes >= open; // pre-midnight (this date, after open)
  return minutes < close; // post-midnight (belongs to the previous date)
}

/**
 * Is the venue open at instant `at` (default now), evaluated in its own tz?
 * `schedule` = { weekly, seasons, overrides } (any absent). Unknown/empty
 * schedule or a missing tz → false (fail closed). Resolves the effective hours
 * for today's date AND the previous date (so an overnight window that opened
 * yesterday still counts after midnight).
 */
export function isVenueOpen(schedule, tz, at = new Date()) {
  if (!schedule || typeof schedule !== "object") return false;
  if (!tz) return false;
  const { ymd, index, minutes } = tzDateParts(tz, at);
  if (index < 0) return false;

  const today = effectiveDayHours(schedule, ymd, index);
  if (entryCovers(today, minutes, "today")) return true;

  const prev = effectiveDayHours(schedule, prevYmd(ymd), (index + 6) % 7);
  if (entryCovers(prev, minutes, "carryover")) return true;

  return false;
}
