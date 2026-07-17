import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { startSyncWorker } from './sync';
import './index.css';

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
