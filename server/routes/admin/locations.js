// Admin: locations (venues).
//   GET    /api/admin/locations?orgId=&archived=   list (optionally org-scoped)
//   POST   /api/admin/locations                    create/update
//   GET    /api/admin/locations/:id                one location + its courses
//   GET    /api/admin/locations/:id/courses        courses for a location
//   POST   /api/admin/locations/:id/archive        soft-delete
//   POST   /api/admin/locations/:id/unarchive      restore
//
// Org-scoping: an org_admin (orgScope(req) non-null) is confined to their own
// org's locations everywhere below — list/get/create/archive all either force
// or verify org_id === their scope. A super_admin (orgScope null) is
// unrestricted, same as today.
import { Router } from "express";
import { pool } from "../../db.js";
import { audit, orgScope, actorLabel } from "../../lib/adminAuth.js";
import {
  normalizeLocation,
  withLabel,
  UUID_RE,
  LOCATION_RETURN_COLS,
} from "../../lib/validateLocation.js";
import { COURSE_RETURN_COLS } from "../../lib/validateCourse.js";

export const router = Router();

// --- List -------------------------------------------------------------------
router.get("/", async (req, res) => {
  const includeArchived = req.query.archived === "1" || req.query.archived === "true";
  const scope = orgScope(req);
  const orgId = req.query.orgId;
  if (!scope && orgId !== undefined && typeof orgId === "string" && orgId && !UUID_RE.test(orgId)) {
    return res.status(400).json({ ok: false, error: "orgId must be a uuid" });
  }
  // An org_admin's scope always wins over any orgId query param — they never
  // see another org's locations, whatever they ask for.
  const effectiveOrgId = scope || orgId || null;
  try {
    const result = await pool.query(
      `select ${LOCATION_RETURN_COLS} from location
        where ($1::bool or archived_at is null)
          and ($2::uuid is null or org_id = $2)
        order by sort_order, name`,
      [includeArchived, effectiveOrgId]
    );
    return res.json(result.rows.map(withLabel));
  } catch (err) {
    console.error("[admin/locations] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- One location + its courses ---------------------------------------------
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  try {
    const loc = await pool.query(
      `select ${LOCATION_RETURN_COLS} from location where id = $1`,
      [id]
    );
    if (loc.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    const scope = orgScope(req);
    if (scope && loc.rows[0].orgId !== scope) {
      return res.status(403).json({ ok: false, error: "forbidden: not your org" });
    }
    const courses = await pool.query(
      `select ${COURSE_RETURN_COLS} from course
        where location_id = $1 and archived_at is null
        order by sort_order, name`,
      [id]
    );
    return res.json({ location: withLabel(loc.rows[0]), courses: courses.rows });
  } catch (err) {
    console.error("[admin/locations] get error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Courses for a location -------------------------------------------------
router.get("/:id/courses", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  const includeArchived = req.query.archived === "1" || req.query.archived === "true";
  try {
    const scope = orgScope(req);
    if (scope) {
      const loc = await pool.query(`select org_id as "orgId" from location where id = $1`, [id]);
      if (loc.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
      if (loc.rows[0].orgId !== scope) {
        return res.status(403).json({ ok: false, error: "forbidden: not your org" });
      }
    }
    const courses = await pool.query(
      `select ${COURSE_RETURN_COLS} from course
        where location_id = $1 and ($2::bool or archived_at is null)
        order by sort_order, name`,
      [id, includeArchived]
    );
    return res.json(courses.rows);
  } catch (err) {
    console.error("[admin/locations] courses error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Create / update --------------------------------------------------------
router.post("/", async (req, res) => {
  const result = normalizeLocation(req.body);
  if (result.error) return res.status(result.status).json({ ok: false, error: result.error });
  const row = result.row;
  const scope = orgScope(req);
  try {
    if (scope) {
      row.orgId = scope; // org_admin can only ever write into their own org
      if (row.id) {
        const existing = await pool.query(`select org_id as "orgId" from location where id = $1`, [
          row.id,
        ]);
        if (existing.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
        if (existing.rows[0].orgId !== scope) {
          return res.status(403).json({ ok: false, error: "forbidden: not your org" });
        }
      } else {
        // No id — the insert below still upserts ON CONFLICT (slug), so a
        // slug that already belongs to ANOTHER org must be checked too, or an
        // org_admin could take over another org's location (and its courses,
        // via location_id) just by submitting its slug — visible from the
        // public GET /api/locations — with no id.
        const existingBySlug = await pool.query(
          `select org_id as "orgId" from location where slug = $1`,
          [row.slug]
        );
        if (existingBySlug.rowCount > 0 && existingBySlug.rows[0].orgId !== scope) {
          return res.status(403).json({ ok: false, error: "forbidden: not your org" });
        }
      }
    }
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
    await audit({
      action: row.id ? "location.update" : "location.create",
      entity: "location",
      entityId: db.rows[0].id,
      detail: row,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, location: withLabel(db.rows[0]) });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "slug already in use by another location" });
    }
    if (err && err.code === "23503") {
      return res.status(400).json({ ok: false, error: "orgId does not reference an existing org" });
    }
    console.error("[admin/locations] upsert error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Archive / unarchive ----------------------------------------------------
async function setArchived(req, res, archived) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  try {
    const scope = orgScope(req);
    if (scope) {
      const existing = await pool.query(`select org_id as "orgId" from location where id = $1`, [id]);
      if (existing.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
      if (existing.rows[0].orgId !== scope) {
        return res.status(403).json({ ok: false, error: "forbidden: not your org" });
      }
    }
    const db = await pool.query(
      `update location set archived_at = ${archived ? "now()" : "null"} where id = $1
         returning ${LOCATION_RETURN_COLS}`,
      [id]
    );
    if (db.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    await audit({
      action: archived ? "location.archive" : "location.unarchive",
      entity: "location",
      entityId: id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, location: withLabel(db.rows[0]) });
  } catch (err) {
    console.error("[admin/locations] archive error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
}
router.post("/:id/archive", (req, res) => setArchived(req, res, true));
router.post("/:id/unarchive", (req, res) => setArchived(req, res, false));
