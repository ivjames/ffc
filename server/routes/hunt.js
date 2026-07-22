// Phase 3 — AI scavenger hunt API.
//
//   GET  /api/hunt/items                 -> the fixed list of things to find
//   POST /api/hunt/verify                -> submit a photo; vision judges it
//   GET  /api/hunt/progress?round=<id>   -> a group's findings so far
//
// Photos are stored on the droplet disk (HUNT_UPLOAD_DIR) and the vision call is
// proxied server-side (server/lib/vision.js) so the model API key never reaches
// the browser. Moderation of stored photos is deferred (Phase 3.x) — for now
// photos are verified and kept, and nothing is displayed publicly.
import { Router } from "express";
import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../db.js";
import { isValidTag } from "../lib/sanitize.js";
import {
  verifyItemInImage,
  isVisionConfigured,
  ALLOWED_MEDIA_TYPES,
} from "../lib/vision.js";

export const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Where submitted photos live on disk. Default sits under the server dir; set
// HUNT_UPLOAD_DIR in production to point at a durable volume (or DO Spaces mount).
const UPLOAD_DIR =
  process.env.HUNT_UPLOAD_DIR || join(process.cwd(), "data", "hunt-uploads");

// Max decoded image size we'll accept (bytes). The client downscales before
// upload, but be generous so an uncompressed full-res phone photo (fallback
// path, or a stale client bundle) still goes through rather than 413/400.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// TESTING ONLY — remove before production. When HUNT_ALLOW_PHOTO_OF_PHOTO is
// truthy, the anti-cheat photo-of-a-photo check is bypassed, so testers can
// verify landmarks from screenshots or pictures of a screen. Leave this UNSET
// in production so the anti-cheat is active (the default, production-safe path).
// Fail-safe: even if the flag is accidentally left set in a production deploy
// config, force it off here rather than letting the bypass reach a public,
// unauthenticated, family-venue upload endpoint.
const HUNT_ALLOW_PHOTO_OF_PHOTO_RAW = /^(1|true|yes|on)$/i.test(
  process.env.HUNT_ALLOW_PHOTO_OF_PHOTO ?? ""
);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
if (HUNT_ALLOW_PHOTO_OF_PHOTO_RAW && IS_PRODUCTION) {
  console.warn(
    "[hunt] HUNT_ALLOW_PHOTO_OF_PHOTO is set truthy with NODE_ENV=production — " +
      "forcing it OFF. This flag is TEST ONLY and must never be set in a " +
      "production deploy config; remove it from that environment's config."
  );
}
const ALLOW_PHOTO_OF_PHOTO = HUNT_ALLOW_PHOTO_OF_PHOTO_RAW && !IS_PRODUCTION;

