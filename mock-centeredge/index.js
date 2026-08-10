import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp, STATIC_TOKEN } from './app.js';

const port = Number(process.env.PORT || 8070);
// Bind to loopback by default: on the droplet the mock sits behind nginx
// (the /ce proxy), so the raw port must not be reachable from the internet.
// Override with MOCK_HOST=0.0.0.0 only for local cross-device testing.
const host = process.env.MOCK_HOST || '127.0.0.1';

// Persist balances/history so a redeploy (which pm2-restarts this process)
// doesn't wipe every card back to the seed. Default lives in ../data, a stable
// dir OUTSIDE the tracked/rebuilt tree (the same place `ffc backup` writes), so
// it survives `git reset --hard` and release swaps. Override with
// MOCK_STATE_FILE; point it at /dev/null-style nonexistence by unsetting it is
// not supported here (index.js always persists — tests use createApp() directly).
const here = dirname(fileURLToPath(import.meta.url));
const stateFile = process.env.MOCK_STATE_FILE || join(here, '..', 'data', 'centeredge-mock-state.json');

createApp({ stateFile }).listen(port, host, () => {
  console.log(`mock CenterEdge API on http://${host}:${port}/api/v1`);
  console.log(`persisting state to ${stateFile}`);
  console.log(`static dev bearer token: ${STATIC_TOKEN}`);
});
