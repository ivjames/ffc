// Admin: photo-booth review surface (Master Control → Booth) — the operator
// side of the AI-free photo pipeline documented in routes/photos.js. Booth
// photos get NO auto-moderation pass (nothing in that pipeline calls a
// model), so this surface carries the whole safety load: every stored photo
// is listable, viewable, and removable here, newest first, so staff can
// eyeball what guests are storing and honor a "please delete that" request
// without psql access. Removal deletes the file AND the row — a booth row
// has no credit or history worth keeping without its image (unlike
// hunt_find) — and is audit-logged.
//
// Time-based deletion is handled separately by the retention sweep
// (lib/boothPhotoRetention.js, PHOTO_BOOTH_RETENTION_DAYS); this surface is
// for human judgment inside the window.
//
//   GET  /api/admin/booth-photos?limit=&before=   stored photos, newest first;
//        `before` (a createdAt from a previous page) keyset-paginates older
//   GET  /api/admin/booth-photos/:id/image        the image bytes
//   POST /api/admin/booth-photos/:id/remove       delete from disk + DB
//
// Org-scoping rides booth_photo.location_id (recorded at upload): an
// org_admin sees only their venues' photos, and a photo with no resolvable
// venue is super_admin-only (the hunt-photos precedent).
import { Router } from "express";
import { rm } from "node:fs/promises";
import { pool } from "../../db.js";
import { audit, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";
import { MEDIA_BY_EXT } from "../../lib/imageTypes.js";

export const router = Router();

const PHOTO_FROM = `from booth_photo p
  left join location l on l.id = p.location_id`;

// --- List -------------------------------------------------------------------
router.get("/", async (req, res) => {
  const scope = orgScope(req);
  let limit = 100;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return res.status(400).json({ ok: false, error: "limit must be 1..500" });
    }
  }
  // Keyset cursor: `before` is the last row's createdAt from the previous
  // page — stable under concurrent removals, unlike an offset.
  let before = null;
  if (req.query.before !== undefined) {
    before = req.query.before;
    if (typeof before !== "string" || Number.isNaN(Date.parse(before))) {
      return res.status(400).json({ ok: false, error: "before must be a timestamp" });
    }
  }
  try {
    const result = await pool.query(
      `select p.id, p.created_at as "createdAt", l.name as "locationName"
        ${PHOTO_FROM}
        where ($1::uuid is null or l.org_id = $1)
          and ($2::timestamptz is null or p.created_at < $2)
        order by p.created_at desc
        limit $3`,
      [scope, before, limit]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[admin/booth-photos] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// Fetch one booth photo's path within the caller's org scope.
// Resolves to { status, photoPath? } — status is the HTTP error to send, or 200.
async function scopedPhotoPath(req) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return { status: 400 };
  const result = await pool.query(
    `select p.photo_path as "photoPath", l.org_id as "orgId" ${PHOTO_FROM} where p.id = $1`,
    [id]
  );
  if (result.rowCount === 0) return { status: 404 };
  const scope = orgScope(req);
  if (scope && result.rows[0].orgId !== scope) return { status: 403 };
  return { status: 200, photoPath: result.rows[0].photoPath };
}

// --- Image ------------------------------------------------------------------
router.get("/:id/image", async (req, res) => {
  try {
    const { status, photoPath } = await scopedPhotoPath(req);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
    }
    const ext = photoPath.split(".").pop();
    res.set("Content-Type", MEDIA_BY_EXT[ext] ?? "application/octet-stream");
    res.set("Cache-Control", "private, max-age=300");
    return res.sendFile(photoPath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ ok: false, error: "not found" });
      }
    });
  } catch (err) {
    console.error("[admin/booth-photos] image error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Remove -----------------------------------------------------------------
router.post("/:id/remove", async (req, res) => {
  try {
    const { status, photoPath } = await scopedPhotoPath(req);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
    }
    // File first, then DB (the retention sweep's rule): if the rm throws, the
    // row stays and the operator can just retry.
    await rm(photoPath, { force: true });
    await pool.query(`delete from booth_photo where id = $1`, [req.params.id]);
    await audit({
      action: "booth_photo.remove",
      entity: "booth_photo",
      entityId: req.params.id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/booth-photos] remove error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
