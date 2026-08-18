// GET /api/synthetic/catalog — discovery feed for the synthetic load/soak bot
// (scripts/course-bot.mjs), gated on the SAME x-synthetic-key the bot uses to
// post rounds.
//
// WHY THIS EXISTS (and isn't just /api/content): the player catalog is
// TENANT-scoped — the org is resolved from the Host header (lib/tenant.js), so
// a request arriving over loopback (`http://127.0.0.1:8068`, which is exactly
// how the Master Control runner launches the bot) carries no org label and
// lands on the DEFAULT-org fallback. Every venue belonging to any OTHER org is
// therefore invisible to the bot, which reports "no live courses at location
// <uuid>" for a venue the admin UI happily listed. The load bot is a PLATFORM
// tool (start/stop is super_admin only), so it needs a platform-wide view.
//
// Scope: live courses at live locations, across every org — plus org-less
// legacy locations. Orgs that are suspended or archived are excluded: their
// venues are dark to players, so the bot must not manufacture traffic on them.
// Shapes mirror /api/content's locations/courses so the bot consumes either
// feed with one code path; the extra org fields are additive.
//
// This endpoint is read-only and exposes no secrets (it's the same content the
// PWA serves publicly, just unfiltered by tenant) — the key gate is there so
// the cross-org venue list isn't an open enumeration of every client on the
// platform.
import { Router } from "express";
import { pool } from "../db.js";
import { syntheticKeyOk } from "../lib/syntheticConfig.js";

export const router = Router();

// 403 (not 404) on both "feature off" and "bad key": the bot uses the
// status code to tell an unauthorised call apart from an API that predates
// this endpoint (404 → fall back to /api/content).
function requireSyntheticKey(req, res, next) {
  const gate = syntheticKeyOk(req.get("x-synthetic-key"), process.env);
  if (!gate.ok) return res.status(403).json({ ok: false, error: gate.error });
  return next();
}

router.get("/catalog", requireSyntheticKey, async (_req, res) => {
  try {
    const [locations, courses] = await Promise.all([
      pool.query(
        `select l.id, l.name, l.slug, l.tz, l.hours,
                l.org_id as "orgId", o.slug as "orgSlug", o.name as "orgName"
           from location l
           left join org o on o.id = l.org_id
          where l.archived_at is null
            and (l.org_id is null or (o.archived_at is null and o.status = 'active'))
          order by o.name nulls first, l.sort_order, l.name`
      ),
      pool.query(
        `select c.id, c.location_id as "locationId", c.name, c.pars
           from course c
           join location l on l.id = c.location_id
           left join org o on o.id = l.org_id
          where c.archived_at is null and l.archived_at is null
            and (l.org_id is null or (o.archived_at is null and o.status = 'active'))
          order by c.sort_order, c.name`
      ),
    ]);
    return res.json({ locations: locations.rows, courses: courses.rows });
  } catch (err) {
    console.error("[synthetic] catalog error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
