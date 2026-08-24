// FFC mini-golf scorecard API — process entrypoint.
// Runs under pm2 on the lab980 droplet on a port in the 8060+ range, behind nginx.
// The Express app itself lives in app.js (importable without listen side effects).
import { app } from "./app.js";
import { warnIfNoToken } from "./lib/adminAuth.js";
import { warnIfConsoleMailer } from "./lib/mailer.js";
import { startHuntPhotoRetention } from "./lib/photoRetention.js";
import { startBoothPhotoRetention } from "./lib/boothPhotoRetention.js";
import { startTriviaAutopilot } from "./routes/triviaLive.js";

const port = process.env.PORT || 8060;
// Bind to loopback by default: on the droplet this API sits behind nginx, so
// the raw port must not be reachable from the internet. Without a host argument
// Express binds every interface, which left :8068 publicly listening and
// relying on the host firewall to close it — a guarantee the process should be
// making itself. Same default and reasoning as mock-centeredge's MOCK_HOST.
// Override with HOST=0.0.0.0 only for local cross-device testing.
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`[ffc-server] listening on ${host}:${port}`);
  warnIfNoToken();
  warnIfConsoleMailer();
  // Privacy: stored hunt photos are deleted after HUNT_PHOTO_RETENTION_DAYS
  // (default 30) — sweep now and every few hours (lib/photoRetention.js).
  startHuntPhotoRetention();
  // Same policy for photo-booth pictures (PHOTO_BOOTH_RETENTION_DAYS,
  // default 30) — lib/boothPhotoRetention.js.
  startBoothPhotoRetention();
  // A live trivia room runs on its own clock: questions close when their time
  // is up and reveals give way to the next question, with or without anybody
  // driving. Started here rather than in the route module because app.js is
  // imported by every integration test, and a timer firing under a suite would
  // advance games out from under its assertions.
  startTriviaAutopilot();
});
