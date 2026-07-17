import { useEffect, useState } from 'react';
import { apiUrl } from '../sync';

// Single source of truth for the API build key the client compares itself
// against. The service worker caches aggressively, so after a deploy an open
// app can keep running the old precached bundle while the API is already new —
// the client's baked-in __BUILD_ID__ and the API's /api/health `build` disagree.
//
// We poll periodically and re-check on focus / tab-visibility so a deploy that
// lands while the app is open is noticed without the user manually refreshing.
const POLL_MS = 60_000;

export function useApiBuild(): string | null {
  const [apiBuild, setApiBuild] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = () => {
      // no-store so a stale HTTP cache can't mask a fresh deploy.
      void fetch(apiUrl('/api/health'), { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled) {
            setApiBuild(typeof d?.build === 'string' ? d.build : null);
          }
        })
        .catch(() => {
          /* offline or old API — keep the last known value */
        });
    };

    check();
    const id = setInterval(check, POLL_MS);
    const onWake = () => {
      if (document.visibilityState !== 'hidden') check();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, []);

  return apiBuild;
}
