// Local mock of the CenterEdge Advantage Web Services surface the FEC app
// will integrate with (F&B ordering + player card / ticket loyalty). Zero
// dependencies — plain node:http — so anyone can run it with no install:
//
//   node mock-centeredge/server.js        # or: npm run mock:centeredge
//
// See mock-centeredge/README.md for the endpoint contracts and knobs.
import { createServer } from "node:http";
import {
  checkAuth,
  getMenu,
  createOrder,
  getOrder,
  getPlayer,
  rewardTickets,
  ticketHistory,
  mockReset,
} from "./lib/handlers.js";

const PORT = Number(process.env.MOCK_PORT ?? 8061);
// Simulated network latency (ms). 0 disables; default keeps the frontend
// honest about loading states without slowing tests to a crawl.
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 150);

const MAX_BODY_BYTES = 256 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

export function createMockServer() {
  return createServer(async (req, res) => {
    // CORS: the Vite dev server runs on a different port, so allow everything.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Mock-Scenario");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Unauthenticated utility endpoints.
    if (req.method === "GET" && path === "/api/health") {
      return send(res, 200, { ok: true, mock: "centeredge", version: 1 });
    }
    if (req.method === "POST" && path === "/api/v1/mock/reset") {
      const r = mockReset();
      return send(res, r.status, r.body);
    }

    // Forced-failure hook: any request carrying `X-Mock-Scenario: outage`
    // gets a 503, so the app's retry/error UI can be exercised on demand.
    if (req.headers["x-mock-scenario"] === "outage") {
      return send(res, 503, { error: { code: "service_unavailable", message: "simulated outage" } });
    }

    const auth = checkAuth(req);
    if (!auth.ok) {
      return send(res, 401, { error: { code: "unauthorized", message: auth.error } });
    }

    if (LATENCY_MS > 0) await new Promise((r) => setTimeout(r, LATENCY_MS));

    let body;
    if (req.method === "POST") {
      try {
        const raw = await readBody(req);
        body = raw === "" ? undefined : JSON.parse(raw);
      } catch (e) {
        return send(res, e.status ?? 400, {
          error: { code: "bad_request", message: e.status === 413 ? "body too large" : "invalid JSON" },
        });
      }
    }

    const playerMatch = /^\/api\/v1\/players\/([^/]+)(\/tickets\/(reward|history))?$/.exec(path);

    let result;
    if (req.method === "GET" && path === "/api/v1/menu") {
      result = getMenu();
    } else if (req.method === "POST" && path === "/api/v1/orders") {
      result = createOrder(body);
    } else if (req.method === "GET" && /^\/api\/v1\/orders\/[^/]+$/.test(path)) {
      result = getOrder(path.split("/").pop());
    } else if (req.method === "GET" && playerMatch && !playerMatch[2]) {
      result = getPlayer(decodeURIComponent(playerMatch[1]));
    } else if (req.method === "POST" && playerMatch && playerMatch[3] === "reward") {
      result = rewardTickets(decodeURIComponent(playerMatch[1]), body);
    } else if (req.method === "GET" && playerMatch && playerMatch[3] === "history") {
      result = ticketHistory(decodeURIComponent(playerMatch[1]));
    } else {
      result = { status: 404, body: { error: { code: "not_found", message: `no route for ${req.method} ${path}` } } };
    }

    return send(res, result.status, result.body);
  });
}

// Only listen when run directly — tests import createMockServer() and bind
// an ephemeral port instead.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  createMockServer().listen(PORT, () => {
    console.log(`[mock-centeredge] listening on http://localhost:${PORT}`);
    console.log(`[mock-centeredge] auth: ${process.env.MOCK_API_TOKEN ? "exact token required" : "any bearer token accepted"}`);
    console.log(`[mock-centeredge] latency: ${LATENCY_MS}ms  kitchen cycle: ${process.env.MOCK_KITCHEN_SECONDS ?? 300}s`);
  });
}
