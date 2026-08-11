// Venue business hours — TypeScript mirror of server/lib/venueHours.js's
// `isVenueOpen`, for the player-facing "Open now / Closed" status. The server
// file is the canonical algorithm and owns the full data-shape doc + storage
// validation (`normalizeHours`); this client copy only needs the read side —
// content served by /api/content (and the bundled offline fallback) already
// round-tripped through the server's validator, so there's nothing to
// normalize here. Dependency-free, matching the server.
//
// Shape (location.hours; null = unknown/unset):
//   { "mon": {"open":"12:00","close":"21:00"}, "tue": "closed", ... }
// Keys are any subset of the 7 weekday keys below; a missing day is treated as
// closed. Times are 24h "HH:MM"; close may be "24:00" (midnight) and may be
// earlier than open to mean an overnight close (e.g. open 20:00 close 02:00).

// Index matches JS Date.getDay() / Intl weekday: 0=Sun .. 6=Sat.
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type DayHours = { open: string; close: string } | 'closed';
// A subset of weekdays — a missing key means that day is closed.
export type VenueHours = Partial<Record<WeekdayKey, DayHours>>;

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

// Weekday (key + 0=Sun..6=Sat index) + minutes-since-midnight for an instant,
// in a given IANA zone. Callers that need real tz math guard `tz` first.
function tzParts(
  tz: string | null | undefined,
  at: Date,
): { weekday: WeekdayKey; index: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz ?? undefined,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  let weekday: WeekdayKey = 'mon';
  let hour = 0;
  let minute = 0;
  for (const p of fmt.formatToParts(at)) {
    if (p.type === 'weekday') weekday = p.value.slice(0, 3).toLowerCase() as WeekdayKey;
    else if (p.type === 'hour') hour = Number(p.value) % 24; // "24" at midnight → 0
    else if (p.type === 'minute') minute = Number(p.value);
  }
  return { weekday, index: WEEKDAY_KEYS.indexOf(weekday), minutes: hour * 60 + minute };
}

/**
 * Is the venue open at instant `at` (default now), evaluated in its own tz?
 * Unknown/unset hours or a missing tz → false (fail closed, mirroring the
 * server). A missing or "closed" day → false. For an overnight window
 * (close <= open) the pre-midnight slice (t >= open) belongs to today and the
 * post-midnight slice (t < close) belongs to the PREVIOUS day's entry — so
 * after midnight we check yesterday's window, not today's.
 */
export function isVenueOpen(
  hours: VenueHours | null | undefined,
  tz: string | null | undefined,
  at: Date = new Date(),
): boolean {
  if (!hours || typeof hours !== 'object') return false;
  if (!tz) return false;
  const { index, minutes } = tzParts(tz, at);
  if (index < 0) return false;

  // Today's window: same-day, or the pre-midnight part of an overnight window.
  const today = hours[WEEKDAY_KEYS[index]];
  if (today && today !== 'closed') {
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
  if (prev && prev !== 'closed') {
    const open = toMinutes(prev.open);
    const close = toMinutes(prev.close);
    if (close <= open && minutes < close) return true; // overnight, post-midnight
  }
  return false;
}

/**
 * Today's hours entry for display, in the venue's own tz: `{open,close}`,
 * `"closed"` (explicit or a missing day), or `null` when hours are wholly
 * unset/unknown (no tz, or `hours` is null) — callers should distinguish that
 * from "closed" (e.g. "Hours unavailable" vs. "Closed").
 */
export function todaysHours(
  hours: VenueHours | null | undefined,
  tz: string | null | undefined,
  at: Date = new Date(),
): DayHours | null {
  if (!hours || typeof hours !== 'object' || !tz) return null;
  const { weekday } = tzParts(tz, at);
  return hours[weekday] ?? 'closed';
}

export function weekdayLabel(day: WeekdayKey): string {
  return WEEKDAY_LABELS[day];
}

/** Which weekday key `at` (default now) falls on in the venue's own tz. */
export function currentWeekday(tz: string | null | undefined, at: Date = new Date()): WeekdayKey {
  return tzParts(tz, at).weekday;
}

// Display order for a full-week listing (Mon..Sun), independent of the
// Date.getDay()-aligned WEEKDAY_KEYS storage order above.
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
