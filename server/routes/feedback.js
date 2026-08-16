// Reviewer commentary — the in-app "sound off about this screen" channel.
//
//   POST /api/feedback   -> file a comment, optionally with a screenshot
//
// Who writes here: whoever is walking the app as a reviewer (staff,
// stakeholders, testers). The widget that calls this only renders under
// VITE_DEV_MODE (src/ui/FeedbackButton.tsx), so in a normal player build
// nothing reaches this endpoint — but the endpoint itself is open-write like
// the announcement-view and funnel beacons, since a reviewer has no account
// and we would rather receive the note than gate it behind a login.
//
// Open write means the caps here ARE the safety story:
//   - a fixed-window IP rate limit (the app-wide pattern, lib/rateLimit.js)
//   - hard length limits on every text field, truncating rather than 400ing
//     the fields nobody types by hand (user agent, screen path)
//   - a global disk budget over stored screenshot bytes, so screenshots can
//     never fill the droplet (routes/photos.js's rule, applied here)
//
// No AI touches this pipeline — like the photo booth, the phone downscales the
// screenshot (src/lib/image.ts) and the server just writes bytes to disk. The
// operator surface is routes/admin/feedback.js.
import { Router } from "express";
import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../db.js";
import { makeRateLimit } from "../lib/rateLimit.js";
import { ALLOWED_MEDIA_TYPES, EXT_BY_MEDIA } from "../lib/imageTypes.js";
import { inBudgetReservation, BUDGET_LOCKS } from "../lib/diskBudget.js";
import { tenant, findTenantLocation } from "../lib/tenant.js";

export const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Screenshots live in their own directory, kept apart from the hunt's and the
// booth's so each feature's retention/review tooling stays independent.
const UPLOAD_DIR =
  process.env.FEEDBACK_DIR || join(process.cwd(), "data", "feedback-shots");

// Same ceiling as the booth: the client downscales to well under 1 MB, but be
// generous so a fallback-path upload still lands.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Field limits. The comment is the only one a human types at length; the rest
// are client-stamped context, so those are truncated silently (a reviewer
// losing their note to a 400 because a user-agent string was long would be a
// terrible trade).
const MAX_BODY_CHARS = 4000;
const MAX_REVIEWER_CHARS = 80;
const MAX_SCREEN_PATH_CHARS = 300;
const MAX_USER_AGENT_CHARS = 400;
const MAX_BUILD_CHARS = 60;

// --- Global disk budget ------------------------------------------------------
// Counts ACTUAL stored screenshot bytes across all feedback. A reviewer tool
// should never be the reason the disk fills, so past the budget the comment
// still files — only the screenshot is dropped (see the upload path below).
// 0 is a kill switch for new screenshots; comments keep working.
const DEFAULT_DISK_BUDGET_MB = 1024; // 1 GB
function resolveDiskBudgetBytes() {
  const raw = process.env.FEEDBACK_DISK_BUDGET_MB;
  const mb =
    raw === undefined || raw === ""
      ? DEFAULT_DISK_BUDGET_MB
      : (() => {
          const n = Number.parseInt(raw, 10);
          return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DISK_BUDGET_MB;
        })();
  return mb * 1024 * 1024;
}

// Filing is a disk write plus a row — bound it per IP, same fixed-window
// scheme as everywhere else. Generous enough for a genuine review session
// (a reviewer clicking through screens files a burst of notes).
const fileRateLimit = makeRateLimit({
  windowMs: 60_000,
  max: 20,
  name: "feedback limit",
});

