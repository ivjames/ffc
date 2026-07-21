// POST /api/seed — dev/CLI helper to load/upsert courses in bulk.
//
// Body: an array of course seeds:
//   { id?: uuid, locationId?: uuid, name: string, theme: string,
//     holeCount?: number, pars: int[18], sortOrder?: number }
// locationId, when given, must reference an existing location(id).
//
// Guard: header `x-app-token` must match APP_TOKEN (unset -> dev, allow). This
// is the same guard the admin surface uses; per-course admin management lives at
// POST/PATCH /api/admin/courses. Validation is shared (lib/validateCourse.js).
import { Router } from "express";
import { pool } from "../db.js";
import { requireAppToken } from "../lib/adminAuth.js";
import { normalizeCourse } from "../lib/validateCourse.js";

export const router = Router();

router.post("/", requireAppToken, async (req, res) => {
  const seeds = req.body;
  if (!Array.isArray(seeds) || seeds.length === 0) {
    return res.status(400).json({ ok: false, error: "body must be a non-empty array of course seeds" });
  }

  const rows = [];
  for (let i = 0; i < seeds.length; i++) {
    const result = normalizeCourse(seeds[i], i);
    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    rows.push(result.row);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = [];
    for (const row of rows) {
      if (row.id) {
        // Explicit id -> upsert on primary key so re-seeding is idempotent.
        const r = await client.query(
          `insert into course (id, name, theme, hole_count, pars, location_id, sort_order)
             values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (id) do update
             set name = excluded.name,
                 theme = excluded.theme,
                 hole_count = excluded.hole_count,
                 pars = excluded.pars,
                 location_id = excluded.location_id,
                 sort_order = excluded.sort_order
           returning id`,
          [row.id, row.name, row.theme, row.holeCount, row.pars, row.locationId, row.sortOrder]
        );
        ids.push(r.rows[0].id);
      } else {
        // No id -> plain insert (course has no natural key to conflict on).
        const r = await client.query(
          `insert into course (name, theme, hole_count, pars, location_id, sort_order)
             values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [row.name, row.theme, row.holeCount, row.pars, row.locationId, row.sortOrder]
        );
        ids.push(r.rows[0].id);
      }
    }
    await client.query("COMMIT");
    return res.json({ ok: true, count: ids.length, ids });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[seed] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});
