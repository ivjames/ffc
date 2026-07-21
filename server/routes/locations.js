// Locations API — public venue read + the original token-guarded upsert.
//
//   POST /api/locations  — create or update a venue (guarded by APP_TOKEN)
//   GET  /api/locations  — list live venues (open read, like the leaderboard)
//
// The venue's timezone drives the leaderboard's calendar-day windows
// (routes/leaderboard.js), resolved authoritatively in normalizeLocation()
// (server/lib/validateLocation.js) — never typed by a human. Admin management
// lives under /api/admin/locations; this file keeps the public contract intact.
import { Router } from "express";
import { pool } from "../db.js";
import { requireAppToken } from "../lib/adminAuth.js";
import {
  normalizeLocation,
  withLabel,
  LOCATION_RETURN_COLS,
} from "../lib/validateLocation.js";

export const router = Router();

// --- List (public) ----------------------------------------------------------
// Only live venues — archived ones drop out of the player-facing list.
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `select ${LOCATION_RETURN_COLS} from location
        where archived_at is null
        order by sort_order, name`
    );
    return res.json(result.rows.map(withLabel));
  } catch (err) {
    console.error("[locations] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Create / update (token-guarded) ----------------------------------------
router.post("/", requireAppToken, async (req, res) => {
  const result = normalizeLocation(req.body);
  if (result.error) {
    return res.status(result.status).json({ ok: false, error: result.error });
  }
  const row = result.row;

  try {
    // Upsert on id when supplied (updating a known venue), otherwise on slug
    // (its natural key) so re-posting a venue is idempotent, not a duplicate.
    // org_id uses coalesce so a bare re-post that omits it never nulls an
    // existing assignment.
    let db;
    if (row.id) {
      db = await pool.query(
        `insert into location (id, name, slug, lat, lng, geofence_km, tz, sort_order, org_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set
           name = excluded.name, slug = excluded.slug, lat = excluded.lat,
           lng = excluded.lng, geofence_km = excluded.geofence_km,
           tz = excluded.tz, sort_order = excluded.sort_order,
           org_id = coalesce(excluded.org_id, location.org_id)
         returning ${LOCATION_RETURN_COLS}`,
        [row.id, row.name, row.slug, row.lat, row.lng, row.geofenceKm, row.tz, row.sortOrder, row.orgId]
      );
    } else {
      db = await pool.query(
        `insert into location (name, slug, lat, lng, geofence_km, tz, sort_order, org_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (slug) do update set
           name = excluded.name, lat = excluded.lat, lng = excluded.lng,
           geofence_km = excluded.geofence_km, tz = excluded.tz,
           sort_order = excluded.sort_order,
           org_id = coalesce(excluded.org_id, location.org_id)
         returning ${LOCATION_RETURN_COLS}`,
        [row.name, row.slug, row.lat, row.lng, row.geofenceKm, row.tz, row.sortOrder, row.orgId]
      );
    }
    return res.json({ ok: true, location: withLabel(db.rows[0]) });
  } catch (err) {
    if (err && err.code === "23505") {
      return res
        .status(409)
        .json({ ok: false, error: "slug already in use by another location" });
    }
    console.error("[locations] upsert error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
