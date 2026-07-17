import { useState } from 'react';
import { Button } from './components';
import { useApiBuild } from './useApiBuild';
import { reloadForUpdate } from '../pwa';

// When the client's baked-in build key no longer matches the API's (a deploy
// landed while this app was open on a stale, service-worker-cached bundle), pop
// a blocking modal that reloads the app onto the fresh build.
//
// Suppressed for dev builds (__BUILD_ID__ === 'dev'), where the SW is off and a
// local API's real SHA would otherwise trigger a false alarm on every save.
export function UpdateModal() {
  const apiBuild = useApiBuild();
  const [reloading, setReloading] = useState(false);

  const mismatch =
    __BUILD_ID__ !== 'dev' && apiBuild != null && apiBuild !== __BUILD_ID__;
  if (!mismatch) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-fairway-950/80 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-fairway-700 bg-fairway-900 p-6 text-center shadow-2xl">
        <div className="text-4xl">🔄</div>
        <h2 id="update-modal-title" className="mt-3 text-lg font-bold text-fairway-50">
          A new version is ready
        </h2>
        <p className="mt-2 text-sm text-fairway-100/70">
          This app was updated on the server. Reload to get the latest version.
        </p>
        <div className="mt-5">
          <Button
            onClick={() => {
              setReloading(true);
              void reloadForUpdate();
            }}
            disabled={reloading}
          >
            {reloading ? 'Reloading…' : 'Click here to reload the app'}
          </Button>
        </div>
      </div>
    </div>
  );
}
