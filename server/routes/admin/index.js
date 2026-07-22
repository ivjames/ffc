// Master Control admin API — mounted at /api/admin.
//
// Every route here is token-guarded (requireAppToken, fail-closed if APP_TOKEN
// is unset) and, for mutations, audit-logged. Deletes are ARCHIVES (soft) —
// there is no hard-delete endpoint. Sub-routers: orgs, locations, courses,
// overview.
import { Router } from "express";
import { requireAppToken } from "../../lib/adminAuth.js";
import { router as orgsRouter } from "./orgs.js";
import { router as locationsRouter } from "./locations.js";
import { router as coursesRouter } from "./courses.js";
import { router as overviewRouter } from "./overview.js";

export const router = Router();

// Gate the entire admin surface with one middleware.
router.use(requireAppToken);

router.use("/orgs", orgsRouter);
router.use("/locations", locationsRouter);
router.use("/courses", coursesRouter);
router.use("/overview", overviewRouter);
