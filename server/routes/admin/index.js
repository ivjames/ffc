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
import { router as usersRouter } from "./users.js";
import { router as orgsRouter } from "./orgs.js";
import { router as locationsRouter } from "./locations.js";
import { router as coursesRouter } from "./courses.js";
import { router as overviewRouter } from "./overview.js";
import { router as huntUsageRouter } from "./huntUsage.js";
import { router as huntItemsRouter } from "./huntItems.js";
import { router as photosRouter } from "./photos.js";
import { router as boothPhotosRouter } from "./boothPhotos.js";
import { router as announcementsRouter } from "./announcements.js";
import { router as rewardsRouter } from "./rewards.js";
import { router as exportRouter } from "./export.js";
import {
  router as visionBakeoffRouter,
  publicRouter as visionBakeoffPublicRouter,
} from "./visionBakeoff.js";

export const router = Router();

router.use(authPublicRouter); // POST /login — no auth required
router.use(visionBakeoffPublicRouter); // GET /vision-bakeoff/ui — static page, no secrets; its API calls auth themselves

router.use(requireAdminAuth); // everything below needs APP_TOKEN or a session

router.use(authSessionRouter); // POST /logout, GET /me
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
router.use("/announcements", announcementsRouter);
router.use("/rewards", rewardsRouter);
router.use("/export", exportRouter);
// Vision vetting bench (super_admin only) — sources/labels/verifies zone
// images against the production judge and the selected describe model.
// UI: log in to Master Control, then open /api/admin/vision-bakeoff/ui.
router.use("/vision-bakeoff", visionBakeoffRouter);