const EXT_BY_MEDIA = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// --- Rate limiting ---------------------------------------------------------
// Vision calls cost money, so cap how often a single IP can submit. Same simple
// in-memory fixed-window scheme as routes/rounds.js (fine for one pm2 process).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20; // verify attempts per IP per minute
const ipHits = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  let entry = ipHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    ipHits.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({ ok: false, error: "rate limit exceeded" });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHits) {
    if (now >= entry.resetAt) ipHits.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref?.();

// --- GET /api/hunt/items?course=<uuid> -------------------------------------
// Each course has its own themed list, so the caller must say which course.
router.get("/items", async (req, res) => {
  const course = req.query.course;
  if (typeof course !== "string" || !UUID_RE.test(course)) {
    return res.status(400).json({ ok: false, error: "course (uuid) is required" });
  }
  try {
    const result = await pool.query(
      `select id, slug, name, hint, countable
         from hunt_item
        where active = true and course_id = $1
        order by sort_order asc, name asc`,
      [course]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[hunt] items error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- GET /api/hunt/progress?round=<clientId> -------------------------------
// A group's findings so far. Returns one row per verified find, so the client
// can show which items each player has bagged.
router.get("/progress", async (req, res) => {
  const round = req.query.round;
  if (typeof round !== "string" || round.length === 0 || round.length > 200) {
    return res.status(400).json({ ok: false, error: "round (clientId) is required" });
  }
  try {
    const result = await pool.query(
      `select f.item_id     as "itemId",
              i.slug        as "itemSlug",
              f.player_tag  as "playerTag",
              f.confidence,
              f.flagged,
              f.created_at  as "createdAt"
         from hunt_find f
         join hunt_item i on i.id = f.item_id
        where f.round_client_id = $1
          and f.verified = true
        order by f.created_at asc`,
      [round]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[hunt] progress error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- POST /api/hunt/verify -------------------------------------------------
// Body (JSON): { itemId, playerTag, roundClientId?, imageBase64, mediaType }
// Uses its own larger body parser — base64 images blow past the global 256kb cap.
router.post(
  "/verify",
  rateLimit,
  // Base64 inflates ~33%, so a 10 MB decoded image is ~13.3 MB of JSON. Give
  // headroom above that; keep it aligned with nginx's client_max_body_size.
  express.json({ limit: "16mb" }),
  async (req, res) => {
    if (!isVisionConfigured()) {
      return res
        .status(503)
        .json({ ok: false, error: "vision is not configured on the server" });
    }

    const body = req.body ?? {};
    const { itemId, courseId, playerTag, roundClientId, imageBase64, mediaType } = body;

    // itemId — must look like a uuid; existence checked below.
    if (typeof itemId !== "string" || !UUID_RE.test(itemId)) {
      return res.status(400).json({ ok: false, error: "itemId must be a uuid" });
    }
    // courseId — the round's course. The item must belong to it, so a client
    // can't submit an item from a different course's list against this round.
    if (typeof courseId !== "string" || !UUID_RE.test(courseId)) {
      return res.status(400).json({ ok: false, error: "courseId must be a uuid" });
    }
    // playerTag — same rule as scorecard tags.
    if (!isValidTag(playerTag)) {
      return res.status(400).json({ ok: false, error: "playerTag is invalid" });
    }
    // roundClientId — required. The hunt is a play-time activity: every find is
    // tied to the group's in-progress round, so a submission without one is
    // rejected (a broader park-wide mode would relax this).
    if (
      typeof roundClientId !== "string" ||
      roundClientId.length === 0 ||
      roundClientId.length > 200
    ) {
      return res.status(400).json({ ok: false, error: "roundClientId is required" });
    }
    // mediaType — allowlist.
    if (typeof mediaType !== "string" || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return res
        .status(400)
        .json({ ok: false, error: "mediaType must be a supported image type" });
    }
    // imageBase64 — non-empty, within size budget once decoded.
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
      // Item must exist, be active, and belong to the round's course.
      const itemRes = await pool.query(
        "select id, name, hint, countable from hunt_item where id = $1 and course_id = $2 and active = true",
        [itemId, courseId]
      );
      if (itemRes.rowCount === 0) {
        return res
          .status(400)
          .json({ ok: false, error: "itemId does not exist on this course" });
      }
      const item = itemRes.rows[0];

      // Anti-cheat / anti-farming: for a normal (one-off) item, if this player
      // already has a verified find for it in this round, don't re-credit it (and
      // don't burn a vision call). `countable` items are exempt — finding many is
      // the whole point (e.g. the Western horseshoes), so every shot is judged.
      if (!item.countable) {
        const dup = await pool.query(
          `select id from hunt_find
            where round_client_id = $1 and player_tag = $2 and item_id = $3
              and verified = true
            limit 1`,
          [roundClientId, playerTag, itemId]
        );
        if (dup.rowCount > 0) {
          return res.json({
            ok: true,
            verified: true,
            alreadyFound: true,
            reason: "You've already found this one.",
          });
        }
      }

      // Ask the model.
      const verdict = await verifyItemInImage({
        imageBase64,
        mediaType,
        itemName: item.name,
        itemHint: item.hint,
      });

      // A photo-of-a-photo never counts as a genuine find, regardless of what's
      // depicted — flag it and reject. TESTING: when ALLOW_PHOTO_OF_PHOTO is on
      // we treat it as un-flagged so a screenshot of a landmark still verifies.
      const flagged = ALLOW_PHOTO_OF_PHOTO ? false : verdict.photoOfPhoto;
      const verified = verdict.present && !flagged;

      // Persist the photo, then record the find. We only keep the file for
      // successful, unflagged finds; rejected attempts aren't stored (keeps disk
      // usage and moderation surface down — see the deferred-moderation note).
      let photoPath = null;
      if (verified) {
        await mkdir(UPLOAD_DIR, { recursive: true });
        const ext = EXT_BY_MEDIA[mediaType] || "bin";
        const filename = `${randomUUID()}.${ext}`;
        photoPath = join(UPLOAD_DIR, filename);
        await writeFile(photoPath, imageBytes);
      }

      // ON CONFLICT closes the TOCTOU window above: the dup SELECT and this
      // INSERT aren't atomic, so a concurrent submission (double-tap, retry)
      // could pass the guard too. The partial unique index makes the DB the
      // arbiter — the loser DO-NOTHINGs instead of writing a second credit.
      const ins = await pool.query(
        `insert into hunt_find
           (round_client_id, player_tag, item_id, verified, confidence, reason, flagged, photo_path, countable)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (round_client_id, player_tag, item_id) where verified and not countable
         do nothing
         returning id`,
        [
          roundClientId,
          playerTag,
          itemId,
          verified,
          verdict.confidence,
          verdict.reason,
          flagged,
          photoPath,
          item.countable,
        ]
      );

      // Lost the race: another concurrent submission already recorded this
      // verified find. Only possible for non-countable items (countable finds
      // don't hit the unique index, so they never conflict). Drop the orphan
      // photo we just wrote and report it as already found rather than
      // double-crediting.
      if (verified && ins.rowCount === 0) {
        if (photoPath) await rm(photoPath, { force: true }).catch(() => {});
        return res.json({
          ok: true,
          verified: true,
          alreadyFound: true,
          reason: "You've already found this one.",
        });
      }

      // For countable items, tell the client how many this player has now bagged
      // in this round so the UI can show a running tally.
      let count;
      if (verified && item.countable) {
        const c = await pool.query(
          `select count(*)::int as n from hunt_find
            where round_client_id = $1 and player_tag = $2 and item_id = $3
              and verified = true`,
          [roundClientId, playerTag, itemId]
        );
        count = c.rows[0].n;
      }

      return res.json({
        ok: true,
        verified,
        flagged,
        confidence: verdict.confidence,
        reason: verdict.reason,
        count,
      });
    } catch (err) {
      if (err.code === "VISION_UNCONFIGURED") {
        return res
          .status(503)
          .json({ ok: false, error: "vision is not configured on the server" });
      }
      if (err.code === "VISION_NO_OUTPUT") {
        // Transient: the model returned no verdict. Nothing recorded — let the
        // player retry with a fresh shot instead of failing hard.
        return res.json({
          ok: true,
          verified: false,
          flagged: false,
          reason: "Couldn't read that photo — try another shot.",
        });
      }
      console.error("[hunt] verify error:", err);
      return res.status(500).json({ ok: false, error: "internal error" });
    }
  }
);
