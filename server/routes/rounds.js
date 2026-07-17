// POST /api/rounds — idempotent sync of a completed round from a device.
//
// The client is offline-first: it holds active rounds in IndexedDB and, when a
// round completes, POSTs it here with a stable `clientId`. Re-syncs (retries,
// multiple devices, flaky network) must NOT create duplicates — we UPSERT on
// round.client_id inside a transaction.
import { Router } from "express";
import { pool } from "../db.js";
import { validateTags } from "../lib/sanitize.js";

export const router = Router();

// --- Basic per-IP rate limiting -------------------------------------------
// Writes are anonymous, so we cap how often a single IP can POST. This is a
// simple in-memory fixed-window counter — good enough for a single-process pm2
// app on the droplet. For multi-process / multi-host, swap in `express-rate-limit`
// (npm i express-rate-limit) with a shared store (e.g. Redis).
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window
const RATE_LIMIT_MAX = 30; // max writes per IP per window
const ipHits = new Map(); // ip -> { count, resetAt }

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

// Occasionally sweep expired entries so the Map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHits) {
    if (now >= entry.resetAt) ipHits.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref?.();

// --- Helpers ---------------------------------------------------------------
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPositiveInt(n) {
  return Number.isInteger(n) && n >= 1;
}

/**
 * Extract and validate the (playerIndex, hole, strokes) rows to insert.
 * `scores` is an object keyed by player index; each value is a length-18 array
 * of (number|null). Only non-null, valid entries are inserted.
 * @returns {{ rows: Array<{playerIndex:number,hole:number,strokes:number}> } | { error: string }}
 */
function collectScoreRows(scores, playerCount) {
  if (scores == null || typeof scores !== "object" || Array.isArray(scores)) {
    return { error: "scores must be an object keyed by player index" };
  }
  const rows = [];
  for (const key of Object.keys(scores)) {
    const playerIndex = Number(key);
    if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= playerCount) {
      return { error: `scores has invalid player index: ${key}` };
    }
    const arr = scores[key];
    if (!Array.isArray(arr) || arr.length !== 18) {
      return { error: `scores[${key}] must be an array of length 18` };
    }
    for (let i = 0; i < 18; i++) {
      const val = arr[i];
      if (val === null || val === undefined) continue; // hole not entered — skip
      if (!isPositiveInt(val)) {
        return { error: `scores[${key}][${i}] must be an integer >= 1 or null` };
      }
      rows.push({ playerIndex, hole: i + 1, strokes: val });
    }
  }
  return { rows };
}

// --- Route -----------------------------------------------------------------
router.post("/", rateLimit, async (req, res) => {
  const body = req.body ?? {};
  const { clientId, courseId, playerTags, createdAt, completedAt, scores } = body;

  // clientId — required dedupe key.
  if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > 200) {
    return res.status(400).json({ ok: false, error: "clientId is required" });
  }

  // courseId — must look like a uuid (existence checked against DB below).
  if (typeof courseId !== "string" || !UUID_RE.test(courseId)) {
    return res.status(400).json({ ok: false, error: "courseId must be a uuid" });
  }

  // player tags — charset + blocklist + count 1..4.
  const tagCheck = validateTags(playerTags);
  if (!tagCheck.ok) {
    return res.status(400).json({ ok: false, error: tagCheck.error });
  }

  // timestamps — ms epoch numbers. completedAt may be null.
  if (!Number.isFinite(createdAt)) {
    return res.status(400).json({ ok: false, error: "createdAt must be a ms-epoch number" });
  }
  if (completedAt !== null && !Number.isFinite(completedAt)) {
    return res.status(400).json({ ok: false, error: "completedAt must be a ms-epoch number or null" });
  }

  // scores — collect the non-null holes to insert.
  const collected = collectScoreRows(scores, playerTags.length);
  if (collected.error) {
    return res.status(400).json({ ok: false, error: collected.error });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Course must exist.
    const courseRes = await client.query("select id from course where id = $1", [courseId]);
    if (courseRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "courseId does not exist" });
    }

    // Idempotent insert on client_id. ON CONFLICT DO NOTHING means a re-sync
    // returns 0 rows; we then look up the existing round and return its id
    // without touching its scores.
    const insertRound = await client.query(
      `insert into round (course_id, player_tags, created_at, completed_at, client_id)
         values ($1, $2, to_timestamp($3 / 1000.0), $4, $5)
       on conflict (client_id) do nothing
       returning id`,
      [
        courseId,
        playerTags,
        createdAt,
        completedAt === null ? null : new Date(completedAt),
        clientId,
      ]
    );

    let roundId;
    if (insertRound.rowCount === 1) {
      // Fresh round — insert its scores.
      roundId = insertRound.rows[0].id;
      for (const row of collected.rows) {
        await client.query(
          `insert into score (round_id, player_index, hole, strokes)
             values ($1, $2, $3, $4)
           on conflict (round_id, player_index, hole) do nothing`,
          [roundId, row.playerIndex, row.hole, row.strokes]
        );
      }
    } else {
      // Duplicate sync — round already exists. Return its id, leave scores alone.
      const existing = await client.query(
        "select id from round where client_id = $1",
        [clientId]
      );
      roundId = existing.rows[0].id;
    }

    await client.query("COMMIT");
    return res.json({ ok: true, roundId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[rounds] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});
