// Phase 3 — AI scavenger hunt API.
//
//   GET  /api/hunt/items                 -> the fixed list of things to find
//   POST /api/hunt/verify                -> submit a photo; vision judges it
//   GET  /api/hunt/progress?round=<id>   -> a group's findings so far
//   GET  /api/hunt/photo/:findId?round=  -> a group's own verified photo (share)
//
// TWO MODES, one pipeline. A hunt list hangs off either a course or a venue
// (hunt_item's exactly-one-owner constraint), and that ownership is the only
// real difference between them:
//
//   COURSE hunt (the original) — `?course=` / `courseId`. A themed list played
//     during a mini-golf round, walked hole to hole. The group key is the
//     device round's clientId.
//   VENUE hunt (course-free)   — `?location=` / `locationId`. A park-wide list
//     for venues with no mini golf, or a second list alongside one. There's no
//     round to hang off, so the group key is a venue-hunt session id the
//     client generates the same way. Opt-in per venue via
//     location.hunt.venueMode (lib/validateLocation.js normalizeHunt).
//
// Everything downstream of item lookup — judging, moderation, dedupe, storage,
// the spend caps, metering — is mode-blind and shared. `roundClientId` is the
// GROUP KEY in both modes (a round's clientId on course hunts, a session id in
// venue mode): opaque, client-generated, never a FK, so hunt_find/hunt_scan and
// the progress/photo reads needed no mode awareness at all.
//
// Photos are stored on the droplet disk (HUNT_UPLOAD_DIR) and the vision call is
// proxied server-side (server/lib/vision.js) so the model API key never reaches
// the browser. Every photo is AUTO-MODERATED in the same vision call that
// verifies the find: unsafe content (family-venue standard) is never written to
// disk and never credited; safe photos are stored with their moderation verdict
// (people/minors flags included) and reviewable/removable in Master Control
// (routes/admin/photos.js). People in photos are welcome — only unsafe content
// blocks. Stored photos are NOT kept forever: the retention sweep
// (lib/photoRetention.js, HUNT_PHOTO_RETENTION_DAYS, default 30 days) deletes
// the file and clears photo_path; the find row (credit/history) survives.
// The player-facing disclosure for all of this lives at /privacy in the app.
//
// Cost controls: every model call is metered into hunt_scan (exact token counts
// from the API's usage object, for monthly per-course cost rollups; the row is
// inserted as a RESERVATION before the model call so the caps below can't be
// raced during its latency — see the reservation lifecycle at reserveScan,
// which also stamps org_id, the write-time invoice attribution). On top of
// the per-IP rate limit below (bounds burn *rate*), each round has a total scan
// budget (HUNT_SCAN_CAP, default 60) and each player gets HUNT_ATTEMPT_CAP
// (default 3) judged shots per non-countable item — together they bound total
// spend per round to a hard number. Per TENANT, location.hunt.dailyScanCap
// (see resolveVenueDailyCap below) bounds a venue's total daily spend — the
// per-client control the env-global knobs can't provide.
import { Router } from "express";
import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../db.js";
import { isValidTag } from "../lib/sanitize.js";
import { resolveAllowPhotoOfPhoto } from "../lib/huntAntiCheat.js";
import {
  verifyItemInImage,
  isVisionConfigured,
  ALLOWED_MEDIA_TYPES,
} from "../lib/vision.js";
import { resolvePhotoRetentionDays } from "../lib/photoRetention.js";
import { tenant, tenantOrgFilter, tenantParams } from "../lib/tenant.js";

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

// --- Per-round scan budget --------------------------------------------------
// The per-IP rate limit below bounds *rate*, not *total*: one device pinning
// 20/min for an hour is ~1,200 model calls. This cap bounds total vision spend
// per round (the billing unit), so cost per round is a hard number, not an
// estimate. Counted from hunt_scan (every model call, verdict or not); dedup
// short-circuits don't call the model, so they don't count. Resolved per
// request so tests (and ops) can adjust without a restart. 0 is a kill switch.
//
// Default sizing: with the per-item attempt cap below at 3, the legitimate
// maximum for a full group is 4 players × 20 items (the max hunt list) × 3
// attempts = 240 scans (~$0.50 full-burn on Haiku 4.5) — so 240 never blocks
// honest play; the attempt cap is the working spend control and this is the
// backstop that also bounds countable-item (horseshoe) grinding.
const DEFAULT_SCAN_CAP = 240;
function resolveScanCap() {
  const raw = process.env.HUNT_SCAN_CAP;
  if (raw === undefined || raw === "") return DEFAULT_SCAN_CAP;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SCAN_CAP;
}

