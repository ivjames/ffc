// Mock CenterEdge API — Express app definition.
//
// Stands in for the CenterEdge Advantage Web Services surface the FFC app
// will eventually integrate with (F&B ordering + player cards/tickets), so
// frontend and state-management work isn't blocked on the venue owner
// getting real API credentials from CenterEdge support. The endpoint shapes
// are our best guess at the architecture — reconcile them against the real
// docs when the sandbox arrives (see README.md).
//
// createApp() builds a fresh app with its own in-memory store, so test files
// (which run in parallel processes) and any embedder get isolated state.
import express from "express";
import cors from "cors";
import { createStore } from "./lib/store.js";
import { menuRouter } from "./routes/menu.js";
import { ordersRouter } from "./routes/orders.js";
import { playersRouter } from "./routes/players.js";

export function createApp() {
  const app = express();
  const store = createStore();
  app.locals.store = store;

  app.use(cors());
  app.use(express.json({ limit: "256kb" }));

  // Optional simulated latency so the frontend's loading states get exercised:
  // MOCK_LATENCY_MS=800 makes every response take ~800ms.
  app.use((_req, _res, next) => {
    const ms = Number(process.env.MOCK_LATENCY_MS) || 0;
    if (ms > 0) setTimeout(next, ms);
    else next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mock: "centeredge" });
  });

  // Optional bearer auth so the client's auth plumbing can be rehearsed before
  // real tokens exist. Off by default (frictionless dev); set MOCK_API_KEY to
  // require "Authorization: Bearer <key>" on every /api/v1 route.
  app.use("/api/v1", (req, res, next) => {
    const key = process.env.MOCK_API_KEY;
    if (!key) return next();
    if (req.headers.authorization === `Bearer ${key}`) return next();
    return res.status(401).json({ ok: false, error: "missing or invalid bearer token" });
  });

  app.use("/api/v1/menu", menuRouter(store));
  app.use("/api/v1/orders", ordersRouter(store));
  app.use("/api/v1/players", playersRouter(store));

  // Dev convenience: restore seed data (menu, players, orders, reward keys)
  // without restarting the process.
  app.post("/api/v1/_reset", (_req, res) => {
    store.reset();
    res.json({ ok: true, reset: true });
  });

  // 404 fallback for unknown routes.
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: "not found" });
  });

  return app;
}
