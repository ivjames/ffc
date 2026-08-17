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
import { router as manifestRouter } from "./routes/manifest.js";
import { router as huntRouter } from "./routes/hunt.js";
import { router as photosRouter } from "./routes/photos.js";
import { router as adminRouter } from "./routes/admin/index.js";
import { router as authRouter } from "./routes/auth.js";
import { router as teamsRouter } from "./routes/teams.js";
import { router as gamesRouter } from "./routes/games.js";
import { attachUser } from "./lib/userAuth.js";
import { BRAND_ASSET_DIR } from "./lib/brandAssets.js";
import { router as announcementsRouter } from "./routes/announcements.js";
import { router as rewardsRouter } from "./routes/rewards.js";
import { router as gameRewardsRouter } from "./routes/gameRewards.js";
import { router as eventsRouter } from "./routes/events.js";
import { router as feedbackRouter } from "./routes/feedback.js";
import { router as launchSignupRouter } from "./routes/launchSignup.js";

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
  // Photo-booth uploads (POST /api/photos) and in-place replaces
  // (POST /api/photos/:id/replace) carry base64 images too; the router
  // installs its own 16mb parser for both.
  if (path === "/api/photos") return next();
  if (/^\/api\/photos\/[^/]+\/replace$/.test(path)) return next();
  // Reviewer commentary (POST /api/feedback) can carry a base64 screenshot;
  // its router installs its own 16mb parser too.
  if (path === "/api/feedback") return next();
  // Venue sticker SVG uploads exceed the 256kb cap; the admin router carries
  // its own parser.
  if (path === "/api/admin/booth-stickers") return next();
  // Org branding asset uploads (base64 logo/icon files) exceed the cap too;
  // the admin orgs router installs its own 3mb parser for this path.
  if (/^\/api\/admin\/orgs\/[^/]+\/branding\/assets$/.test(path)) return next();
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

// Uploaded org branding assets (logos/icons — routes/admin/orgs.js writes
// them). Living under /api/ means the existing nginx /api proxy carries these
// on EVERY tenant subdomain with zero nginx changes. Filenames are content-
// hashed (<kind>-<sha256-12>.<ext>), so cache hard and immutable; a re-upload
// is a new name, never a stale hit. fallthrough:false keeps misses out of the
// API routers below (they'd never match anyway — fail here, precisely).
app.use(
  "/api/brand-assets",
  express.static(BRAND_ASSET_DIR, {
    fallthrough: false,
    immutable: true,
    maxAge: "365d",
    index: false,
    redirect: false,
    dotfiles: "deny",
    setHeaders(res) {
      // Defense in depth for SVG (an XSS vector when navigated directly):
      // serve every asset inert — same posture as the booth-sticker endpoint.
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    },
  }),
  // fallthrough:false surfaces misses/denials as errors — keep the API's JSON
  // error shape instead of Express's default HTML error page.
  (err, _req, res, _next) => {
    const status = err.statusCode || err.status || 404;
    res.status(status).json({ ok: false, error: status === 403 ? "forbidden" : "not found" });
  }
);

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
// Per-tenant PWA manifest — index.html links here instead of a static file.
app.use("/api/manifest.webmanifest", manifestRouter);
// Player accounts — passwordless email sign-in.
app.use("/api/auth", authRouter);
// Persistent teams (signed-in players only — guarded inside the router).
app.use("/api/teams", teamsRouter);
// Shared multi-device games (create needs sign-in; join/score use the
// per-device participant token; includes the SSE stream).
app.use("/api/games", gamesRouter);
app.use("/api/announcements", announcementsRouter);
// First-party funnel analytics beacon (adoption + sign-in). Open write like
// the announcement-view beacon; a signed-in app_user rides along via attachUser.
app.use("/api/events", eventsRouter);
app.use("/api/rewards", rewardsRouter);
// Game ticket awards — the trusted proxy between mini-games and the venue's
// ticket system (validates payouts, enforces caps, then credits the POS).
app.use("/api/game-rewards", gameRewardsRouter);
// Master Control admin surface (token-guarded inside the router).
app.use("/api/admin", adminRouter);
// The hunt's /verify endpoint installs its own larger body parser for base64
// images; the rest of the app keeps the 256kb global cap above.
app.use("/api/hunt", huntRouter);
// Photo booth — player photo sharing + stickers, no AI anywhere in the
// pipeline. Its upload endpoint also carries its own 16mb parser (see above).
app.use("/api/photos", photosRouter);
// Reviewer commentary — the in-app "sound off about this screen" channel. The
// widget that writes here is dev-mode-only in the client; the endpoint carries
// its own 16mb parser for the optional screenshot (see above).
app.use("/api/feedback", feedbackRouter);
// Marketing landing page's launch-signup capture — open write, honeypot + IP cap inside.
app.use("/api/launch-signup", launchSignupRouter);

// 404 fallback for unknown /api routes.
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not found" });
});