// --- Per-item attempt cap ----------------------------------------------------
// Max judged shots a player gets at one (non-countable) item per round. Counted
// from hunt_scan rows that carry a verdict (`verified is not null`) — a
// VISION_NO_OUTPUT retry ("couldn't read that photo") doesn't burn an attempt,
// and a successful find dedupes before this check anyway, so in practice this
// bounds *failed* attempts. Countable items are exempt (every shot is the
// point); the round budget above still bounds them.
const DEFAULT_ATTEMPT_CAP = 3;
function resolveAttemptCap() {
  const raw = process.env.HUNT_ATTEMPT_CAP;
  if (raw === undefined || raw === "") return DEFAULT_ATTEMPT_CAP;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_ATTEMPT_CAP;
}

// --- Per-venue daily scan cap -------------------------------------------------
// The two caps above are env-global: one knob for every tenant, and setting
// HUNT_SCAN_CAP=0 kills the hunt platform-wide. This cap is the per-client
// spend control: location.hunt.dailyScanCap (jsonb, validated in
// lib/validateLocation.js normalizeHunt, set through the location upsert)
// bounds a single venue's billed vision calls over a rolling 24h window.
//   0       -> the hunt is disabled at this venue (per-client kill switch)
//   absent  -> unlimited (pre-config behavior; the env-global caps still apply)
// Read defensively: validation guarantees the shape on write, but rows edited
// by hand must degrade to "unlimited", never to a crash or an accidental 0.
function resolveVenueDailyCap(huntConfig) {
  const cap = huntConfig?.dailyScanCap;
  return Number.isInteger(cap) && cap >= 0 ? cap : null;
}

