// Admin: venue sticker management (Master Control → Booth stickers). Venue
// staff upload their own SVG decorations per location; players at that venue
// get them in the photo booth's sticker sheet alongside the built-in emoji.
//
// SECURITY: SVG is an XSS vector, so an upload is NOT trusted for being from an
// admin. Every upload is validated by lib/svgSanitize.js (reject scripts,
// event handlers, foreignObject, external refs, DOCTYPE/XXE, size), stored as a
// plain file, and only ever served/rendered as inert image data (the player
// endpoint sets a locked-down CSP; nothing inlines it into the DOM).
//
//   GET  /api/admin/booth-stickers?location=<uuid>   list a venue's stickers
//   GET  /api/admin/booth-stickers/:id/image         preview the SVG
//   POST /api/admin/booth-stickers                   upload { locationId, label?, svg }
//   POST /api/admin/booth-stickers/:id/remove        delete file + row (audited)
//
// Org-scoping rides booth_sticker.location_id → location.org_id, like the
// booth-photo review surface: an org_admin only sees/edits their venues.
import { Router } from "express";
import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../../db.js";
import { audit, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";
import { validateSvgSticker } from "../../lib/svgSanitize.js";

export const router = Router();

const STICKER_DIR =
  process.env.PHOTO_BOOTH_STICKER_DIR || join(process.cwd(), "data", "booth-stickers");

// --- List (for one venue) ---------------------------------------------------
router.get("/", async (req, res) => {
  const location = req.query.location;
  if (typeof location !== "string" || !UUID_RE.test(location)) {
    return res.status(400).json({ ok: false, error: "location (uuid) is required" });
  }
  try {
    const scope = orgScope(req);
    const result = await pool.query(
      `select s.id, s.label, s.width, s.height, s.sort_order as "sortOrder",
              s.active, s.created_at as "createdAt"
         from booth_sticker s
         join location l on l.id = s.location_id
        where s.location_id = $1
          and ($2::uuid is null or l.org_id = $2)
        order by s.sort_order asc, s.created_at asc`,
      [location, scope]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[admin/booth-stickers] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// Resolve one sticker's file path within the caller's org scope.
async function scopedStickerPath(req) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return { status: 400 };
  const result = await pool.query(
    `select s.svg_path as "svgPath", l.org_id as "orgId"
       from booth_sticker s join location l on l.id = s.location_id
      where s.id = $1`,
    [id]
  );
  if (result.rowCount === 0) return { status: 404 };
  const scope = orgScope(req);
  if (scope && result.rows[0].orgId !== scope) return { status: 403 };
  return { status: 200, svgPath: result.rows[0].svgPath };
}

// --- Preview ----------------------------------------------------------------
router.get("/:id/image", async (req, res) => {
  try {
    const { status, svgPath } = await scopedStickerPath(req);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
    }
    res.set("Content-Type", "image/svg+xml");
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "private, max-age=300");
    return res.sendFile(svgPath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ ok: false, error: "not found" });
    });
  } catch (err) {
    console.error("[admin/booth-stickers] image error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Upload -----------------------------------------------------------------
// SVG arrives as a raw string (it's text) — own parser since it can exceed the
// 256kb global cap (app.js skips this path).
router.post("/", express.json({ limit: "2mb" }), async (req, res) => {
  const body = req.body ?? {};
  const { locationId, label, svg } = body;

  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId (uuid) is required" });
  }
  if (typeof svg !== "string" || svg.length === 0) {
    return res.status(400).json({ ok: false, error: "svg is required" });
  }
  if (label !== undefined && (typeof label !== "string" || label.length > 100)) {
    return res.status(400).json({ ok: false, error: "label must be <= 100 chars" });
  }

  // Validate BEFORE anything else — reject a dangerous or malformed SVG.
  const check = validateSvgSticker(Buffer.from(svg, "utf8"));
  if (!check.ok) {
    return res.status(400).json({ ok: false, error: `SVG rejected: ${check.reason}` });
  }

  try {
    // The venue must exist and be in the caller's org scope.
    const scope = orgScope(req);
    const loc = await pool.query(
      `select org_id as "orgId" from location where id = $1 and archived_at is null`,
      [locationId]
    );
    if (loc.rowCount === 0) {
      return res.status(400).json({ ok: false, error: "unknown location" });
    }
    if (scope && loc.rows[0].orgId !== scope) {
      return res.status(403).json({ ok: false, error: "forbidden: not your org" });
    }

    await mkdir(STICKER_DIR, { recursive: true });
    const svgPath = join(STICKER_DIR, `${randomUUID()}.svg`);
    await writeFile(svgPath, check.text, "utf8");

    let ins;
    try {
      // Append after existing stickers for this venue.
      ins = await pool.query(
        `insert into booth_sticker (location_id, svg_path, label, width, height, sort_order)
         values ($1, $2, $3, $4, $5,
                 coalesce((select max(sort_order) + 1 from booth_sticker where location_id = $1), 0))
         returning id, label, width, height, sort_order as "sortOrder", active, created_at as "createdAt"`,
        [locationId, svgPath, label ?? null, check.width, check.height]
      );
    } catch (err) {
      await rm(svgPath, { force: true }).catch(() => {});
      throw err;
    }

    await audit({
      action: "booth_sticker.create",
      entity: "booth_sticker",
      entityId: ins.rows[0].id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, ...ins.rows[0] });
  } catch (err) {
    console.error("[admin/booth-stickers] upload error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Remove -----------------------------------------------------------------
router.post("/:id/remove", async (req, res) => {
  try {
    const { status, svgPath } = await scopedStickerPath(req);
    if (status !== 200) {
      return res.status(status).json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
    }
    await rm(svgPath, { force: true });
    await pool.query(`delete from booth_sticker where id = $1`, [req.params.id]);
    await audit({
      action: "booth_sticker.remove",
      entity: "booth_sticker",
      entityId: req.params.id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/booth-stickers] remove error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
