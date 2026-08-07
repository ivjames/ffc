// Entry point: `node mock-centeredge/server.js` (or `npm run mock:centeredge`).
import http from "node:http";
import { createMockApi } from "./app.js";

const PORT = Number(process.env.MOCK_PORT) || 4300;
const { handler } = createMockApi();

http.createServer(handler).listen(PORT, () => {
  console.log(`Mock CenterEdge API listening on http://localhost:${PORT}`);
  console.log(`  GET  /api/v1/health`);
  console.log(`  GET  /api/v1/menu`);
  console.log(`  POST /api/v1/orders`);
  console.log(`  GET  /api/v1/orders/:id`);
  console.log(`  GET  /api/v1/players/:id            (seeded: p-1001, p-1002, p-1003)`);
  console.log(`  POST /api/v1/players/:id/tickets/reward`);
  console.log(`  POST /api/v1/_mock/reset`);
  console.log(`Auth: send any "Authorization: Bearer <token>" header ("expired-token" forces a 401).`);
});
