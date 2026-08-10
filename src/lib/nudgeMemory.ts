// Back-off memory for dismissible one-off nudges (the adoption prompts). A
// nudge must never nag: after each dismissal we snooze it, the snooze grows
// each time, and after enough dismissals we stop for good. State lives per
// nudge key in localStorage; the decision logic is pure and unit-tested.

export type NudgeRecord = { dismissCount: number; lastDismissedAt: number };

/** Snooze after the Nth dismissal, in days — then give up. So a nudge is
 *  shown, dismissed, hidden 1 day, shown, dismissed, hidden 7 days, shown,
 *  dismissed, hidden 30 days, shown, dismissed → never again. */
export const SNOOZE_DAYS = [1, 7, 30];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pure decision: should a nudge with this record be shown now? A missing
 *  record means it's never been dismissed (show it); once dismissed more times
 *  than the snooze schedule allows, it's retired for good. */
export function shouldShow(record: NudgeRecord | null, now: number): boolean {
  if (!record || record.dismissCount <= 0) return true;
  const snoozeDays = SNOOZE_DAYS[record.dismissCount - 1];
  if (snoozeDays === undefined) return false; // out of snoozes — retired
  return now - record.lastDismissedAt >= snoozeDays * DAY_MS;
}

// ---- storage ---------------------------------------------------------------

const KEY = (id: string) => `ffc.nudge.${id}`;

export function readNudge(id: string): NudgeRecord | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NudgeRecord>;
    if (typeof parsed?.dismissCount !== 'number' || typeof parsed?.lastDismissedAt !== 'number') {
      return null;
    }
    return { dismissCount: parsed.dismissCount, lastDismissedAt: parsed.lastDismissedAt };
  } catch {
    return null;
  }
}

/** Whether nudge `id` should show right now (storage-backed convenience). */
export function nudgeVisible(id: string, now = Date.now()): boolean {
  return shouldShow(readNudge(id), now);
}

/** Record a dismissal: bump the count and stamp the time, escalating the snooze. */
export function dismissNudge(id: string, now = Date.now()): void {
  const prior = readNudge(id);
  const next: NudgeRecord = {
    dismissCount: (prior?.dismissCount ?? 0) + 1,
    lastDismissedAt: now,
  };
  try {
    localStorage.setItem(KEY(id), JSON.stringify(next));
  } catch {
    /* private mode / storage disabled — back-off just won't persist */
  }
}
