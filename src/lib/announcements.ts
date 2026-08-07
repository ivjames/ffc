import { useEffect, useState } from 'react';
import { apiUrl } from '../sync';

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
