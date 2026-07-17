import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { startSyncWorker } from './sync';
import { registerPwa } from './pwa';
import { initInstallCapture } from './lib/pwaInstall';
import './index.css';

// Register the service worker. autoUpdate reloads the page once when a new
// deploy's SW activates, so the installed PWA never lingers on a stale bundle
// (which showed up as a build/API "mismatch" on the first load after a deploy).
registerPwa();

// Capture the one-shot `beforeinstallprompt` before React renders so the
// /install page's "Install" button can fire the native prompt on demand.
initInstallCapture();

// Kick off the background sync worker as soon as the app boots (§9): drains any
// completed-but-unsynced rounds to the API when a connection is available.
startSyncWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
