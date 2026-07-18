// FFC mini-golf scorecard API — Express app entrypoint.
// Runs under pm2 on the lab980 droplet on a port in the 8060+ range, behind nginx.
import express from "express";
import cors from "cors";
import { execSync } from "node:child_process";
import "dotenv/config";

import { router as roundsRouter } from "./routes/rounds.js";
import { router as leaderboardRouter } from "./routes/leaderboard.js";
import { router as seedRouter } from "./routes/seed.js";
import { router as locationsRouter } from "./routes/locations.js";
import { router as huntRouter } from "./routes/hunt.js";

const app = express();

// Behind nginx — trust the proxy so req.ip reflects the real client for rate limiting.
app.set("trust proxy", 1);

app.use(cors());

// Global JSON parser for normal endpoints — small payloads only. The hunt
// photo-upload endpoint (POST /api/hunt/verify) carries a large base64 image and
// installs its OWN bigger parser inside the hunt router, so skip it here.
// Otherwise this 256kb cap consumes the stream first and 413s the upload before
// the route ever runs (req.path excludes the query string).
const parseJson = express.json({ limit: "256kb" });
app.use((req, res, next) => {
  // Normalize a trailing slash so /api/hunt/verify and /api/hunt/verify/ both
  // match — Express routes both to the upload handler, but a bare `===` check
  // would let the slash form fall through to the 256kb cap and 413 the upload.
  if (req.path.replace(/\/+$/, "") === "/api/hunt/verify") return next();
  return parseJson(req, res, next);
});

// Build stamp — the git SHA this API process is running, resolved once at
// startup. Lets the client compare its bundle build against the live API.
// BUILD_ID env overrides (e.g. if the deploy sets it) and avoids the git call.
const BUILD_ID = (() => {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
})();

// Health check.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, build: BUILD_ID });
});

// Feature routes.
app.use("/api/rounds", roundsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/seed", seedRouter);
app.use("/api/locations", locationsRouter);
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
