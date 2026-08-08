// Admin: hunt-photo review surface (Master Control → Photos) — the operator
// side of the photo pipeline documented in routes/hunt.js. Every photo on
// disk is listable, viewable, and REMOVABLE here, so a venue can honor a
// "please delete that photo" request without psql access. Removal deletes
// the file and marks the find `moderation = 'rejected'` (the state schema.sql
// reserved for exactly this surface); the find row itself — who found what,
// when — is kept, so gameplay credit and audit history survive the photo.
//
// Time-based deletion is handled separately by the retention sweep
// (lib/photoRetention.js, HUNT_PHOTO_RETENTION_DAYS); this surface is for
// human judgment inside the window.
//
//   GET  /api/admin/photos?people=1|minors=1&limit=  stored photos, newest first
//   GET  /api/admin/photos/:id/image                 the image bytes
//   POST /api/admin/photos/:id/remove                delete from disk
//
// Org-scoping rides the find → item → course → location chain (the
// hunt-usage precedent): an org_admin sees only their venues' photos, and a
// photo whose venue no longer resolves is super_admin-only.
import { Router } from "express";
import { rm } from "node:fs/promises";
import { pool } from "../../db.js";
import { audit, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";

export const router = Router();

const PHOTO_COLS = `f.id, f.player_tag as "playerTag", f.created_at as "createdAt",
  f.moderation, f.people_present as "peoplePresent", f.minors_present as "minorsPresent",
  i.name as "itemName", c.name as "courseName", l.name as "locationName"`;

const PHOTO_FROM = `from hunt_find f
  join hunt_item i on i.id = f.item_id
  join course c on c.id = i.course_id
  left join location l on l.id = c.location_id`;

const MEDIA_BY_EXT = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

// --- List -------------------------------------------------------------------
router.get("/", async (req, res) => {
  const scope = orgScope(req);
  const people = req.query.people === "1" || req.query.people === "true";
  const minors = req.query.minors === "1" || req.query.minors === "true";
  let limit = 100;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return res.status(400).json({ ok: false, error: "limit must be 1..500" });
    }
  }
  try {
    const result = await pool.query(
      `select ${PHOTO_COLS} ${PHOTO_FROM}
        where f.photo_path is not null
          and ($1::uuid is null or l.org_id = $1)
          and (not $2::boolean or f.people_present = true)
          and (not $3::boolean or f.minors_present = true)
        order by f.created_at desc
        limit $4`,
      [scope, people, minors, limit]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[admin/photos] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// Fetch one find's photo_path within the caller's org scope.
// Resolves to { status, photoPath? } — status is the HTTP error to send, or 200.
async function scopedPhotoPath(req) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return { status: 400 };
  const result = await pool.query(
    `select f.photo_path as "photoPath", l.org_id as "orgId" ${PHOTO_FROM} where f.id = $1`,
    [req.params.id]
  );
  if (result.rowCount === 0 || result.rows[0].photoPath == null) return { status: 404 };
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
    console.error("[admin/photos] image error:", err);
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
    // path stays set and the operator can just retry.
    await rm(photoPath, { force: true });
    await pool.query(
      `update hunt_find set photo_path = null, moderation = 'rejected' where id = $1`,
      [req.params.id]
    );
    await audit({
      action: "hunt_photo.remove",
      entity: "hunt_find",
      entityId: req.params.id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/photos] remove error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
