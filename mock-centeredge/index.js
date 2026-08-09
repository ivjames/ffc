import { createApp, STATIC_TOKEN } from './app.js';

const port = Number(process.env.PORT || 8070);
// Bind to loopback by default: on the droplet the mock sits behind nginx
// (the /ce proxy), so the raw port must not be reachable from the internet.
// Override with MOCK_HOST=0.0.0.0 only for local cross-device testing.
const host = process.env.MOCK_HOST || '127.0.0.1';
createApp().listen(port, host, () => {
  console.log(`mock CenterEdge API on http://${host}:${port}/api/v1`);
  console.log(`static dev bearer token: ${STATIC_TOKEN}`);
});