// --- Scan reservation lifecycle ----------------------------------------------
// A hunt_scan verify row is born as a RESERVATION and settles into a metering
// record. Checking the caps first and metering after the model call — the old
// shape — was a check-then-bill race: N concurrent requests at cap-1 all
// passed the count during the (seconds-long) model call and all billed.
//
//   1. reserveScan — one SHORT transaction takes a per-venue advisory lock,
//      re-runs every spend-cap count, and if there's room INSERTs the row up
//      front with null model/token/verdict fields, then commits. From that
//      moment the reservation occupies a budget slot (the cap counts are
//      plain count(*), so billed and in-flight rows count alike — a
//      reservation IS an imminent billed call). The lock is never held
//      across the model call.
//   2. finalizeScan — the provider call happened (billed), so the reservation
//      becomes the permanent metering record: model/tokens/verdict stamped.
//   3. releaseScan — the provider call failed before billing; the spend never
//      happened, so the reservation is deleted and the slot freed.
//
// A process crash between 1 and 2/3 orphans the reservation. Accepted: the
// phantom row ages out of the venue's rolling 24h window on its own (and
// costs its round one slot of a 240 budget). The hunt-usage rollup ignores
// un-finalized reservations — no tokens, nothing billed to report.
//
// Advisory-lock idiom mirrors lib/diskBudget.js (transaction-scoped, so it
// auto-releases on commit/rollback — even if the process dies mid-request);
// hashtext folds the venue uuid into the integer key space.
async function reserveScan({
  lockId,
  roundClientId,
  playerTag,
  itemId,
  courseId,
  orgId,
  countable,
  locationId,
  venueCap,
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [lockId]);

    // Per-round scan budget: once the round has burned its cap of model
    // calls, stop spending. 429 (not 200) so the client surfaces it as a
    // limit rather than a failed find. count(*) — reservations included.
    const scanCap = resolveScanCap();
    const spent = await client.query(
      `select count(*)::int as n from hunt_scan where round_client_id = $1`,
      [roundClientId]
    );
    if (spent.rows[0].n >= scanCap) {
      await client.query("rollback");
      return { rejected: { status: 429, error: "scan limit reached for this round" } };
    }

    // Per-venue daily budget: bound the venue's billed calls over a rolling
    // 24h window, across ALL of its courses and rounds. Same counting
    // semantics as the round budget above — every billed-or-in-flight verify
    // row counts. kind='verify' only: admin item-image screens ('screen'
    // rows) are operator spend, not player spend, and must not eat the
    // venue's gameplay budget. Distinct error string so the client (and ops)
    // can tell it from the per-round 429.
    if (venueCap !== null && locationId) {
      // Count by the WRITE-TIME location stamp, not a live course join: a
      // course moved between venues mid-window would otherwise drag its
      // scans' budget along with it (draining the destination's cap and
      // refunding the source's).
      const venueSpent = await client.query(
        `select count(*)::int as n
           from hunt_scan s
          where s.location_id = $1
            and s.kind = 'verify'
            and s.created_at > now() - interval '24 hours'`,
        [locationId]
      );
      if (venueSpent.rows[0].n >= venueCap) {
        await client.query("rollback");
        return { rejected: { status: 429, error: "daily scan limit reached for this venue" } };
      }
    }

    // Per-item attempt cap: after N judged misses on one item, stop paying
    // for more shots at it. Countable items are exempt. `verified is not
    // null` — a reservation (or no-output retry) doesn't burn an attempt.
    if (!countable) {
      const attemptCap = resolveAttemptCap();
      const attempts = await client.query(
        `select count(*)::int as n from hunt_scan
          where round_client_id = $1 and player_tag = $2 and item_id = $3
            and verified is not null`,
        [roundClientId, playerTag, itemId]
      );
      if (attempts.rows[0].n >= attemptCap) {
        await client.query("rollback");
        return { rejected: { status: 429, error: "attempt limit reached for this item" } };
      }
    }

    // Room confirmed under the lock — consume it. org_id is the INVOICE
    // stamp and location_id the VENUE-CAP stamp: both fixed at bill time, so
    // a later course/venue move can't re-bill this row to another client or
    // shift it between venues' rolling budgets.
    const ins = await client.query(
      `insert into hunt_scan (round_client_id, player_tag, item_id, course_id, org_id, location_id)
         values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [roundClientId, playerTag, itemId, courseId, orgId, locationId ?? null]
    );
    await client.query("commit");
    return { scanId: ins.rows[0].id };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Settle a reservation into the metering record for the call we just paid
// for. Metering must never break gameplay, so failures are logged and
// swallowed — a failed UPDATE leaves the row as a bare reservation, which
// still counts toward the caps (conservative) and is ignored by the rollup.
async function finalizeScan({ scanId, usage, verified, flagged }) {
  try {
    await pool.query(
      `update hunt_scan
          set model = $2, input_tokens = $3, output_tokens = $4, verified = $5, flagged = $6
        where id = $1`,
      [
        scanId,
        usage?.model ?? null,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        verified ?? null,
        flagged ?? null,
      ]
    );
  } catch (err) {
    console.error("[hunt] scan metering update failed:", err);
  }
}

// Free a reservation whose provider call failed before billing. Swallows its
// own failure (the original error matters more); a row this misses just ages
// out of the 24h window like a crash orphan.
async function releaseScan(scanId) {
  try {
    await pool.query(`delete from hunt_scan where id = $1`, [scanId]);
  } catch (err) {
    console.error("[hunt] scan reservation release failed:", err);
  }
}

// See lib/huntAntiCheat.js for the fail-safe rules (TEST ONLY; forced off in
// production even if left set).
const ALLOW_PHOTO_OF_PHOTO = resolveAllowPhotoOfPhoto({
  rawFlag: process.env.HUNT_ALLOW_PHOTO_OF_PHOTO,
  nodeEnv: process.env.NODE_ENV,
});

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

// --- GET /api/hunt/photo-retention ------------------------------------------
// Public: how long stored hunt photos live before the retention sweep deletes
// them, so the /privacy page discloses the venue's ACTUAL configuration
// instead of a hardcoded number (which HUNT_PHOTO_RETENTION_DAYS could
// silently contradict). days <= 0 = the sweep is disabled (manual deletion
// only) — the page words that case honestly too.
router.get("/photo-retention", (_req, res) => {
  res.json({ days: resolvePhotoRetentionDays() });
});

// --- GET /api/hunt/items?course=<uuid> | ?location=<uuid> -------------------
// The list of things to find. Exactly one owner param says which hunt:
// `course` for the on-course list, `location` for the venue-wide one.
//
// Tenant-scoped: a foreign tenant's id answers like a nonexistent one (an
// empty list — that's what an owner with no items returns today). A venue with
// venueMode off answers the same way, so "this venue doesn't offer the
// course-free hunt" is indistinguishable from "this venue doesn't exist"
// across tenants, and the client renders one empty state for both.
router.get("/items", tenant(), async (req, res) => {
  const { course, location } = req.query;
  const hasCourse = course !== undefined;
  const hasLocation = location !== undefined;
  if (hasCourse === hasLocation) {
    return res
      .status(400)
      .json({ ok: false, error: "exactly one of course or location (uuid) is required" });
  }
  const owner = hasCourse ? course : location;
  if (typeof owner !== "string" || !UUID_RE.test(owner)) {
    return res
      .status(400)
      .json({ ok: false, error: `${hasCourse ? "course" : "location"} must be a uuid` });
  }
  try {
    // Two shapes of the same read. The course variant reaches its venue
    // through the course; the venue variant owns the location directly and
    // additionally requires venueMode to be on.
    const sql = hasCourse
      ? `select i.id, i.slug, i.name, i.hint, i.countable
           from hunt_item i
           join course c on c.id = i.course_id
           left join location l on l.id = c.location_id
          where i.active = true and i.course_id = $1
            ${tenantOrgFilter(req.tenant, "l.org_id", "$2")}
          order by i.sort_order asc, i.name asc`
      : `select i.id, i.slug, i.name, i.hint, i.countable
           from hunt_item i
           join location l on l.id = i.location_id
          where i.active = true and i.location_id = $1
            and l.archived_at is null
            and coalesce((l.hunt ->> 'venueMode')::boolean, false) = true
            ${tenantOrgFilter(req.tenant, "l.org_id", "$2")}
          order by i.sort_order asc, i.name asc`;
    const result = await pool.query(sql, [owner, ...tenantParams(req.tenant)]);
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
      `select f.id,
              f.item_id     as "itemId",
              i.slug        as "itemSlug",
              f.player_tag  as "playerTag",
              f.confidence,
              f.flagged,
              coalesce(f.photo_path is not null and f.moderation = 'approved', false) as "sharable",
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

// --- GET /api/hunt/photo/:findId?round=<clientId> ---------------------------
// Serve a group's own verified photo, for the share flow. Two gates:
//  - `round` must match the find's round_client_id — the unguessable device
//    round id is the group's key, so only the group that took a photo (or
//    whoever they hand the link to) can fetch it. There is no browse/list.
//  - the photo must be auto-moderation 'approved' (legacy pre-moderation
//    photos are not served until they've been through the vision pass).
// Policy (venue decision): photos flagged minors_present ARE sharable — the
// group sharing them is the group in them (parents sharing their own kids);
// there is no public gallery.
const MEDIA_BY_EXT = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

router.get("/photo/:findId", async (req, res) => {
  const { findId } = req.params;
  const round = req.query.round;
  if (!UUID_RE.test(findId)) {
    return res.status(400).json({ ok: false, error: "bad find id" });
  }
  if (typeof round !== "string" || round.length === 0 || round.length > 200) {
    return res.status(400).json({ ok: false, error: "round (clientId) is required" });
  }
  try {
    const result = await pool.query(
      `select photo_path as "photoPath" from hunt_find
        where id = $1 and round_client_id = $2
          and photo_path is not null and moderation = 'approved'`,
      [findId, round]
    );
    // One generic 404 for wrong-round, unmoderated, and missing alike — the
    // response must not reveal whether a find id exists under another round.
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
    console.error("[hunt] photo error:", err);
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
  tenant(),
  async (req, res) => {
    if (!isVisionConfigured()) {
      return res
        .status(503)
        .json({ ok: false, error: "vision is not configured on the server" });
    }

    const body = req.body ?? {};
    const { itemId, courseId, locationId, playerTag, roundClientId, imageBase64, mediaType } =
      body;

    // itemId — must look like a uuid; existence checked below.
    if (typeof itemId !== "string" || !UUID_RE.test(itemId)) {
      return res.status(400).json({ ok: false, error: "itemId must be a uuid" });
    }
    // The hunt's owner — exactly one, and it selects the mode (see the header).
    // The item must belong to it, so a client can't submit an item from
    // another list against this session.
    const hasCourse = courseId !== undefined && courseId !== null;
    const hasLocation = locationId !== undefined && locationId !== null;
    if (hasCourse === hasLocation) {
      return res.status(400).json({
        ok: false,
        error: "exactly one of courseId or locationId is required",
      });
    }
    if (hasCourse && (typeof courseId !== "string" || !UUID_RE.test(courseId))) {
      return res.status(400).json({ ok: false, error: "courseId must be a uuid" });
    }
    if (hasLocation && (typeof locationId !== "string" || !UUID_RE.test(locationId))) {
      return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
    }
    // playerTag — same rule as scorecard tags.
    if (!isValidTag(playerTag)) {
      return res.status(400).json({ ok: false, error: "playerTag is invalid" });
    }
    // roundClientId — required in both modes: it's the GROUP KEY every find,
    // dedupe check and spend cap is scoped by. On a course hunt it's the
    // in-progress round's clientId (the hunt is a play-time activity there);
    // on a venue hunt it's the device's venue-hunt session id, which the
    // client mints when the group starts a hunt. Same opaque-string contract.
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
      // Item must exist, be active, and belong to the hunt the client named —
      // and that hunt must belong to this tenant, so a foreign owner/item pair
      // can't burn vision spend or write finds against another venue. Foreign
      // and nonexistent answer identically below.
      //
      // The venue variant also requires venueMode: an operator who switches
      // the course-free hunt back off must stop paying for it immediately,
      // even from clients still holding a live session and item ids. It reads
      // as "that item isn't in this hunt", the same answer a stale item id
      // gets, rather than advertising the venue's configuration.
      const itemRes = await pool.query(
        hasCourse
          ? `select i.id, i.name, i.hint, i.extra_prompt, i.countable,
                    c.location_id as "locationId", l.hunt as "locationHunt",
                    l.org_id as "orgId"
               from hunt_item i
               join course c on c.id = i.course_id
               left join location l on l.id = c.location_id
              where i.id = $1 and i.course_id = $2 and i.active = true
                ${tenantOrgFilter(req.tenant, "l.org_id", "$3")}`
          : `select i.id, i.name, i.hint, i.extra_prompt, i.countable,
                    l.id as "locationId", l.hunt as "locationHunt",
                    l.org_id as "orgId"
               from hunt_item i
               join location l on l.id = i.location_id
              where i.id = $1 and i.location_id = $2 and i.active = true
                and l.archived_at is null
                and coalesce((l.hunt ->> 'venueMode')::boolean, false) = true
                ${tenantOrgFilter(req.tenant, "l.org_id", "$3")}`,
        [itemId, hasCourse ? courseId : locationId, ...tenantParams(req.tenant)]
      );
      if (itemRes.rowCount === 0) {
        return res.status(400).json({
          ok: false,
          error: hasCourse
            ? "itemId does not exist on this course"
            : "itemId does not exist in this venue's hunt",
        });
      }
      const item = itemRes.rows[0];

      // Per-venue kill switch: dailyScanCap 0 means the venue's hunt is off —
      // refuse before any gameplay logic (even dedupe replies would misleadingly
      // present a live hunt). 403, not 429: this isn't a budget that resets, and
      // the client surfaces the error string of any non-OK status as-is
      // (src/features/hunt/api.ts throws body.error).
      const venueCap = resolveVenueDailyCap(item.locationHunt);
      if (venueCap === 0) {
        return res
          .status(403)
          .json({ ok: false, error: "the hunt is not available at this venue" });
      }

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

      // Atomic cap check + reservation: every spend-cap count and the row
      // that consumes the checked room commit together, under a per-venue
      // advisory lock — see the reservation lifecycle above reserveScan.
      // Dedupe short-circuits returned before this point, so they still
      // never occupy (or need) a budget slot.
      const reservation = await reserveScan({
        lockId: item.locationId ?? courseId, // per-venue; per-course when the course has no venue
        roundClientId,
        playerTag,
        itemId,
        // Venue hunts have no course, so the metering row's course_id is null
        // and location_id carries the whole venue attribution. Both the daily
        // venue cap and the hunt-usage rollup read location_id first for
        // exactly this reason.
        courseId: hasCourse ? courseId : null,
        orgId: item.orgId,
        countable: item.countable,
        locationId: item.locationId,
        venueCap,
      });
      if (reservation.rejected) {
        return res
          .status(reservation.rejected.status)
          .json({ ok: false, error: reservation.rejected.error });
      }
      const { scanId } = reservation;

      // Ask the model. Every path out of this block settles the reservation:
      // finalize (the call was billed) or release (it wasn't) — the finally
      // guarantees a provider failure can't leak a phantom row that keeps
      // eating the caps. A process crash mid-call still can; that orphan is
      // accepted (see the lifecycle comment above reserveScan).
      let verdict;
      let flagged;
      let unsafe;
      let verified;
      let settled = false;
      try {
        try {
          verdict = await verifyItemInImage({
            imageBase64,
            mediaType,
            itemName: item.name,
            itemHint: item.hint,
            itemExtraPrompt: item.extra_prompt,
          });
        } catch (err) {
          if (err.code === "VISION_NO_OUTPUT") {
            // Transient: the model returned no verdict, but the call was
            // still billed — settle the reservation into the metering row
            // (usage rides on the error), record no find, and let the player
            // retry with a fresh shot instead of failing hard.
            await finalizeScan({ scanId, usage: err.usage, verified: null, flagged: null });
            settled = true;
            return res.json({
              ok: true,
              verified: false,
              flagged: false,
              reason: "Couldn't read that photo — try another shot.",
            });
          }
          throw err;
        }

        // A photo-of-a-photo never counts as a genuine find, regardless of what's
        // depicted — flag it and reject. TESTING: when ALLOW_PHOTO_OF_PHOTO is on
        // we treat it as un-flagged so a screenshot of a landmark still verifies.
        flagged = ALLOW_PHOTO_OF_PHOTO ? false : verdict.photoOfPhoto;
        // Moderation: unsafe content earns no credit and is never written to
        // disk, whatever it depicts. (Verdicts without the field — old mocks —
        // default to safe.)
        unsafe = Boolean(verdict.unsafe);
        verified = verdict.present && !flagged && !unsafe;

        // Meter the call we just paid for, before anything else can fail — the
        // tokens are billed whether or not the find persists.
        await finalizeScan({ scanId, usage: verdict.usage, verified, flagged });
        settled = true;
      } finally {
        // Provider failure (anything thrown before finalize): the spend
        // didn't happen, so free the slot instead of billing a phantom.
        if (!settled) await releaseScan(scanId);
      }

      // Persist the photo, then record the find. We only keep the file for
      // successful, unflagged, safe finds; rejected/unsafe attempts are never
      // stored (an unsafe image must not exist on disk even transiently).
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
      // Moderation verdict recorded with the find: stored (verified) photos
      // are auto-'approved' by the vision pass; unsafe attempts are 'flagged'
      // events (no photo on disk) so the operator can see they happened.
      const moderation = unsafe ? "flagged" : verified ? "approved" : null;
      const ins = await pool.query(
        `insert into hunt_find
           (round_client_id, player_tag, item_id, verified, confidence, reason, flagged, photo_path, countable,
            moderation, moderation_reason, people_present, minors_present)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
          moderation,
          unsafe ? verdict.unsafeReason || "unsafe content" : null,
          verdict.peoplePresent ?? null,
          verdict.minorsPresent ?? null,
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
        // An unsafe photo gets one fixed, friendly line — never the model's
        // content description — so the player just retakes the shot.
        reason: unsafe
          ? "That photo can't be used here — keep it family-friendly and try another shot."
          : verdict.reason,
        count,
      });
    } catch (err) {
      if (err.code === "VISION_UNCONFIGURED") {
        return res
          .status(503)
          .json({ ok: false, error: "vision is not configured on the server" });
      }
      console.error("[hunt] verify error:", err);
      return res.status(500).json({ ok: false, error: "internal error" });
    }
  }
);
