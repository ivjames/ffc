// Unit tests for the business-hours editor's serialization
// (LocationDetail.tsx's buildHoursPayload/hoursValidationError) — tested
// directly against the pure functions, the same way api.test.ts exercises
// the fetch wrapper's logic without mounting a component.
import { describe, test, expect } from 'vitest';
import { buildHoursPayload, hoursValidationError } from './LocationDetail';
import { HOURS_DAY_KEYS, type HoursDayKey } from './api';

type DayState = { closed: boolean; open: string; close: string };
type HoursState = Record<HoursDayKey, DayState>;

// All 7 days closed by default — the state a fresh "hours enabled" toggle
// starts from, and what hoursToState() produces for a location with no
// stored hours.
function allClosed(): HoursState {
  return Object.fromEntries(
    HOURS_DAY_KEYS.map((k) => [k, { closed: true, open: '', close: '' }])
  ) as HoursState;
}

describe('buildHoursPayload', () => {
  test('disabled always sends null, regardless of day state', () => {
    const state = allClosed();
    state.mon = { closed: false, open: '09:00', close: '21:00' };
    expect(buildHoursPayload(false, state)).toBeNull();
  });

  test('enabled with every day closed sends all 7 days as "closed"', () => {
    expect(buildHoursPayload(true, allClosed())).toEqual({
      mon: 'closed',
      tue: 'closed',
      wed: 'closed',
      thu: 'closed',
      fri: 'closed',
      sat: 'closed',
      sun: 'closed',
    });
  });

  test('a day → hours object for each open day, "closed" for the rest', () => {
    const state = allClosed();
    state.mon = { closed: false, open: '12:00', close: '21:00' };
    state.fri = { closed: false, open: '10:00', close: '24:00' }; // midnight close
    const out = buildHoursPayload(true, state);
    expect(out?.mon).toEqual({ open: '12:00', close: '21:00' });
    expect(out?.fri).toEqual({ open: '10:00', close: '24:00' });
    expect(out?.tue).toBe('closed');
    expect(out?.sun).toBe('closed');
  });
});

describe('hoursValidationError', () => {
  test('disabled never errors', () => {
    const state = allClosed();
    state.mon = { closed: false, open: '', close: '' };
    expect(hoursValidationError(false, state)).toBeNull();
  });

  test('enabled with all days closed is valid', () => {
    expect(hoursValidationError(true, allClosed())).toBeNull();
  });

  test('enabled with a fully-specified open day is valid', () => {
    const state = allClosed();
    state.sat = { closed: false, open: '09:00', close: '17:00' };
    expect(hoursValidationError(true, state)).toBeNull();
  });

  test('enabled with an open day missing a close time errors, naming the day', () => {
    const state = allClosed();
    state.wed = { closed: false, open: '09:00', close: '' };
    expect(hoursValidationError(true, state)).toMatch(/Wed/);
  });

  test('enabled with an open day missing an open time errors', () => {
    const state = allClosed();
    state.sun = { closed: false, open: '', close: '18:00' };
    expect(hoursValidationError(true, state)).toMatch(/Sun/);
  });
});
