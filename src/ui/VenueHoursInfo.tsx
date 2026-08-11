import { useEffect, useState } from 'react';
import {
  currentWeekday,
  effectiveDayHours,
  formatDayHours,
  hasSpecialHoursToday,
  isVenueOpen,
  todaysHours,
  weekdayLabel,
  WEEKDAY_KEYS,
  WEEK_DISPLAY_ORDER,
  type HoursOverrides,
  type HoursSeason,
  type VenueHours,
  type VenueSchedule,
} from '../lib/venueHours';

// "Open now / Closed" status + today's hours, with an optional expandable
// weekly list. Self-gating like the other venue cards (FoodDrinkCard,
// AnnouncementBanner): renders nothing when the venue hasn't been given
// hours/tz yet, so screens can mount it unconditionally.
//
// Callers pass the venue's schedule pieces (base weekly + per-date overrides +
// date-ranged seasons) and tz; open/closed and "today's hours" honor all three.

type ScheduleProps = {
  hours?: VenueHours | null;
  hoursOverrides?: HoursOverrides | null;
  hoursSeasons?: HoursSeason[] | null;
  tz?: string | null;
};

function toSchedule(p: ScheduleProps): VenueSchedule {
  return { weekly: p.hours ?? null, overrides: p.hoursOverrides ?? null, seasons: p.hoursSeasons ?? null };
}

// Open/Closed is time-derived, so a mounted card would otherwise go stale when a
// venue opens/closes while the screen is up. Tick every minute to recompute —
// coarse enough to be cheap, fine enough that the flip lands within ~a minute of
// the boundary.
function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Compact "● Open now · 12:00 PM – 9:00 PM today" line. */
export function VenueOpenLine({ className = '', ...props }: ScheduleProps & { className?: string }) {
  const now = useNow();
  if ((!props.hours && !props.hoursOverrides && !props.hoursSeasons) || !props.tz) return null;
  const schedule = toSchedule(props);
  const open = isVenueOpen(schedule, props.tz, now);
  const today = todaysHours(schedule, props.tz, now);
  const special = hasSpecialHoursToday(schedule, props.tz, now);
  return (
    <div className={`flex items-center gap-1.5 text-xs font-semibold ${className}`}>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${open ? 'bg-fairway-400' : 'bg-red-400'}`}
        aria-hidden="true"
      />
      <span className={open ? 'text-fairway-400' : 'text-red-400'}>
        {open ? 'Open now' : 'Closed'}
      </span>
      <span className="truncate text-fairway-100/60">
        · {formatDayHours(today)} today{special ? ' (special)' : ''}
      </span>
    </div>
  );
}

/**
 * Open/Closed line plus a collapsible week list showing THIS week's effective
 * hours (honoring overrides/seasons). Set `showStatus={false}` when the caller
 * already shows the open/closed line elsewhere.
 */
export function VenueHoursCard({
  showStatus = true,
  className = '',
  ...props
}: ScheduleProps & { showStatus?: boolean; className?: string }) {
  const now = useNow();
  if ((!props.hours && !props.hoursOverrides && !props.hoursSeasons) || !props.tz) return null;
  const schedule = toSchedule(props);
  const todayKey = currentWeekday(props.tz, now);

  // Build the current week's dates (Mon..Sun) so per-day rows reflect overrides
  // and seasons, not just the base weekly pattern.
  const parts = ymdIndexInTz(props.tz, now);
  return (
    <details className={`surface-1 rounded-2xl border border-fairway-800/60 ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5">
        {showStatus ? <VenueOpenLine {...props} /> : <span />}
        <span className="text-xs font-semibold text-fairway-400">This week</span>
      </summary>
      <div className="space-y-1 px-4 pb-3 pt-1 text-sm">
        {WEEK_DISPLAY_ORDER.map((day) => {
          const ymd = ymdForWeekday(parts, day);
          const entry = effectiveDayHours(schedule, ymd, WEEKDAY_KEYS.indexOf(day));
          return (
            <div
              key={day}
              className={`flex items-center justify-between ${
                day === todayKey ? 'font-bold text-fairway-50' : 'text-fairway-100/70'
              }`}
            >
              <span>{weekdayLabel(day)}</span>
              <span>{formatDayHours(entry)}</span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

// --- small date helpers for the weekly list (mirror lib/venueHours tz logic) --
function ymdIndexInTz(tz: string, at: Date): { ymd: string; index: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  let weekday = 'mon';
  let year = '1970';
  let month = '01';
  let day = '01';
  for (const p of fmt.formatToParts(at)) {
    if (p.type === 'weekday') weekday = p.value.slice(0, 3).toLowerCase();
    else if (p.type === 'year') year = p.value;
    else if (p.type === 'month') month = p.value;
    else if (p.type === 'day') day = p.value;
  }
  return {
    ymd: `${year}-${month}-${day}`,
    index: WEEKDAY_KEYS.indexOf(weekday as (typeof WEEKDAY_KEYS)[number]),
  };
}

// The YYYY-MM-DD of `day` within the same week (Sun-based) as `parts`.
function ymdForWeekday(parts: { ymd: string; index: number }, day: string): string {
  const target = WEEKDAY_KEYS.indexOf(day as (typeof WEEKDAY_KEYS)[number]);
  const delta = target - parts.index;
  const [y, m, d] = parts.ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
