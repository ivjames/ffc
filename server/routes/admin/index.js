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

export const router = Router();

router.use(authPublicRouter); // POST /login — no auth required

router.use(requireAdminAuth); // everything below needs APP_TOKEN or a session

router.use(authSessionRouter); // POST /logout, GET /me
router.use("/users", usersRouter);
router.use("/orgs", orgsRouter);
router.use("/locations", locationsRouter);
router.use("/courses", coursesRouter);
router.use("/overview", overviewRouter);
