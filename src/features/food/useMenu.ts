import { useEffect, useState } from 'react';
import { fetchMenu, type Menu } from '../../lib/centeredgeApi';

// Menu fetch shared by the browse and checkout screens. Cached module-side for
// the session — the menu is stable venue data, and checkout needs it for the
// same pricing the browse screen showed (no second spinner, no drift).

let cached: Menu | null = null;

export function useMenu(): { menu: Menu | null; error: string | null; retry: () => void } {
  const [menu, setMenu] = useState<Menu | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    setError(null);
    void fetchMenu().then((res) => {
      if (cancelled) return;
      if ('error' in res) setError(res.error);
      else {
        cached = res;
        setMenu(res);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { menu, error, retry: () => setAttempt((n) => n + 1) };
}
