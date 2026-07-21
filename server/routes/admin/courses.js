// Admin: courses.
//   POST   /api/admin/courses               create/update (upsert on id if given)
//   PATCH  /api/admin/courses/:id           edit name/theme/pars/holeCount/sortOrder
//   POST   /api/admin/courses/:id/archive   soft-delete
//   POST   /api/admin/courses/:id/unarchive restore
import { Router } from "express";
import { pool } from "../../db.js";
import { audit } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";
import { normalizeCourse, COURSE_RETURN_COLS } from "../../lib/validateCourse.js";

export const router = Router();

// --- Create / update --------------------------------------------------------
router.post("/", async (req, res) => {
  const result = normalizeCourse(req.body);
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  const row = result.row;
  try {
    let db;
    if (row.id) {
      db = await pool.query(
        `insert into course (id, name, theme, hole_count, pars, location_id, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set
           name = excluded.name, theme = excluded.theme,
           hole_count = excluded.hole_count, pars = excluded.pars,
           location_id = excluded.location_id, sort_order = excluded.sort_order
         returning ${COURSE_RETURN_COLS}`,
        [row.id, row.name, row.theme, row.holeCount, row.pars, row.locationId, row.sortOrder]
      );
    } else {
      db = await pool.query(
        `insert into course (name, theme, hole_count, pars, location_id, sort_order)
           values ($1, $2, $3, $4, $5, $6)
         returning ${COURSE_RETURN_COLS}`,
        [row.name, row.theme, row.holeCount, row.pars, row.locationId, row.sortOrder]
      );
    }
    await audit({
      action: row.id ? "course.update" : "course.create",
      entity: "course",
      entityId: db.rows[0].id,
      detail: row,
    });
    return res.json({ ok: true, course: db.rows[0] });
  } catch (err) {
    if (err && err.code === "23503") {
      return res.status(400).json({ ok: false, error: "locationId does not reference an existing location" });
    }
    console.error("[admin/courses] upsert error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Patch (partial edit) ---------------------------------------------------
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  try {
    const existing = await pool.query(
      `select id, name, theme, hole_count as "holeCount", pars,
              location_id as "locationId", sort_order as "sortOrder"
         from course where id = $1`,
      [id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });

    // Merge provided fields over the current row, then validate the whole thing.
    const merged = { ...existing.rows[0], ...req.body, id };
    const result = normalizeCourse(merged);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    const row = result.row;

    const db = await pool.query(
      `update course set name = $2, theme = $3, hole_count = $4, pars = $5,
              location_id = $6, sort_order = $7
        where id = $1
        returning ${COURSE_RETURN_COLS}`,
      [id, row.name, row.theme, row.holeCount, row.pars, row.locationId, row.sortOrder]
    );
    await audit({ action: "course.update", entity: "course", entityId: id, detail: req.body });
    return res.json({ ok: true, course: db.rows[0] });
  } catch (err) {
    if (err && err.code === "23503") {
      return res.status(400).json({ ok: false, error: "locationId does not reference an existing location" });
    }
    console.error("[admin/courses] patch error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Archive / unarchive ----------------------------------------------------
async function setArchived(req, res, archived) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  try {
    const db = await pool.query(
      `update course set archived_at = ${archived ? "now()" : "null"} where id = $1
         returning ${COURSE_RETURN_COLS}`,
      [id]
    );
    if (db.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    await audit({
      action: archived ? "course.archive" : "course.unarchive",
      entity: "course",
      entityId: id,
    });
    return res.json({ ok: true, course: db.rows[0] });
  } catch (err) {
    console.error("[admin/courses] archive error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
}
router.post("/:id/archive", (req, res) => setArchived(req, res, true));
router.post("/:id/unarchive", (req, res) => setArchived(req, res, false));
