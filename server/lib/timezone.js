// Venue timezone helpers.
//
// The leaderboard buckets rounds by *calendar* day/week/month in each venue's
// local time (see routes/leaderboard.js), so every venue needs a correct IANA
// zone in `location.tz`. This module is the contract for producing and
// displaying that value:
//
//   - onboarding WRITES it:   tzFromCoords(lat, lng)  -> "America/Los_Angeles"
//   - admin UIs DISPLAY it:   friendlyTzLabel(tz)     -> "Pacific Time (PT)"
//   - either side may VALIDATE: isValidTz(tz)         -> boolean
//
// We store the IANA name (never a 3-letter abbreviation): abbreviations are a
// FIXED offset, so "PST" is UTC-8 all year and silently ignores daylight time —
// bucketing summer rounds an hour off the local midnight — and they're also
// ambiguous ("CST" = US Central / China / Cuba). IANA names carry the DST rules
// and are unique. Humans never type these: onboarding derives the zone from the
// venue's coordinates, and admin screens render a friendly label from it.
import tzlookup from "tz-lookup";

// Reference instant for deriving *generic* (season-independent) zone labels.
// Generic names ("Pacific Time" / "PT") don't depend on the date, but Intl needs
// some timestamp to format against; a fixed one keeps the output deterministic.
const LABEL_REF = new Date("2021-06-01T00:00:00Z");

/**
 * Map venue coordinates to an IANA timezone, e.g. "America/Los_Angeles".
 *
 * This is what the onboarding system calls: it already captures the venue's
 * lat/lng, so it can populate `location.tz` with no human picking or typing a
 * zone — which also sidesteps the whole "IANA names look confusing" concern,
 * since nobody onboarding a venue ever sees the string.
 *
 * @param {number} lat  WGS84 latitude,  -90..90
 * @param {number} lng  WGS84 longitude, -180..180
 * @returns {string} IANA zone name (always a valid, DST-aware identifier)
 * @throws {TypeError} if lat/lng aren't finite numbers
 * @throws {RangeError} if lat/lng are out of range (from tz-lookup)
 */
export function tzFromCoords(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new TypeError("tzFromCoords: lat/lng must be finite numbers");
  }
  return tzlookup(lat, lng);
}

/**
 * True if `tz` is a canonical IANA zone. Use it to validate a value before
 * writing it to `location.tz`, so neither a typo nor a fixed-offset abbreviation
 * can reach the leaderboard query (an unknown zone would throw and break the
 * board; an abbreviation like "PST" would silently ignore DST).
 *
 * Two checks: (1) the identifier must be an "Area/Location" name — every real
 * IANA region zone contains a "/", while DST-ignoring abbreviations ("PST",
 * "CST", "EST5EDT") never do; "UTC" is the one slash-less name we allow. Then
 * (2) the runtime must actually recognize it. Part (1) is what rejects the
 * fixed-offset abbreviations that `Intl`/Postgres would otherwise silently
 * accept. (We intentionally don't test against `Intl.supportedValuesOf`: some
 * ICU builds omit valid canonical zones from that list — even "UTC" and
 * "America/Argentina/Buenos_Aires" — so it produces false rejections.)
 *
 * @param {unknown} tz
 * @returns {boolean}
 */
export function isValidTz(tz) {
  if (typeof tz !== "string" || tz.length === 0) return false;
  if (!tz.includes("/") && tz !== "UTC") return false;
  try {
    // Constructing a formatter with an unknown timeZone throws RangeError.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Human-friendly, season-independent label for an IANA zone, for admin UIs:
 * "America/Los_Angeles" -> "Pacific Time (PT)". Uses the runtime's generic
 * (non-DST-specific) names so the label reads the same in summer and winter.
 * Falls back to the raw zone name if the runtime can't produce a generic label.
 *
 * @param {string} tz  IANA zone name
 * @returns {string}
 */
export function friendlyTzLabel(tz) {
  if (!isValidTz(tz)) return typeof tz === "string" ? tz : "";
  const part = (style) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: style })
      .formatToParts(LABEL_REF)
      .find((p) => p.type === "timeZoneName")?.value;
  const long = part("longGeneric"); // "Pacific Time"
  const short = part("shortGeneric"); // "PT"
  if (!long) return tz;
  // Zones without a real abbreviation echo an offset ("GMT-8") for shortGeneric;
  // don't parenthesize that — the long name (itself possibly an offset) stands.
  if (short && short !== long && !/^GMT/i.test(short)) return `${long} (${short})`;
  return long;
}
