// FFC mini-golf scorecard API — Express app definition.
// Split from index.js so tests (and any other embedder) can import the app
// without triggering app.listen()/warnIfNoToken() side effects.
import express from "express";
import cors from "cors";
import { execSync } from "node:child_process";
import "dotenv/config";

import { router as roundsRouter } from "./routes/rounds.js";
import { router as leaderboardRouter } from "./routes/leaderboard.js";
import { router as seedRouter } from "./routes/seed.js";
import { router as locationsRouter } from "./routes/locations.js";
import { router as contentRouter } from "./routes/content.js";
import { router as huntRouter } from "./routes/hunt.js";
import { router as photosRouter } from "./routes/photos.js";
import { router as adminRouter } from "./routes/admin/index.js";
import { router as authRouter } from "./routes/auth.js";
import { router as teamsRouter } from "./routes/teams.js";
import { router as gamesRouter } from "./routes/games.js";
import { attachUser } from "./lib/userAuth.js";
import { router as announcementsRouter } from "./routes/announcements.js";
import { router as rewardsRouter } from "./routes/rewards.js";

export const app = express();

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
  const path = req.path.replace(/\/+$/, "");
  if (path === "/api/hunt/verify") return next();
  // Photo-booth uploads (POST /api/photos) carry base64 images too; the
  // router installs its own 16mb parser.
  if (path === "/api/photos") return next();
  // Same deal for the (temporary) admin vision bake-off — base64 photos on
  // both /describe and /prescan; the router carries its own 16mb parser.
  if (path.startsWith("/api/admin/vision-bakeoff/")) return next();
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

// Resolve the player-session cookie (if any) to req.user for every /api route.
// Anonymous requests pass through with req.user = null — nothing public
// changes behavior. Individual routers opt in to requiring a user.
app.use("/api", attachUser);

// Feature routes.
app.use("/api/rounds", roundsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/seed", seedRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/content", contentRouter);
// Player accounts — passwordless email sign-in.
app.use("/api/auth", authRouter);
// Persistent teams (signed-in players only — guarded inside the router).
app.use("/api/teams", teamsRouter);
// Shared multi-device games (create needs sign-in; join/score use the
// per-device participant token; includes the SSE stream).
app.use("/api/games", gamesRouter);
app.use("/api/announcements", announcementsRouter);
app.use("/api/rewards", rewardsRouter);
// Master Control admin surface (token-guarded inside the router).
app.use("/api/admin", adminRouter);
// The hunt's /verify endpoint installs its own larger body parser for base64
// images; the rest of the app keeps the 256kb global cap above.
app.use("/api/hunt", huntRouter);
// Photo booth — player photo sharing + stickers, no AI anywhere in the
// pipeline. Its upload endpoint also carries its own 16mb parser (see above).
app.use("/api/photos", photosRouter);

// 404 fallback for unknown /api routes.
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not found" });
});
