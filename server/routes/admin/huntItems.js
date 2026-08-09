// Admin: scavenger-hunt items and their vetting image sets (Master Control →
// Hunt). Master Control becomes the source of truth for hunt lists (like it
// already is for locations/courses); schema.sql's seeds remain the one-time
// bootstrap for the original content.
//
//   GET    /api/admin/hunt-items                     all items (live courses),
//          with course/location context + image count + thumbnail id
//   POST   /api/admin/hunt-items                     create an item
//   GET    /api/admin/hunt-items/:id                 one item + its images
//   PATCH  /api/admin/hunt-items/:id                 edit any field (incl. active)
//   DELETE /api/admin/hunt-items/:id                 hard delete — refused (409)
//          when finds reference it; deactivate (PATCH active:false) instead
//   POST   /api/admin/hunt-items/:id/images          upload a vetting image
//   GET    /api/admin/hunt-items/images/:imageId/image   the image bytes
//   DELETE /api/admin/hunt-items/images/:imageId     remove one image
//
// Images are the item's VETTING TEST SET: sample photos of the real prop used
// to tune name/hint/extra_prompt against the judge (vision bench) before an
// item goes live. Admin-only — never shown to players, never attached to
// player verifications. Uploads are people-screened (lib/itemImageScreen.js —
// the CLAUDE.md test-data policy) before anything touches disk, and the
// screen's exact billed token counts + cost ride back on the response so the
// operator sees the burn.
//
// Org-scoping rides item → course → location.org_id (the photos/hunt-usage
// precedent). Deletes here are HARD deletes, unlike archive-style domain
// data: an item with recorded finds is protected by the hunt_find FK (409 →
// deactivate instead), so played history can never be dropped; an unplayed
// item is safe to remove outright.
import { Router } from "express";
import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../../db.js";
import { audit, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";
import { normalizeHuntItem, HUNT_ITEM_RETURN_COLS } from "../../lib/validateHuntItem.js";
import { isScreeningConfigured, screenItemImage } from "../../lib/itemImageScreen.js";
import { ALLOWED_MEDIA_TYPES } from "../../lib/vision.js";

export const router = Router();

// Where vetting images live on disk. Like HUNT_UPLOAD_DIR: default under the
// server dir; point it at a durable volume in production.
const IMAGE_DIR =
  process.env.HUNT_ITEM_IMAGE_DIR || join(process.cwd(), "data", "hunt-item-images");

// Same decoded-size budget as player photo uploads (routes/hunt.js).
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const EXT_BY_MEDIA = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const IMAGE_COLS = `im.id, im.item_id as "itemId", im.media_type as "mediaType",
  im.subject, im.note, im.sort_order as "sortOrder", im.created_at as "createdAt"`;

// HUNT_ITEM_RETURN_COLS, qualified for queries that join course/location
// (unqualified `name`/`slug`/`sort_order` would be ambiguous there).
const ITEM_COLS = `i.id, i.course_id as "courseId", i.slug, i.name, i.hint,
  i.extra_prompt as "extraPrompt", i.sort_order as "sortOrder", i.active, i.countable`;

/** The org_id a course belongs to (via its location), or null. */
async function courseOrgId(courseId) {
  const result = await pool.query(
    `select l.org_id as "orgId" from course c
       left join location l on l.id = c.location_id
      where c.id = $1`,
    [courseId]
  );
  if (result.rowCount === 0) return { exists: false, orgId: null };
  return { exists: true, orgId: result.rows[0].orgId };
}

/**
 * Fetch one item within the caller's org scope.
 * Resolves to { status, item? } — status is the HTTP error to send, or 200.
 */
async function scopedItem(req, itemId) {
  if (!UUID_RE.test(itemId)) return { status: 400 };
  const result = await pool.query(
    `select ${ITEM_COLS}, l.org_id as "orgId"
       from hunt_item i
       join course c on c.id = i.course_id
       left join location l on l.id = c.location_id
      where i.id = $1`,
    [itemId]
  );
  if (result.rowCount === 0) return { status: 404 };
  const scope = orgScope(req);
  if (scope && result.rows[0].orgId !== scope) return { status: 403 };
  return { status: 200, item: result.rows[0] };
}

// --- List -------------------------------------------------------------------
// Every item on a live (un-archived) course, in venue → course → item order —
// the main grid of the Hunt section. `thumbImageId` is the first vetting
// image, for the thumbnail; null renders as a placeholder. `courses` lists
// every live course in the same order — including ones with no items yet, so
// the UI can offer "add the first item" everywhere.
router.get("/", async (req, res) => {
  const scope = orgScope(req);
  try {
    const courses = await pool.query(
      `select c.id, c.name, l.id as "locationId", l.name as "locationName"
         from course c
         left join location l on l.id = c.location_id
        where c.archived_at is null
          and ($1::uuid is null or l.org_id = $1)
        order by l.sort_order asc nulls last, l.name asc nulls last,
                 c.sort_order asc, c.name asc`,
      [scope]
    );
    const result = await pool.query(
      `select i.id, i.course_id as "courseId", i.slug, i.name, i.hint,
              i.extra_prompt as "extraPrompt", i.sort_order as "sortOrder",
              i.active, i.countable,
              c.name as "courseName", l.id as "locationId", l.name as "locationName",
              (select count(*)::int from hunt_item_image im where im.item_id = i.id)
                as "imageCount",
              (select im.id from hunt_item_image im where im.item_id = i.id
                order by im.sort_order asc, im.created_at asc limit 1)
                as "thumbImageId"
         from hunt_item i
         join course c on c.id = i.course_id
         left join location l on l.id = c.location_id
        where c.archived_at is null
          and ($1::uuid is null or l.org_id = $1)
        order by l.sort_order asc nulls last, l.name asc nulls last,
                 c.sort_order asc, c.name asc,
                 i.sort_order asc, i.name asc`,
      [scope]
    );
    return res.json({ courses: courses.rows, items: result.rows });
  } catch (err) {
    console.error("[admin/hunt-items] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Create -----------------------------------------------------------------
router.post("/", async (req, res) => {
  const result = normalizeHuntItem(req.body);
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  const row = result.row;
  try {
    const target = await courseOrgId(row.courseId);
    if (!target.exists) {
      return res.status(400).json({ ok: false, error: "courseId does not reference an existing course" });
    }
    const scope = orgScope(req);
    if (scope && target.orgId !== scope) {
      return res.status(403).json({ ok: false, error: "forbidden: not your org" });
    }
    const db = await pool.query(
      `insert into hunt_item (course_id, slug, name, hint, extra_prompt, sort_order, active, countable)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning ${HUNT_ITEM_RETURN_COLS}`,
      [row.courseId, row.slug, row.name, row.hint, row.extraPrompt, row.sortOrder, row.active, row.countable]
    );
    await audit({
      action: "hunt_item.create",
      entity: "hunt_item",
      entityId: db.rows[0].id,
      detail: row,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, item: db.rows[0] });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "slug is already used on this course" });
    }
    console.error("[admin/hunt-items] create error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Detail (item + its vetting images) -------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const { status, item } = await scopedItem(req, req.params.id);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
    }
    const images = await pool.query(
      `select ${IMAGE_COLS} from hunt_item_image im
        where im.item_id = $1
        order by im.sort_order asc, im.created_at asc`,
      [item.id]
    );
    const ctx = await pool.query(
      `select c.name as "courseName", l.name as "locationName"
         from course c left join location l on l.id = c.location_id
        where c.id = $1`,
      [item.courseId]
    );
    const { orgId, ...rest } = item;
    return res.json({ item: { ...rest, ...ctx.rows[0] }, images: images.rows });
  } catch (err) {
    console.error("[admin/hunt-items] detail error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Patch (partial edit; merge over current row, courses-style) ------------
router.patch("/:id", async (req, res) => {
  try {
    const { status, item } = await scopedItem(req, req.params.id);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
    }
    const merged = { ...item, ...req.body, courseId: item.courseId };
    const result = normalizeHuntItem(merged);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    const row = result.row;
    const db = await pool.query(
      `update hunt_item
          set slug = $2, name = $3, hint = $4, extra_prompt = $5,
              sort_order = $6, active = $7, countable = $8
        where id = $1
        returning ${HUNT_ITEM_RETURN_COLS}`,
      [item.id, row.slug, row.name, row.hint, row.extraPrompt, row.sortOrder, row.active, row.countable]
    );
    await audit({
      action: "hunt_item.update",
      entity: "hunt_item",
      entityId: item.id,
      detail: req.body,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, item: db.rows[0] });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "slug is already used on this course" });
    }
    console.error("[admin/hunt-items] patch error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Delete -----------------------------------------------------------------
// Hard delete for unplayed items only: hunt_find's FK (no ON DELETE) makes
// Postgres the arbiter — an item with recorded finds 409s, preserving played
// history (deactivate instead). Image rows cascade; their files are removed
// after the DB delete succeeds (so a 409 leaves the vetting set intact).
router.delete("/:id", async (req, res) => {
  try {
    const { status, item } = await scopedItem(req, req.params.id);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
    }
    const paths = await pool.query(
      `select image_path as "imagePath" from hunt_item_image where item_id = $1`,
      [item.id]
    );
    await pool.query(`delete from hunt_item where id = $1`, [item.id]);
    for (const { imagePath } of paths.rows) {
      await rm(imagePath, { force: true }).catch(() => {});
    }
    await audit({
      action: "hunt_item.delete",
      entity: "hunt_item",
      entityId: item.id,
      detail: { slug: item.slug, name: item.name, courseId: item.courseId },
      actor: actorLabel(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    if (err && err.code === "23503") {
      return res.status(409).json({
        ok: false,
        error: "item has recorded finds — deactivate it instead of deleting",
      });
    }
    console.error("[admin/hunt-items] delete error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Upload a vetting image -------------------------------------------------
// Body (JSON): { imageBase64, mediaType, note? }. Own 16mb parser like every
// other base64-photo endpoint (app.js's global cap is 256kb).
//
// Flow: validate → people-screen (one billed descriptor call; the CLAUDE.md
// test-data policy) → only then write to disk + insert. A person in frame
// rejects the upload with nothing stored; the response's `scan` object
// carries the screen's exact billed tokens + cost either way.
router.post("/:id/images", express.json({ limit: "16mb" }), async (req, res) => {
  try {
    const { status, item } = await scopedItem(req, req.params.id);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
    }

    const { imageBase64, mediaType } = req.body ?? {};
    if (typeof mediaType !== "string" || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return res.status(400).json({ ok: false, error: "mediaType must be a supported image type" });
    }
    if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
      return res.status(400).json({ ok: false, error: "imageBase64 is required" });
    }
    let imageBytes;
    try {
      imageBytes = Buffer.from(imageBase64, "base64");
    } catch {
      return res.status(400).json({ ok: false, error: "imageBase64 is not valid base64" });
    }
    if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES) {
      return res.status(400).json({ ok: false, error: "image is empty or exceeds the size limit" });
    }
    const note = typeof req.body.note === "string" ? req.body.note.trim().slice(0, 500) || null : null;

    // No screen, no upload: without a configured descriptor the people policy
    // can't be enforced, so refuse rather than store unscreened test data.
    if (!isScreeningConfigured()) {
      return res.status(503).json({
        ok: false,
        error: "image screening is not configured on the server (no vision API key)",
      });
    }
    const scan = await screenItemImage({ imageBase64, mediaType });
    const scanOut = {
      provider: scan.provider,
      inputTokens: scan.inputTokens,
      outputTokens: scan.outputTokens,
      cost: scan.cost,
    };
    if (scan.peoplePresent) {
      return res.status(400).json({
        ok: false,
        error: "people are visible in this image — vetting images must be people-free",
        peoplePresent: true,
        scan: scanOut,
      });
    }

    await mkdir(IMAGE_DIR, { recursive: true });
    const filename = `${randomUUID()}.${EXT_BY_MEDIA[mediaType] || "bin"}`;
    const imagePath = join(IMAGE_DIR, filename);
    await writeFile(imagePath, imageBytes);

    const db = await pool.query(
      `insert into hunt_item_image (item_id, image_path, media_type, subject, note)
         values ($1, $2, $3, $4, $5)
       returning id, item_id as "itemId", media_type as "mediaType", subject, note,
                 sort_order as "sortOrder", created_at as "createdAt"`,
      [item.id, imagePath, mediaType, scan.subject || null, note]
    );
    await audit({
      action: "hunt_item_image.add",
      entity: "hunt_item_image",
      entityId: db.rows[0].id,
      detail: { itemId: item.id, subject: scan.subject, note },
      actor: actorLabel(req),
    });
    return res.json({ ok: true, image: db.rows[0], scan: scanOut });
  } catch (err) {
    console.error("[admin/hunt-items] image upload error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

/** Fetch one image row (with path + org) within the caller's org scope. */
async function scopedImage(req) {
  const { imageId } = req.params;
  if (!UUID_RE.test(imageId)) return { status: 400 };
  const result = await pool.query(
    `select im.id, im.image_path as "imagePath", im.media_type as "mediaType",
            l.org_id as "orgId"
       from hunt_item_image im
       join hunt_item i on i.id = im.item_id
       join course c on c.id = i.course_id
       left join location l on l.id = c.location_id
      where im.id = $1`,
    [imageId]
  );
  if (result.rowCount === 0) return { status: 404 };
  const scope = orgScope(req);
  if (scope && result.rows[0].orgId !== scope) return { status: 403 };
  return { status: 200, image: result.rows[0] };
}

// --- Image bytes ------------------------------------------------------------
router.get("/images/:imageId/image", async (req, res) => {
  try {
    const { status, image } = await scopedImage(req);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
    }
    res.set("Content-Type", image.mediaType);
    res.set("Cache-Control", "private, max-age=300");
    return res.sendFile(image.imagePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ ok: false, error: "not found" });
      }
    });
  } catch (err) {
    console.error("[admin/hunt-items] image error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Remove one image -------------------------------------------------------
router.delete("/images/:imageId", async (req, res) => {
  try {
    const { status, image } = await scopedImage(req);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
    }
    // File first, then DB (the photos.js / retention-sweep rule): if the rm
    // throws, the row stays and the operator can retry.
    await rm(image.imagePath, { force: true });
    await pool.query(`delete from hunt_item_image where id = $1`, [image.id]);
    await audit({
      action: "hunt_item_image.remove",
      entity: "hunt_item_image",
      entityId: image.id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/hunt-items] image remove error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