/** Trim a client-stamped string to `max` chars; null for anything unusable. */
function clip(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

// --- POST /api/feedback -------------------------------------------------------
// Body (JSON):
//   { body, screenPath?, reviewer?, deviceId?, locationId?, appBuild?,
//     userAgent?, imageBase64?, mediaType? }
//
// Carries its own larger body parser — a base64 screenshot blows past the
// global 256kb cap (app.js skips this path for the same reason it skips the
// hunt's and booth's uploads).
router.post("/", fileRateLimit, express.json({ limit: "16mb" }), tenant(), async (req, res) => {
  const payload = req.body ?? {};
  const {
    body,
    screenPath,
    reviewer,
    deviceId,
    locationId,
    appBuild,
    userAgent,
    imageBase64,
    mediaType,
  } = payload;

  // The comment is the one required field — a screenshot with no words is not
  // feedback, it's a picture.
  if (typeof body !== "string" || body.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "body (a comment) is required" });
  }
  if (body.length > MAX_BODY_CHARS) {
    return res
      .status(400)
      .json({ ok: false, error: `body must be ${MAX_BODY_CHARS} characters or fewer` });
  }

  // Screenshot is optional, but if one is claimed it must be well-formed —
  // silently storing a broken image would leave the reviewer thinking their
  // evidence went through.
  let imageBytes = null;
  if (imageBase64 !== undefined && imageBase64 !== null && imageBase64 !== "") {
    if (typeof mediaType !== "string" || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return res
        .status(400)
        .json({ ok: false, error: "mediaType must be a supported image type" });
    }
    if (typeof imageBase64 !== "string") {
      return res.status(400).json({ ok: false, error: "imageBase64 must be a string" });
    }
    try {
      imageBytes = Buffer.from(imageBase64, "base64");
    } catch {
      return res.status(400).json({ ok: false, error: "imageBase64 is not valid base64" });
    }
    if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES) {
      return res
        .status(400)
        .json({ ok: false, error: "screenshot is empty or exceeds the size limit" });
    }
  }

  try {
    // The venue selected at filing time scopes the admin surface. Optional and
    // best-effort: an unknown/archived — or foreign-tenant — location never
    // fails the filing, it just stores null (super_admin-only in review — the
    // hunt/booth precedent). The tenant check keeps a guessed id from filing
    // notes into another client's triage queue.
    let venueId = null;
    if (typeof locationId === "string" && UUID_RE.test(locationId)) {
      const loc = await findTenantLocation(locationId, req.tenant);
      if (loc) venueId = loc.id;
    }

    // Disk budget over stored screenshot bytes. Past it the COMMENT still
    // files — losing a reviewer's words because the image quota is spent
    // would be the wrong failure. The response says the shot was dropped.
    //
    // Check and reservation share one serialized transaction (lib/diskBudget.js)
    // — otherwise concurrent uploads all read the same sum(bytes), all find
    // room, and all store. A comment with NO screenshot consumes no budget, so
    // it passes a null lock key and never queues behind someone else's upload:
    // the words never wait on an image quota.
    let screenshotPath = null;
    let storedMediaType = null;
    let storedBytes = null;
    let screenshotDropped = false;

    let ins;
    try {
      ins = await inBudgetReservation(
        pool,
        imageBytes ? BUDGET_LOCKS.feedback : null,
        async (client) => {
          if (imageBytes) {
            const budget = resolveDiskBudgetBytes();
            const used = await client.query(
              `select coalesce(sum(bytes), 0)::bigint as n from reviewer_feedback`
            );
            if (Number(used.rows[0].n) + imageBytes.length > budget) {
              screenshotDropped = true;
            } else {
              await mkdir(UPLOAD_DIR, { recursive: true });
              const ext = EXT_BY_MEDIA[mediaType] || "bin";
              screenshotPath = join(UPLOAD_DIR, `${randomUUID()}.${ext}`);
              await writeFile(screenshotPath, imageBytes);
              storedMediaType = mediaType;
              storedBytes = imageBytes.length;
            }
          }

          return client.query(
            `insert into reviewer_feedback
               (body, screen_path, reviewer, device_id, location_id, app_build,
                user_agent, screenshot_path, media_type, bytes)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             returning id, created_at as "createdAt"`,
            [
              body.trim(),
              clip(screenPath, MAX_SCREEN_PATH_CHARS),
              clip(reviewer, MAX_REVIEWER_CHARS),
              clip(deviceId, 200),
              venueId,
              clip(appBuild, MAX_BUILD_CHARS),
              clip(userAgent, MAX_USER_AGENT_CHARS),
              screenshotPath,
              storedMediaType,
              storedBytes,
            ]
          );
        }
      );
    } catch (err) {
      // Nothing committed, so a file written above is orphaned — and unlike a
      // row, it would still occupy disk while counting toward nothing. Drop it.
      if (screenshotPath) await rm(screenshotPath, { force: true }).catch(() => {});
      throw err;
    }

    return res.status(201).json({
      ok: true,
      id: ins.rows[0].id,
      createdAt: ins.rows[0].createdAt,
      hasScreenshot: screenshotPath !== null,
      // Only present when a screenshot was sent but couldn't be stored, so the
      // client can tell the reviewer their words landed and the image didn't.
      ...(screenshotDropped ? { screenshotDropped: true } : {}),
    });
  } catch (err) {
    console.error("[feedback] file error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
