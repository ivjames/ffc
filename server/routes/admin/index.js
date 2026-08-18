// Master Control admin API — mounted at /api/admin.
//
// Auth: POST /login is reachable pre-auth (that's the point). Everything else
// requires requireAdminAuth — a valid APP_TOKEN header OR a logged-in
// admin_user session (either one sets req.adminUser; see lib/adminAuth.js).
// org_admin routes are further scoped to their own org_id inside each
// sub-router (orgs/locations/courses/overview); /users is super_admin only.
// Mutations are audit-logged. Deletes are ARCHIVES (soft) for domain data —
// admin_user itself is the one hard-delete (no history hangs off an account).
import { Router } from "express";
import { requireAdminAuth } from "../../lib/adminAuth.js";
import { publicRouter as authPublicRouter, sessionRouter as authSessionRouter } from "./auth.js";
import { publicRouter as passwordPublicRouter } from "./passwordReset.js";
import { router as usersRouter } from "./users.js";
import { router as orgsRouter } from "./orgs.js";
import { router as locationsRouter } from "./locations.js";
import { router as coursesRouter } from "./courses.js";
import { router as overviewRouter } from "./overview.js";
import { router as huntUsageRouter } from "./huntUsage.js";
import { router as huntItemsRouter } from "./huntItems.js";
import { router as photosRouter } from "./photos.js";
import { router as boothPhotosRouter } from "./boothPhotos.js";
import { router as boothStickersRouter } from "./boothStickers.js";
import { router as announcementsRouter } from "./announcements.js";
import { router as feedbackRouter } from "./feedback.js";
import { router as rewardsRouter } from "./rewards.js";
import { router as gameRewardsAdminRouter } from "./gameRewards.js";
import { router as exportRouter } from "./export.js";
import { router as launchSignupsRouter } from "./launchSignups.js";
import { router as provisionRouter } from "./provision.js";
import { router as syntheticBotRouter } from "./syntheticBot.js";
import { router as mailRouter } from "./mail.js";
import { router as triviaQuestionsRouter } from "./triviaQuestions.js";
import {
  router as visionBakeoffRouter,
  publicRouter as visionBakeoffPublicRouter,
} from "./visionBakeoff.js";
import { router as ttsBakeoffRouter } from "./ttsBakeoff.js";

export const router = Router();

router.use(authPublicRouter); // POST /login — no auth required
router.use(passwordPublicRouter); // POST /password/{forgot,token-check,set} — pre-auth by design (emailed set-password links)
router.use(visionBakeoffPublicRouter); // GET /vision-bakeoff/ui — static page, no secrets; its API calls auth themselves

router.use(requireAdminAuth); // everything below needs APP_TOKEN or a session

router.use(authSessionRouter); // POST /logout, GET /me
// Outbound-email diagnostics (super_admin only, guarded inside the router).
router.use("/mail", mailRouter);
// Live-trivia question bank (org-scoped inside the router; the platform pack
// is read-only to org admins).
router.use("/trivia", triviaQuestionsRouter);
router.use("/users", usersRouter);
router.use("/orgs", orgsRouter);
router.use("/locations", locationsRouter);
router.use("/courses", coursesRouter);
router.use("/overview", overviewRouter);
router.use("/hunt-usage", huntUsageRouter);
router.use("/hunt-items", huntItemsRouter);
router.use("/photos", photosRouter);
// Photo-booth review — the only moderation the AI-free booth pipeline has.
router.use("/booth-photos", boothPhotosRouter);
// Per-venue SVG sticker management for the photo booth.
router.use("/booth-stickers", boothStickersRouter);
router.use("/announcements", announcementsRouter);
// Reviewer commentary review + triage (player side: routes/feedback.js).
router.use("/feedback", feedbackRouter);
router.use("/rewards", rewardsRouter);
// Game ticket economy — caps metadata + app-issued ticket rollup.
router.use("/game-rewards", gameRewardsAdminRouter);
router.use("/export", exportRouter);
// Landing-page launch signups (super_admin only) — list + CSV export.
router.use("/launch-signups", launchSignupsRouter);
// One-shot site provisioning (super_admin only) — org + location + courses
// (+ optional org_admin) created atomically; see provision.js.
router.use("/provision", provisionRouter);
// Synthetic load/soak bot control plane (super_admin drives start/stop) — a
// fixed script spawned with validated args; the key stays server-side.
router.use("/synthetic-bot", syntheticBotRouter);
// Vision vetting bench (super_admin only) — sources/labels/verifies zone
// images against the production judge and the selected describe model.
// UI: log in to Master Control, then open /api/admin/vision-bakeoff/ui.
router.use("/vision-bakeoff", visionBakeoffRouter);
// Polly voice bench for live trivia — super_admin only, since /run spends on
// the AWS key in the server's environment.
router.use("/tts-bakeoff", ttsBakeoffRouter);
