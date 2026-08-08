// FFC mini-golf scorecard API — process entrypoint.
// Runs under pm2 on the lab980 droplet on a port in the 8060+ range, behind nginx.
// The Express app itself lives in app.js (importable without listen side effects).
import { app } from "./app.js";
import { warnIfNoToken } from "./lib/adminAuth.js";
import { warnIfConsoleMailer } from "./lib/mailer.js";
import { startHuntPhotoRetention } from "./lib/photoRetention.js";

const port = process.env.PORT || 8060;
app.listen(port, () => {
  console.log(`[ffc-server] listening on port ${port}`);
  warnIfNoToken();
  warnIfConsoleMailer();
  // Privacy: stored hunt photos are deleted after HUNT_PHOTO_RETENTION_DAYS
  // (default 30) — sweep now and every few hours (lib/photoRetention.js).
  startHuntPhotoRetention();
});
