import { useEffect, useState } from 'react';
import { apiUrl } from '../sync';
import { getDeviceId } from './deviceId';

// Announcements (punchlist #1) — the app's first LIVE content read. Promos are
// too time-sensitive for the rebuild-to-publish pipeline, so this polls the
// open /api/announcements feed and caches the last good response per location
// in localStorage. Offline-first contract: never block, never error — show the
// cached set (window-filtered) or nothing.

export type Announcement = {
  id: string;
  title: string;
  body: string | null;
  locationId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
};

const CACHE_PREFIX = 'ffc_announcements_';
const POLL_MS = 60_000;

// --- View memory beacon -----------------------------------------------------
// Records which announcements this device actually saw, so Master Control can
// report who's seen what and when. Same offline-first contract as the feed:
// mark-seen ids queue in localStorage and flush on a best-effort basis, so a
// view recorded on the 18th green with no signal isn't lost.
const VIEW_QUEUE_KEY = 'ffc_announcement_view_queue';
// Once per app session we only report a given announcement once, no matter how
// many times the banner rotates back to it — repeats would just re-bump the
// same row. A fresh session (reload) reports again, which is what moves the
// server's last_seen_at forward.
const reportedThisSession = new Set<string>();
let flushingViews = false;

function readViewQueue(): string[] {
  try {
    const raw = localStorage.getItem(VIEW_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeViewQueue(ids: string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(VIEW_QUEUE_KEY);
    else localStorage.setItem(VIEW_QUEUE_KEY, JSON.stringify(ids));
  } catch {
    /* quota / disabled storage — the queue is best-effort */
  }
}

/** Push any queued view ids to the beacon endpoint. Safe to call repeatedly;
 *  a no-op when offline, empty, or already in flight. Sent ids are cleared on
 *  success, so anything queued mid-flush survives to the next flush. */
export async function flushAnnouncementViews(): Promise<void> {
  if (flushingViews || !navigator.onLine) return;
  const ids = readViewQueue();
  if (ids.length === 0) return;
  flushingViews = true;
  try {
    const res = await fetch(apiUrl('/api/announcements/views'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ deviceId: getDeviceId(), ids }),
    });
    if (res.ok) {
      const sent = new Set(ids);
      writeViewQueue(readViewQueue().filter((id) => !sent.has(id)));
    }
  } catch {
    /* offline / server down — leave the queue for the next flush */
  } finally {
    flushingViews = false;
  }
}

/** Mark announcements as seen on this device (fired when the banner displays
 *  them). De-dupes within the session, durably queues, then tries to flush. */
export function markAnnouncementsSeen(ids: string[]): void {
  const fresh = ids.filter((id) => id && !reportedThisSession.has(id));
  if (fresh.length === 0) return;
  fresh.forEach((id) => reportedThisSession.add(id));
  const queued = new Set(readViewQueue());
  fresh.forEach((id) => queued.add(id));
  writeViewQueue([...queued]);
  void flushAnnouncementViews();
}

/** Drop rows whose window has closed/not opened — the server does this too,
 *  but a cached copy can go stale while offline. */
function windowFilter(rows: Announcement[]): Announcement[] {
  const now = Date.now();
  return rows.filter(
    (a) =>
      (!a.startsAt || new Date(a.startsAt).getTime() <= now) &&
      (!a.endsAt || new Date(a.endsAt).getTime() > now),
  );
}

function readCache(key: string): Announcement[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Live announcements for a venue (or the global set when no venue is known),
 *  cached-offline, refreshed every minute while mounted. */
export function useAnnouncements(locationId: string | null): Announcement[] {
  const cacheKey = `${CACHE_PREFIX}${locationId ?? 'all'}`;
  const [rows, setRows] = useState<Announcement[]>(() => windowFilter(readCache(cacheKey)));

  useEffect(() => {
    let alive = true;
    async function load() {
      // Drain any views queued while offline — the poll interval doubles as a
      // "connectivity is back" trigger for the beacon.
      void flushAnnouncementViews();
      try {
        const q = locationId ? `?locationId=${locationId}` : '';
        const res = await fetch(apiUrl(`/api/announcements${q}`));
        if (!res.ok) return; // keep the cache
        const data = (await res.json()) as Announcement[];
        if (!Array.isArray(data)) return;
        try {
          localStorage.setItem(cacheKey, JSON.stringify(data));
        } catch {
          /* quota — cache is best-effort */
        }
        if (alive) setRows(windowFilter(data));
      } catch {
        /* offline — the cached initial state stands */
      }
    }
    setRows(windowFilter(readCache(cacheKey)));
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [cacheKey, locationId]);

  return rows;
}
