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

// An API-build mismatch alone is NOT proof that reloading helps: mid-deploy,
// nginx can briefly serve a client build that disagrees with the API (in
// either direction), and a reload just lands on the same mismatched pair —
// which used to trap open apps in an UpdateModal reload loop for the whole
// deploy window. So before declaring an update ready, confirm against the
// SERVED build (/version.json, emitted next to the bundle and excluded from
// the SW precache, so no-store reads what nginx serves right now):
//
//   served !== running  -> a reload actually fetches a different bundle, and
//   served === api      -> that bundle matches the live API.
//
// Anything else means a deploy is still in flight — stay quiet and re-probe;
// the states converge within seconds once the deploy's cutover completes.
const CONFIRM_MS = 10_000;

export function useUpdateReady(apiBuild: string | null): boolean {
  const [ready, setReady] = useState(false);

  const mismatch =
    __BUILD_ID__ !== 'dev' && apiBuild != null && apiBuild !== __BUILD_ID__;

  useEffect(() => {
    if (!mismatch || ready) return; // ready latches — the modal never flickers
    let cancelled = false;

    const probe = () => {
      void fetch('/version.json', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          const served = typeof d?.build === 'string' ? d.build : null;
          if (served != null && served !== __BUILD_ID__ && served === apiBuild) {
            setReady(true);
          }
        })
        .catch(() => {
          /* offline / mid-deploy hiccup — try again on the next tick */
        });
    };

    probe();
    const id = setInterval(probe, CONFIRM_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [mismatch, apiBuild, ready]);

  return ready;
}
