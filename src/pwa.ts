/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register';

// Service-worker registration for the installable PWA.
//
// The SW is generated with `registerType: 'autoUpdate'` (see vite.config.ts),
// which makes a freshly-deployed SW `skipWaiting()` + `clientsClaim()` and take
// control immediately. That alone is NOT enough: the tab/PWA that is already
// open keeps executing the *stale precached bundle* it booted with, so after a
// deploy the installed app renders the old build while the API is already new —
// which surfaced as the build/API "(mismatch)" flag on the first load after a
// deploy, lingering until the app was fully closed and reopened.
//
// The plain registerSW.js that vite-plugin-pwa auto-injects only *registers*
// the SW; it has no reload step. Registering through the virtual module instead
// wires up autoUpdate's reload-on-activate: when a new SW activates as an update
// (never on first install), the page reloads once and picks up the fresh bundle
// straight away, so client and API stay in sync.
export function registerPwa(): void {
  registerSW({ immediate: true });
}

// Manual "reload to the latest build", used by the update modal when the client
// and API build keys disagree. A plain location.reload() can just re-serve the
// stale precached bundle, so we first fetch the newly-deployed service worker
// and reload only once it takes control (controllerchange). The generated SW
// skips waiting, so a fresh worker activates on its own; we also nudge any
// already-waiting worker, and fall back to a plain reload so the button always
// makes progress (no SW, no update found, or the event never fires).
export async function reloadForUpdate(): Promise<void> {
  const container =
    typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (!container) {
    window.location.reload();
    return;
  }

  let done = false;
  const reloadOnce = () => {
    if (done) return;
    done = true;
    window.location.reload();
  };

  try {
    const reg = await container.getRegistration();
    if (!reg) {
      reloadOnce();
      return;
    }

    // A newly-activated worker means we're now on the fresh build — reload it.
    container.addEventListener('controllerchange', reloadOnce);

    const nudge = (sw: ServiceWorker | null) => {
      if (!sw) return;
      const skip = () => sw.postMessage({ type: 'SKIP_WAITING' });
      if (sw.state === 'installed') skip();
      else sw.addEventListener('statechange', () => {
        if (sw.state === 'installed') skip();
      });
    };

    await reg.update(); // fetch the latest sw.js from the deploy

    if (reg.waiting) nudge(reg.waiting);
    else if (reg.installing) nudge(reg.installing);
    else reloadOnce(); // nothing new to activate — reload the current build

    // Safety net: never leave the user stuck if activation/controllerchange
    // doesn't fire (e.g. this page has no SW controller yet).
    window.setTimeout(reloadOnce, 3000);
  } catch {
    reloadOnce();
  }
}
