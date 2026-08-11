// Venue business hours — TypeScript mirror of server/lib/venueHours.js. The
// server file is the canonical algorithm and owns storage validation
// (normalizeHours / normalizeHoursOverrides / normalizeHoursSeasons); this
// client copy only needs the READ side (content served by /api/content, and the
// bundled offline fallback, already round-tripped through the server validator).
//
// A venue's schedule has three layers, resolved most-specific first per date
// (all in the venue's own tz): per-date `overrides` → date-ranged `seasons`
// (later match wins) → base `weekly`. A date in none falls back to `weekly`.
// Times are 24h "HH:MM"; close may be "24:00" and may be earlier than open for
// an overnight window whose post-midnight slice belongs to the PREVIOUS date.

// Index matches JS Date.getDay() / Intl weekday: 0=Sun .. 6=Sat.
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type DayHours = { open: string; close: string } | 'closed';
// A subset of weekdays — a missing key means that day is closed.
export type VenueHours = Partial<Record<WeekdayKey, DayHours>>;
// Per-date exceptions, keyed by "YYYY-MM-DD".
export type HoursOverrides = Record<string, DayHours>;
// A date-ranged weekly pattern (inclusive [from, to]).
export type HoursSeason = { from: string; to: string; weekly: VenueHours; label?: string };
// Everything needed to resolve open/closed for a venue.
export type VenueSchedule = {
  weekly?: VenueHours | null;
  overrides?: HoursOverrides | null;
  seasons?: HoursSeason[] | null;
};

const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
};

function toMinutes(hhmm: string): number {
  if (hhmm === '24:00') return 24 * 60;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// { ymd, index (0=Sun..6=Sat), minutes } for an instant, in a given IANA zone.
function tzDateParts(
  tz: string | null | undefined,
  at: Date,
): { ymd: string; index: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz ?? undefined,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  let weekday: WeekdayKey = 'mon';
  let year = '1970';
  let month = '01';
  let day = '01';
  let hour = 0;
  let minute = 0;
  for (const p of fmt.formatToParts(at)) {
    if (p.type === 'weekday') weekday = p.value.slice(0, 3).toLowerCase() as WeekdayKey;
    else if (p.type === 'year') year = p.value;
    else if (p.type === 'month') month = p.value;
    else if (p.type === 'day') day = p.value;
    else if (p.type === 'hour') hour = Number(p.value) % 24;
    else if (p.type === 'minute') minute = Number(p.value);
  }
  return {
    ymd: `${year}-${month}-${day}`,
    index: WEEKDAY_KEYS.indexOf(weekday),
    minutes: hour * 60 + minute,
  };
}

// The calendar date one day before `ymd` (pure date math, tz-independent).
function prevYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/**
 * The effective hours entry ({open,close} | "closed") for a calendar date +
 * weekday, resolving overrides → season → base weekly.
 */
export function effectiveDayHours(
  schedule: VenueSchedule | null | undefined,
  ymd: string,
  weekdayIndex: number,
): DayHours {
  const key = WEEKDAY_KEYS[weekdayIndex];
  const overrides = schedule?.overrides;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, ymd)) {
    return overrides[ymd];
  }
  const seasons = schedule?.seasons;
  if (Array.isArray(seasons)) {
    let match: HoursSeason | null = null;
    for (const s of seasons) {
      if (s && s.from <= ymd && ymd <= s.to) match = s; // later match wins
    }
    if (match) return match.weekly[key] ?? 'closed';
  }
  return schedule?.weekly?.[key] ?? 'closed';
}

function entryCovers(entry: DayHours, minutes: number, side: 'today' | 'carryover'): boolean {
  if (!entry || entry === 'closed') return false;
  const open = toMinutes(entry.open);
  const close = toMinutes(entry.close);
  if (close > open) {
    return side === 'today' && minutes >= open && minutes < close;
  }
  if (side === 'today') return minutes >= open;
  return minutes < close;
}

/**
 * Is the venue open at instant `at` (default now), evaluated in its own tz?
 * `schedule` = { weekly, seasons, overrides }. Unknown/empty schedule or a
 * missing tz → false (fail closed). Considers today's effective hours AND the
 * previous date's (overnight carryover).
 */
export function isVenueOpen(
  schedule: VenueSchedule | null | undefined,
  tz: string | null | undefined,
  at: Date = new Date(),
): boolean {
  if (!schedule || typeof schedule !== 'object') return false;
  if (!tz) return false;
  const { ymd, index, minutes } = tzDateParts(tz, at);
  if (index < 0) return false;
  if (entryCovers(effectiveDayHours(schedule, ymd, index), minutes, 'today')) return true;
  if (entryCovers(effectiveDayHours(schedule, prevYmd(ymd), (index + 6) % 7), minutes, 'carryover'))
    return true;
  return false;
}

/**
 * Today's effective hours entry for display, in the venue's own tz: `{open,close}`
 * or `"closed"`; `null` when there's no schedule/tz at all (so callers can show
 * "Hours unavailable" vs. "Closed").
 */
export function todaysHours(
  schedule: VenueSchedule | null | undefined,
  tz: string | null | undefined,
  at: Date = new Date(),
): DayHours | null {
  if (!schedule || typeof schedule !== 'object' || !tz) return null;
  const { ymd, index } = tzDateParts(tz, at);
  if (index < 0) return null;
  return effectiveDayHours(schedule, ymd, index);
}

/** True if today's effective hours differ from the plain base-weekly entry —
 *  i.e. an override or season is in effect today (for a "Special hours" badge). */
export function hasSpecialHoursToday(
  schedule: VenueSchedule | null | undefined,
  tz: string | null | undefined,
  at: Date = new Date(),
): boolean {
  if (!schedule || !tz) return false;
  const { ymd, index } = tzDateParts(tz, at);
  if (index < 0) return false;
  const effective = effectiveDayHours(schedule, ymd, index);
  const base = schedule.weekly?.[WEEKDAY_KEYS[index]] ?? 'closed';
  return JSON.stringify(effective) !== JSON.stringify(base);
}

export function weekdayLabel(day: WeekdayKey): string {
  return WEEKDAY_LABELS[day];
}

/** Which weekday key `at` (default now) falls on in the venue's own tz. */
export function currentWeekday(tz: string | null | undefined, at: Date = new Date()): WeekdayKey {
  return WEEKDAY_KEYS[tzDateParts(tz, at).index] ?? 'mon';
}

// Display order for a full-week listing (Mon..Sun).
export const WEEK_DISPLAY_ORDER: readonly WeekdayKey[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
];

function formatTime(hhmm: string): string {
  if (hhmm === '24:00') return '12:00 AM';
  const [hStr, m] = hhmm.split(':');
  let h = Number(hStr);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}

/** Render a day's hours for display: "11:00 AM – 9:00 PM" or "Closed". */
export function formatDayHours(day: DayHours | null | undefined): string {
  if (!day || day === 'closed') return 'Closed';
  return `${formatTime(day.open)} – ${formatTime(day.close)}`;
}
