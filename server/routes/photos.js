// Photo booth — player photo sharing + stickers. NO AI in this pipeline.
//
//   GET  /api/photos/retention           -> how long stored photos live (for /privacy)
//   GET  /api/photos?booth=<id>          -> the device's gallery (ids + timestamps)
//   GET  /api/photos/:id/image?booth=    -> one photo's bytes (share/view)
//   POST /api/photos                     -> store a decorated photo
//   POST /api/photos/:id/delete?booth=   -> the player deletes their own photo
//
// Unlike the hunt (routes/hunt.js), nothing here touches a model provider:
// stickers are composited into the JPEG on the phone before upload, and the
// server just writes bytes to disk (PHOTO_BOOTH_DIR) and serves them back.
// That also means there is no auto-moderation pass — the operator review
// surface (routes/admin/boothPhotos.js) and the retention sweep
// (lib/boothPhotoRetention.js) are the whole safety/privacy story, and the
// player-facing disclosure lives at /privacy in the app.
//
// Access control is the hunt's capability-key model: `booth` is an unguessable
// per-device id minted by the client (a UUID in localStorage). Only requests
// carrying it can list, fetch, or delete that gallery; wrong-key and missing
// alike get one generic 404 so existence never leaks. There is no browse-all.
import { Router } from "express";
import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../db.js";
import { makeRateLimit } from "../lib/rateLimit.js";
import {
  ALLOWED_MEDIA_TYPES,
  EXT_BY_MEDIA,
  MEDIA_BY_EXT,
} from "../lib/imageTypes.js";
import { resolveBoothRetentionDays } from "../lib/boothPhotoRetention.js";

export const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Where booth photos live on disk. Kept separate from the hunt's dir so the
// two features' retention/review tooling never cross paths.
const UPLOAD_DIR =
  process.env.PHOTO_BOOTH_DIR || join(process.cwd(), "data", "booth-photos");

// Same ceiling as the hunt: the client downscales + flattens to well under
// 1 MB, but be generous so a fallback-path upload still goes through.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// The booth key is a client-minted UUID; accept anything UUID-shaped or
// longer so a future key format doesn't 400, but refuse short guessable
// strings — the key IS the access control.
function isValidBoothId(booth) {
  return typeof booth === "string" && booth.length >= 16 && booth.length <= 200;
}

// --- Per-booth stored-photo cap ---------------------------------------------
// No model spend here, so no scan caps — but disk isn't free either. One
// device gets at most this many photos stored at a time (429 past it; delete
// or let retention age some out). Resolved per request so tests/ops can
// adjust without a restart. 0 is a kill switch for new uploads.
const DEFAULT_PHOTO_CAP = 100;
function resolvePhotoCap() {
  const raw = process.env.PHOTO_BOOTH_CAP;
  if (raw === undefined || raw === "") return DEFAULT_PHOTO_CAP;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PHOTO_CAP;
}

// --- Global disk budget ------------------------------------------------------
// The per-booth cap alone bounds nothing: boothId is caller-chosen, so a
// hostile client could rotate ids and fill the disk within the IP rate limit.
// This budget counts ACTUAL stored bytes (booth_photo.bytes) across all
// booths — a server-controlled hard ceiling on the feature's disk use, the
// HUNT_SCAN_CAP philosophy applied to storage. Uploads 429 once the budget is
// spent, until retention/deletes free room. Resolved per request; 0 is a kill
// switch for new uploads.
const DEFAULT_DISK_BUDGET_MB = 10 * 1024; // 10 GB
function resolveDiskBudgetBytes() {
  const raw = process.env.PHOTO_BOOTH_DISK_BUDGET_MB;
  const mb =
    raw === undefined || raw === ""
      ? DEFAULT_DISK_BUDGET_MB
      : (() => {
          const n = Number.parseInt(raw, 10);
          return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DISK_BUDGET_MB;
        })();
  return mb * 1024 * 1024;
}

// Uploads are disk writes, not model calls — the cap bounds bytes-per-minute
// per IP, same fixed-window scheme as everywhere else.
const uploadRateLimit = makeRateLimit({
  windowMs: 60_000,
  max: 20,
  name: "photo upload limit",
});

// --- GET /api/photos/retention ----------------------------------------------
// Public: how long stored booth photos live before the sweep deletes them, so
// /privacy discloses the venue's ACTUAL configuration (same contract as
// GET /api/hunt/photo-retention).
router.get("/retention", (_req, res) => {
  res.json({ days: resolveBoothRetentionDays() });
});

