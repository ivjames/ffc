import { useEffect, useState } from 'react';
import {
  currentWeekday,
  formatDayHours,
  isVenueOpen,
  todaysHours,
  weekdayLabel,
  WEEK_DISPLAY_ORDER,
  type VenueHours,
} from '../lib/venueHours';

// "Open now / Closed" status + today's hours, with an optional expandable
// weekly list. Self-gating like the other venue cards (FoodDrinkCard,
// AnnouncementBanner): renders nothing when the venue hasn't been given
// hours/tz yet, so screens can mount it unconditionally.

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
export function VenueOpenLine({
  hours,
  tz,
  className = '',
}: {
  hours?: VenueHours | null;
  tz?: string | null;
  className?: string;
}) {
  const now = useNow();
  if (!hours || !tz) return null;
  const open = isVenueOpen(hours, tz, now);
  const today = todaysHours(hours, tz, now);
  return (
    <div className={`flex items-center gap-1.5 text-xs font-semibold ${className}`}>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${open ? 'bg-fairway-400' : 'bg-red-400'}`}
        aria-hidden="true"
      />
      <span className={open ? 'text-fairway-400' : 'text-red-400'}>
        {open ? 'Open now' : 'Closed'}
      </span>
      <span className="truncate text-fairway-100/60">· {formatDayHours(today)} today</span>
    </div>
  );
}

/**
 * Open/Closed line plus a collapsible full-week hours list. Set
 * `showStatus={false}` when the caller already shows the open/closed line
 * elsewhere (e.g. right above this card) to avoid repeating it.
 */
export function VenueHoursCard({
  hours,
  tz,
  showStatus = true,
  className = '',
}: {
  hours?: VenueHours | null;
  tz?: string | null;
  showStatus?: boolean;
  className?: string;
}) {
  const now = useNow();
  if (!hours || !tz) return null;
  const today = currentWeekday(tz, now);
  return (
    <details className={`surface-1 rounded-2xl border border-fairway-800/60 ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5">
        {showStatus ? <VenueOpenLine hours={hours} tz={tz} /> : <span />}
        <span className="text-xs font-semibold text-fairway-400">Weekly hours</span>
      </summary>
      <div className="space-y-1 px-4 pb-3 pt-1 text-sm">
        {WEEK_DISPLAY_ORDER.map((day) => (
          <div
            key={day}
            className={`flex items-center justify-between ${
              day === today ? 'font-bold text-fairway-50' : 'text-fairway-100/70'
            }`}
          >
            <span>{weekdayLabel(day)}</span>
            <span>{formatDayHours(hours[day])}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
