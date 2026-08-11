import { describe, it, expect } from 'vitest';
import { isVenueOpen, todaysHours, formatDayHours, type VenueHours } from './venueHours';

// Mirrors server/lib/venueHours.test.js's fixtures where practical. Fixed
// instants (not "now") + a real IANA zone so DST/offset math is exercised for
// real. All instants below fall in PDT (UTC-7) for America/Los_Angeles:
//   2026-08-10T19:00:00Z -> Mon 12:00 PT
//   2026-08-11T05:00:00Z -> Mon 22:00 PT
//   2026-08-11T19:00:00Z -> Tue 12:00 PT
//   2026-08-12T19:00:00Z -> Wed 12:00 PT
//   2026-08-14T08:00:00Z -> Fri 01:00 PT
//   2026-08-14T10:00:00Z -> Fri 03:00 PT
//   2026-08-15T06:00:00Z -> Fri 23:00 PT
//   2026-08-15T08:00:00Z -> Sat 01:00 PT
const TZ = 'America/Los_Angeles';
const MON_NOON = new Date('2026-08-10T19:00:00Z');
const MON_LATE = new Date('2026-08-11T05:00:00Z'); // 22:00, after close
const TUE_NOON = new Date('2026-08-11T19:00:00Z');
const WED_NOON = new Date('2026-08-12T19:00:00Z');
const FRI_1AM = new Date('2026-08-14T08:00:00Z'); // Fri's OWN early morning — belongs to Thu
const FRI_3AM = new Date('2026-08-14T10:00:00Z'); // gap between close and open
const FRI_11PM = new Date('2026-08-15T06:00:00Z'); // overnight wrap, evening (today) side
const SAT_1AM = new Date('2026-08-15T08:00:00Z'); // carryover from Fri's overnight window

const HOURS: VenueHours = {
  mon: { open: '11:00', close: '21:00' },
  tue: 'closed',
  // wed intentionally absent — a missing day means closed.
  fri: { open: '20:00', close: '02:00' }, // overnight
};
// Wrap the weekly map in a schedule (the shape the evaluators take).
const sched = (extra: Record<string, unknown> = {}) => ({ weekly: HOURS, ...extra });

describe('isVenueOpen (base weekly)', () => {
  it('is open within a same-day window', () => {
    expect(isVenueOpen(sched(), TZ, MON_NOON)).toBe(true);
  });

  it('is closed after the same-day window ends', () => {
    expect(isVenueOpen(sched(), TZ, MON_LATE)).toBe(false);
  });

  it('is closed on a day explicitly marked "closed"', () => {
    expect(isVenueOpen(sched(), TZ, TUE_NOON)).toBe(false);
  });

  it('is closed on a day missing from the hours object', () => {
    expect(isVenueOpen(sched(), TZ, WED_NOON)).toBe(false);
  });

  it('is open across an overnight close, evening (today) side', () => {
    expect(isVenueOpen(sched(), TZ, FRI_11PM)).toBe(true);
  });

  it("is open on the previous day's overnight carryover (Sat 01:00 from Fri 20:00–02:00)", () => {
    expect(isVenueOpen(sched(), TZ, SAT_1AM)).toBe(true);
  });

  it("does NOT open a day's own early morning — Fri 01:00 belongs to a Thu window (P1)", () => {
    expect(isVenueOpen(sched(), TZ, FRI_1AM)).toBe(false);
  });

  it('is closed in the gap between an overnight close and the next open', () => {
    expect(isVenueOpen(sched(), TZ, FRI_3AM)).toBe(false);
  });

  it('fails closed when the schedule is unset (null/undefined/empty)', () => {
    expect(isVenueOpen(null, TZ, MON_NOON)).toBe(false);
    expect(isVenueOpen(undefined, TZ, MON_NOON)).toBe(false);
    expect(isVenueOpen({}, TZ, MON_NOON)).toBe(false);
  });

  it('fails closed when tz is missing', () => {
    expect(isVenueOpen(sched(), null, MON_NOON)).toBe(false);
    expect(isVenueOpen(sched(), undefined, MON_NOON)).toBe(false);
  });
});

describe('isVenueOpen (overrides + seasons)', () => {
  it('a per-date override wins over the weekly pattern', () => {
    // MON_NOON is 2026-08-10 (a Monday), normally open 11:00–21:00.
    expect(isVenueOpen(sched({ overrides: { '2026-08-10': 'closed' } }), TZ, MON_NOON)).toBe(false);
    // Override to a late open so noon is now closed.
    expect(
      isVenueOpen(sched({ overrides: { '2026-08-10': { open: '14:00', close: '21:00' } } }), TZ, MON_NOON),
    ).toBe(false);
  });

  it('a season changes the weekly pattern over a date range', () => {
    const s = sched({
      seasons: [{ from: '2026-08-01', to: '2026-08-31', weekly: { ...HOURS, mon: 'closed' } }],
    });
    expect(isVenueOpen(s, TZ, MON_NOON)).toBe(false); // Mon closed by season
    // Outside the season, base weekly applies again (Mon 2026-09-07 noon).
    expect(isVenueOpen(s, TZ, new Date('2026-09-07T19:00:00Z'))).toBe(true);
  });

  it('an override on the PREVIOUS date carries its overnight window past midnight', () => {
    // Override Thu 2026-08-13 to an overnight window; Fri 01:00 then carries over.
    const s = sched({ overrides: { '2026-08-13': { open: '20:00', close: '02:00' } } });
    expect(isVenueOpen(s, TZ, FRI_1AM)).toBe(true);
  });
});

describe('todaysHours', () => {
  it('returns the effective day entry when open', () => {
    expect(todaysHours(sched(), TZ, MON_NOON)).toEqual({ open: '11:00', close: '21:00' });
  });

  it('reflects a per-date override', () => {
    expect(todaysHours(sched({ overrides: { '2026-08-10': 'closed' } }), TZ, MON_NOON)).toBe('closed');
  });

  it('returns "closed" for an explicit closed day', () => {
    expect(todaysHours(sched(), TZ, TUE_NOON)).toBe('closed');
  });

  it('returns "closed" (not null) for a day missing from the hours object', () => {
    expect(todaysHours(sched(), TZ, WED_NOON)).toBe('closed');
  });

  it('returns null (unknown) when the schedule is wholly unset', () => {
    expect(todaysHours(null, TZ, MON_NOON)).toBeNull();
    expect(todaysHours(undefined, TZ, MON_NOON)).toBeNull();
  });

  it('returns null (unknown) when tz is missing', () => {
    expect(todaysHours(sched(), null, MON_NOON)).toBeNull();
  });
});

describe('formatDayHours', () => {
  it('formats an open window in 12h time', () => {
    expect(formatDayHours({ open: '11:00', close: '21:00' })).toBe('11:00 AM – 9:00 PM');
  });

  it('formats midnight close as 12:00 AM', () => {
    expect(formatDayHours({ open: '20:00', close: '24:00' })).toBe('8:00 PM – 12:00 AM');
  });

  it('formats "closed" and null/undefined as Closed', () => {
    expect(formatDayHours('closed')).toBe('Closed');
    expect(formatDayHours(null)).toBe('Closed');
    expect(formatDayHours(undefined)).toBe('Closed');
  });
});