// --- GET /api/photos?booth=<id> ---------------------------------------------
// The device's gallery, newest first. Only ids + timestamps — the bytes come
// one at a time from /:id/image so the grid can lazy-load.
router.get("/", async (req, res) => {
  const booth = req.query.booth;
  if (!isValidBoothId(booth)) {
    return res.status(400).json({ ok: false, error: "booth (id) is required" });
  }
  try {
    const result = await pool.query(
      `select id, created_at as "createdAt" from booth_photo
        where booth_id = $1
        order by created_at desc
        limit 200`,
      [booth]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[photos] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- GET /api/photos/:id/image?booth=<id> -----------------------------------
// One photo's bytes. The booth key must match; one generic 404 for wrong-key
// and missing alike so the response never reveals whether an id exists under
// another booth.
router.get("/:id/image", async (req, res) => {
  const { id } = req.params;
  const booth = req.query.booth;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ ok: false, error: "bad photo id" });
  }
  if (!isValidBoothId(booth)) {
    return res.status(400).json({ ok: false, error: "booth (id) is required" });
  }
  try {
    const result = await pool.query(
      `select photo_path as "photoPath" from booth_photo
        where id = $1 and booth_id = $2`,
      [id, booth]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "not found" });
    }
    const photoPath = result.rows[0].photoPath;
    const ext = photoPath.split(".").pop();
    res.set("Content-Type", MEDIA_BY_EXT[ext] ?? "application/octet-stream");
    res.set("Cache-Control", "private, max-age=300");
    return res.sendFile(photoPath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ ok: false, error: "not found" });
      }
    });
  } catch (err) {
    console.error("[photos] image error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- POST /api/photos --------------------------------------------------------
// Body (JSON): { boothId, locationId?, imageBase64, mediaType }
// Uses its own larger body parser — base64 images blow past the global 256kb
// cap (app.js skips this path for the same reason hunt/verify is skipped).
router.post(
  "/",
  uploadRateLimit,
  express.json({ limit: "16mb" }),
  async (req, res) => {
    const body = req.body ?? {};
    const { boothId, locationId, imageBase64, mediaType } = body;

    if (!isValidBoothId(boothId)) {
      return res.status(400).json({ ok: false, error: "boothId is required" });
    }
    if (typeof mediaType !== "string" || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return res
        .status(400)
        .json({ ok: false, error: "mediaType must be a supported image type" });
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
      return res
        .status(400)
        .json({ ok: false, error: "image is empty or exceeds the size limit" });
    }

    try {
      // Global disk budget first: actual bytes stored across ALL booths. This
      // is the real bound — the per-booth cap below is fairness, not safety,
      // since boothId is caller-chosen.
      const budget = resolveDiskBudgetBytes();
      const used = await pool.query(
        `select coalesce(sum(bytes), 0)::bigint as n from booth_photo`
      );
      if (Number(used.rows[0].n) + imageBytes.length > budget) {
        return res.status(429).json({
          ok: false,
          error: "the photo booth is full right now — try again later",
        });
      }

      // Per-booth stored cap: past it, the player deletes (or retention ages
      // photos out) before storing more. 429 so the client words it as a limit.
      const cap = resolvePhotoCap();
      const stored = await pool.query(
        `select count(*)::int as n from booth_photo where booth_id = $1`,
        [boothId]
      );
      if (stored.rows[0].n >= cap) {
        return res.status(429).json({
          ok: false,
          error: "photo limit reached — delete some photos to make room",
        });
      }

      // The venue at upload time scopes the admin review surface. Optional and
      // best-effort: an unknown/archived location never fails the upload, it
      // just stores null (super_admin-only in review, the hunt precedent).
      let venueId = null;
      if (typeof locationId === "string" && UUID_RE.test(locationId)) {
        const loc = await pool.query(
          `select id from location where id = $1 and archived_at is null`,
          [locationId]
        );
        if (loc.rowCount > 0) venueId = loc.rows[0].id;
      }

      await mkdir(UPLOAD_DIR, { recursive: true });
      const ext = EXT_BY_MEDIA[mediaType] || "bin";
      const photoPath = join(UPLOAD_DIR, `${randomUUID()}.${ext}`);
      await writeFile(photoPath, imageBytes);

      let ins;
      try {
        ins = await pool.query(
          `insert into booth_photo (booth_id, location_id, photo_path, media_type, bytes)
           values ($1, $2, $3, $4, $5)
           returning id, created_at as "createdAt"`,
          [boothId, venueId, photoPath, mediaType, imageBytes.length]
        );
      } catch (err) {
        // Don't leave an orphan file behind a failed insert.
        await rm(photoPath, { force: true }).catch(() => {});
        throw err;
      }

      return res.json({ ok: true, ...ins.rows[0] });
    } catch (err) {
      console.error("[photos] upload error:", err);
      return res.status(500).json({ ok: false, error: "internal error" });
    }
  }
);

// --- POST /api/photos/:id/replace?booth=<id> --------------------------------
// Body (JSON): { imageBase64, mediaType }
// Overwrite a photo's bytes IN PLACE — same row, same id, same created_at — so
// re-editing a saved photo (features/photos: the on-device drafts) doesn't
// reorder the gallery the way a delete + re-upload would. The booth key gates
// it like every other route (one generic 404 for wrong-key/missing). Carries
// its own 16mb parser (app.js skips the global cap for this path).
router.post("/:id/replace", uploadRateLimit, express.json({ limit: "16mb" }), async (req, res) => {
  const { id } = req.params;
  const booth = req.query.booth;
  const body = req.body ?? {};
  const { imageBase64, mediaType } = body;

  if (!UUID_RE.test(id)) {
    return res.status(400).json({ ok: false, error: "bad photo id" });
  }
  if (!isValidBoothId(booth)) {
    return res.status(400).json({ ok: false, error: "booth (id) is required" });
  }
  if (typeof mediaType !== "string" || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return res
      .status(400)
      .json({ ok: false, error: "mediaType must be a supported image type" });
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
    return res
      .status(400)
      .json({ ok: false, error: "image is empty or exceeds the size limit" });
  }

  try {
    const existing = await pool.query(
      `select photo_path as "photoPath" from booth_photo
        where id = $1 and booth_id = $2`,
      [id, booth]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "not found" });
    }
    const oldPath = existing.rows[0].photoPath;

    // Disk budget on the DELTA: count every other photo's bytes, since this row
    // is about to be rewritten. A same-or-smaller replace never trips it.
    const budget = resolveDiskBudgetBytes();
    const used = await pool.query(
      `select coalesce(sum(bytes), 0)::bigint as n from booth_photo where id <> $1`,
      [id]
    );
    if (Number(used.rows[0].n) + imageBytes.length > budget) {
      return res.status(429).json({
        ok: false,
        error: "the photo booth is full right now — try again later",
      });
    }

    // Write the new file first, then point the row at it, then remove the old
    // file — so a crash never leaves the row referencing missing bytes.
    await mkdir(UPLOAD_DIR, { recursive: true });
    const ext = EXT_BY_MEDIA[mediaType] || "bin";
    const newPath = join(UPLOAD_DIR, `${randomUUID()}.${ext}`);
    await writeFile(newPath, imageBytes);
    try {
      await pool.query(
        `update booth_photo set photo_path = $1, media_type = $2, bytes = $3
          where id = $4 and booth_id = $5`,
        [newPath, mediaType, imageBytes.length, id, booth]
      );
    } catch (err) {
      await rm(newPath, { force: true }).catch(() => {});
      throw err;
    }
    if (oldPath && oldPath !== newPath) await rm(oldPath, { force: true }).catch(() => {});

    return res.json({ ok: true, id });
  } catch (err) {
    console.error("[photos] replace error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- POST /api/photos/:id/delete?booth=<id> ---------------------------------
// The player removes their own photo — no staff involved, matching "your
// gallery, your call". File first, then row (the retention sweep's rule): if
// the rm throws, the row stays and a retry works.
router.post("/:id/delete", async (req, res) => {
  const { id } = req.params;
  const booth = req.query.booth;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ ok: false, error: "bad photo id" });
  }
  if (!isValidBoothId(booth)) {
    return res.status(400).json({ ok: false, error: "booth (id) is required" });
  }
  try {
    const result = await pool.query(
      `select photo_path as "photoPath" from booth_photo
        where id = $1 and booth_id = $2`,
      [id, booth]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "not found" });
    }
    await rm(result.rows[0].photoPath, { force: true });
    // Unlike hunt_find (gameplay credit outlives its photo), a booth row means
    // nothing without its image — delete it outright.
    await pool.query(
      `delete from booth_photo where id = $1 and booth_id = $2`,
      [id, booth]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[photos] delete error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
