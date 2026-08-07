// Admin: hunt photo moderation review (people-in-photos punchlist follow-up).
//   GET  /api/admin/photos?filter=&limit=      review queue / browse
//   GET  /api/admin/photos/:id/image           stream the stored image
//   POST /api/admin/photos/:id/approve         operator approve (e.g. legacy rows)
//   POST /api/admin/photos/:id/reject          delete the image file, keep the record
//
// Every photo is auto-moderated at upload (routes/hunt.js + lib/vision.js):
// unsafe shots are never written to disk, safe stored ones arrive here
// 'approved' with people/minors flags. This surface is the human layer on
// top — spot-check what the model approved, clear legacy (pre-moderation)
// rows, and pull anything the model shouldn't have kept. Rejection deletes
// the image FILE (the one place hard-delete is right — we must be able to
// truly remove a photo) while the hunt_find row and its gameplay credit stay.
//
// Org-scoping rides item -> course -> location -> org, like the overview.
import { Router } from "express";
import { rm } from "node:fs/promises";
import { pool } from "../../db.js";
import { audit, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";

export const router = Router();

const PHOTO_COLS = `f.id, f.player_tag as "playerTag", f.round_client_id as "roundClientId",
  f.verified, f.moderation, f.moderation_reason as "moderationReason",
  f.people_present as "peoplePresent", f.minors_present as "minorsPresent",
  (f.photo_path is not null) as "hasPhoto",
  f.created_at as "createdAt",
  i.name as "itemName", c.name as "courseName", l.name as "locationName"`;

const PHOTO_FROM = `from hunt_find f
  join hunt_item i on i.id = f.item_id
  join course c on c.id = i.course_id
  left join location l on l.id = c.location_id`;

// What each queue filter means. "review" is the working queue: legacy stored
// photos nobody has looked at, plus flagged events worth knowing about.
const FILTERS = {
  review: `(f.photo_path is not null and f.moderation is null) or f.moderation = 'flagged'`,
  people: `f.photo_path is not null and f.people_present = true`,
  minors: `f.photo_path is not null and f.minors_present = true`,
  approved: `f.photo_path is not null and f.moderation = 'approved'`,
  flagged: `f.moderation = 'flagged'`,
  rejected: `f.moderation = 'rejected'`,
  all: `f.photo_path is not null or f.moderation in ('flagged', 'rejected')`,
};

// --- List / queue -----------------------------------------------------------
router.get("/", async (req, res) => {
  const filter = typeof req.query.filter === "string" ? req.query.filter : "review";
  if (!(filter in FILTERS)) {
    return res.status(400).json({ ok: false, error: `filter must be one of ${Object.keys(FILTERS).join("|")}` });
  }
  let limit = 100;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return res.status(400).json({ ok: false, error: "limit must be 1..500" });
    }
  }
  const scope = orgScope(req);
  try {
    const result = await pool.query(
      `select ${PHOTO_COLS} ${PHOTO_FROM}
        where (${FILTERS[filter]})
          and ($1::uuid is null or l.org_id = $1)
        order by f.created_at desc
        limit $2`,
      [scope, limit]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[admin/photos] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// Content types for stored extensions (mirrors hunt.js's EXT_BY_MEDIA).
const MEDIA_BY_EXT = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Load one find (with its org and path) or 404/403 via `res`; null on deny. */
async function loadScoped(req, res, id) {
  if (!UUID_RE.test(id)) {
    res.status(400).json({ ok: false, error: "bad id" });
    return null;
  }
  const row = await pool.query(
    `select f.id, f.photo_path as "photoPath", f.moderation, l.org_id as "orgId"
       ${PHOTO_FROM} where f.id = $1`,
    [id]
  );
  if (row.rowCount === 0) {
    res.status(404).json({ ok: false, error: "not found" });
    return null;
  }
  const scope = orgScope(req);
  if (scope && row.rows[0].orgId !== scope) {
    res.status(403).json({ ok: false, error: "forbidden: not your org" });
    return null;
  }
  return row.rows[0];
}

// --- Image ------------------------------------------------------------------
router.get("/:id/image", async (req, res) => {
  try {
    const find = await loadScoped(req, res, req.params.id);
    if (!find) return;
    if (!find.photoPath) return res.status(404).json({ ok: false, error: "no stored photo" });
    const ext = find.photoPath.split(".").pop();
    res.set("Content-Type", MEDIA_BY_EXT[ext] ?? "application/octet-stream");
    res.set("Cache-Control", "private, max-age=300");
    // photo_path is absolute (written by hunt.js under HUNT_UPLOAD_DIR).
    return res.sendFile(find.photoPath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ ok: false, error: "photo file missing" });
      }
    });
  } catch (err) {
    console.error("[admin/photos] image error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Approve / reject -------------------------------------------------------
router.post("/:id/approve", async (req, res) => {
  try {
    const find = await loadScoped(req, res, req.params.id);
    if (!find) return;
    if (!find.photoPath) {
      // Nothing stored to approve — flagged/rejected rows have no image.
      return res.status(400).json({ ok: false, error: "no stored photo to approve" });
    }
    const db = await pool.query(
      `update hunt_find set moderation = 'approved', moderation_reason = null
        where id = $1 returning id`,
      [req.params.id]
    );
    await audit({
      action: "photo.approve",
      entity: "photo",
      entityId: req.params.id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, id: db.rows[0].id, moderation: "approved" });
  } catch (err) {
    console.error("[admin/photos] approve error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.post("/:id/reject", async (req, res) => {
  try {
    const find = await loadScoped(req, res, req.params.id);
    if (!find) return;
    if (!find.photoPath) {
      return res.status(400).json({ ok: false, error: "no stored photo to reject" });
    }
    // Delete the image from disk FIRST — if the file won't go away, don't
    // record that it did. ENOENT is fine (already gone).
    await rm(find.photoPath, { force: true });
    await pool.query(
      `update hunt_find
          set moderation = 'rejected',
              moderation_reason = coalesce(moderation_reason, 'operator rejection'),
              photo_path = null
        where id = $1`,
      [req.params.id]
    );
    await audit({
      action: "photo.reject",
      entity: "photo",
      entityId: req.params.id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, id: req.params.id, moderation: "rejected" });
  } catch (err) {
    console.error("[admin/photos] reject error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
