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
// This models the BASE WEEKLY pattern only. Date-specific overrides (holidays,
// private events) are a deliberate follow-up, not represented here.

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

// Weekday key + minutes-since-midnight for an instant, in a given IANA zone.
function tzParts(tz, at) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "America/Los_Angeles",
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
  return { weekday, minutes: hour * 60 + minute };
}

/**
 * Is the venue open at instant `at` (default now), evaluated in its own tz?
 * Unknown/unset hours (null) → false — callers that gate on this fail closed.
 * A missing or "closed" day → false. Handles same-day and overnight closes.
 */
export function isVenueOpen(hours, tz, at = new Date()) {
  if (!hours || typeof hours !== "object") return false;
  const { weekday, minutes } = tzParts(tz, at);
  const day = hours[weekday];
  if (!day || day === "closed") return false;
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  if (close > open) return minutes >= open && minutes < close; // same-day
  return minutes >= open || minutes < close; // overnight wrap
}
