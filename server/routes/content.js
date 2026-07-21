// GET /api/content — the live player-facing catalog (locations + courses),
// live rows only (archived_at is null). Open read, like the leaderboard: this
// is the same content the app bundles, so nothing here is secret.
//
// The build-time exporter (scripts/export-content.mjs) pulls this to regenerate
// src/data/content.generated.ts, so the DB stays the single source of truth and
// a rebuild publishes changes. Shapes mirror GeneratedLocation/GeneratedCourse.
import { Router } from "express";
import { pool } from "../db.js";

export const router = Router();

router.get("/", async (_req, res) => {
  try {
    const [locations, courses] = await Promise.all([
      pool.query(
        `select id, name, slug, lat, lng, geofence_km as "geofenceKm",
                tz, sort_order as "sortOrder", org_id as "orgId"
           from location
          where archived_at is null
          order by sort_order, name`
      ),
      pool.query(
        `select id, location_id as "locationId", name, theme,
                hole_count as "holeCount", pars, sort_order as "sortOrder"
           from course
          where archived_at is null
          order by sort_order, name`
      ),
    ]);
    return res.json({ locations: locations.rows, courses: courses.rows });
  } catch (err) {
    console.error("[content] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
