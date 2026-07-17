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
