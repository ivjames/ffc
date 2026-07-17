import { useEffect, useState } from 'react';
import { apiUrl } from '../sync';

// Tiny build indicator so we can confirm which build the browser actually loaded
// (the service worker caches aggressively). Shows the client build baked in at
// build time, plus the API's build from /api/health, and flags a mismatch.
export function BuildStamp() {
  const [apiBuild, setApiBuild] = useState<string | null>(null);

  useEffect(() => {
    void fetch(apiUrl('/api/health'))
      .then((r) => r.json())
      .then((d) => setApiBuild(typeof d?.build === 'string' ? d.build : null))
      .catch(() => {
        /* offline or old API — just show the client build */
      });
  }, []);

  const mismatch = apiBuild != null && apiBuild !== __BUILD_ID__;

  return (
    <div className="text-[10px] text-fairway-100/30">
      build {__BUILD_ID__}
      {apiBuild && <> · api {apiBuild}</>}
      {mismatch && <span className="text-amber-400/70"> (mismatch)</span>}
    </div>
  );
}
