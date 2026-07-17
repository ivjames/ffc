// FFC mini-golf scorecard API — Express app entrypoint.
// Runs under pm2 on the lab980 droplet on a port in the 8060+ range, behind nginx.
import express from "express";
import cors from "cors";
import "dotenv/config";

import { router as roundsRouter } from "./routes/rounds.js";
import { router as leaderboardRouter } from "./routes/leaderboard.js";
import { router as seedRouter } from "./routes/seed.js";
import { router as huntRouter } from "./routes/hunt.js";

const app = express();

// Behind nginx — trust the proxy so req.ip reflects the real client for rate limiting.
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "256kb" }));

// Health check.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Feature routes.
app.use("/api/rounds", roundsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/seed", seedRouter);
// The hunt's /verify endpoint installs its own larger body parser for base64
// images; the rest of the app keeps the 256kb global cap above.
app.use("/api/hunt", huntRouter);

// 404 fallback for unknown /api routes.
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not found" });
});

const port = process.env.PORT || 8060;
app.listen(port, () => {
  console.log(`[ffc-server] listening on port ${port}`);
});
