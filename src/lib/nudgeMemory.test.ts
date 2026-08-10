import { describe, it, expect } from 'vitest';
import { shouldShow, SNOOZE_DAYS, type NudgeRecord } from './nudgeMemory';

// Pure back-off logic only — the localStorage-backed store is exercised
// through the UI (node env here, no DOM).

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-08-09T12:00:00Z');

describe('shouldShow', () => {
  it('shows a never-dismissed nudge', () => {
    expect(shouldShow(null, T0)).toBe(true);
    expect(shouldShow({ dismissCount: 0, lastDismissedAt: 0 }, T0)).toBe(true);
  });

  it('snoozes for the scheduled window after a dismissal, then shows again', () => {
    const rec: NudgeRecord = { dismissCount: 1, lastDismissedAt: T0 };
    expect(shouldShow(rec, T0 + 0.5 * SNOOZE_DAYS[0] * DAY)).toBe(false); // mid-snooze
    expect(shouldShow(rec, T0 + SNOOZE_DAYS[0] * DAY)).toBe(true); // snooze elapsed
  });

  it('escalates the snooze with each dismissal', () => {
    const second: NudgeRecord = { dismissCount: 2, lastDismissedAt: T0 };
    // Still snoozed at the first window's length (the second window is longer).
    expect(shouldShow(second, T0 + SNOOZE_DAYS[0] * DAY)).toBe(false);
    expect(shouldShow(second, T0 + SNOOZE_DAYS[1] * DAY)).toBe(true);
  });

  it('retires the nudge for good once dismissals exceed the schedule', () => {
    const retired: NudgeRecord = { dismissCount: SNOOZE_DAYS.length + 1, lastDismissedAt: T0 };
    expect(shouldShow(retired, T0 + 10 * 365 * DAY)).toBe(false);
  });
});
