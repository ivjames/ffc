import { createApp, STATIC_TOKEN } from './app.js';

const port = Number(process.env.PORT || 8070);
createApp().listen(port, () => {
  console.log(`mock CenterEdge API on http://localhost:${port}/api/v1`);
  console.log(`static dev bearer token: ${STATIC_TOKEN}`);
});
