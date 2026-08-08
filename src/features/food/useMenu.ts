import { useEffect, useState } from 'react';
import { useCurrentLocationId } from '../../lib/location';
import { usePos } from '../../lib/pos';
import type { Menu } from '../../lib/pos/types';

// Menu fetch shared by the browse and checkout screens, via the venue's POS
// adapter. Cached per venue for the session — the menu is stable venue data,
// and checkout needs the same pricing the browse screen showed (no second
// spinner, no drift).

const cache = new Map<string, Menu>();

export function useMenu(): { menu: Menu | null; error: string | null; retry: () => void } {
  const locationId = useCurrentLocationId();
  const { ordering } = usePos();
  const [menu, setMenu] = useState<Menu | null>(cache.get(locationId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const cached = cache.get(locationId);
    setMenu(cached ?? null);
    setError(null);
    if (cached || !ordering) return; // no integration → screens redirect anyway
    let cancelled = false;
    void ordering.fetchMenu().then((res) => {
      if (cancelled) return;
      if ('error' in res) setError(res.error);
      else {
        cache.set(locationId, res);
        setMenu(res);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [locationId, ordering, attempt]);

  return { menu, error, retry: () => setAttempt((n) => n + 1) };
}
