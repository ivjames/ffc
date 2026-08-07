// POST /api/rounds — idempotent sync of a completed round from a device.
//
// The client is offline-first: it holds active rounds in IndexedDB and, when a
// round completes, POSTs it here with a stable `clientId`. Re-syncs (retries,
// multiple devices, flaky network) must NOT create duplicates — we UPSERT on
// round.client_id inside a transaction.
import { Router } from "express";
import { pool } from "../db.js";
import { validateTags, isValidTag } from "../lib/sanitize.js";
import { scoreAchievements, newRewardCode } from "../lib/rewards.js";

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

// --- Rewards ---------------------------------------------------------------
/**
 * Grant achievements for a freshly-synced completed round (same transaction).
 * Score-based ones (hole-in-one, under par) come from lib/rewards.js; Hunt
 * Master is granted to each player whose verified finds cover every active
 * non-countable item on the course's hunt list (hunt_find is keyed by the
 * device round id — our clientId — because the hunt runs during play, before
 * the round exists server-side).
 */
async function grantRewards(client, { roundId, clientId, courseId, playerTags, scoreRows, pars }) {
  const grants = scoreAchievements(scoreRows, playerTags.length, pars);

  const huntDone = await client.query(
    `select f.player_tag as tag
       from hunt_find f
       join hunt_item i on i.id = f.item_id
      where f.round_client_id = $1 and f.verified
        and i.course_id = $2 and i.active and not i.countable
      group by f.player_tag
     having count(distinct i.id) = (
        select count(*) from hunt_item
         where course_id = $2 and active and not countable
       )
        and count(distinct i.id) > 0`,
    [clientId, courseId]
  );
  for (const { tag } of huntDone.rows) {
    // Hunt finds are keyed by tag, not roster position — credit the first
    // roster slot with that tag (duplicate tags can't be told apart anyway).
    const playerIndex = playerTags.indexOf(tag);
    if (playerIndex !== -1) grants.push({ playerIndex, achievement: "hunt_master" });
  }

  for (const grant of grants) {
    // Retry the random short code on the (rare) unique collision — behind a
    // savepoint, because a unique violation otherwise aborts the whole round
    // transaction. The per-(round, player, achievement) uniqueness makes
    // re-grants no-ops.
    for (let attempt = 0; attempt < 5; attempt++) {
      await client.query("SAVEPOINT reward_grant_sp");
      try {
        await client.query(
          `insert into reward_grant (code, round_id, player_index, player_tag, achievement)
             values ($1, $2, $3, $4, $5)
           on conflict (round_id, player_index, achievement) do nothing`,
          [newRewardCode(), roundId, grant.playerIndex, playerTags[grant.playerIndex], grant.achievement]
        );
        await client.query("RELEASE SAVEPOINT reward_grant_sp");
        break;
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT reward_grant_sp");
        if (!(err && err.code === "23505" && attempt < 4)) throw err;
      }
    }
  }
}

// --- Route -----------------------------------------------------------------
router.post("/", rateLimit, async (req, res) => {
  const body = req.body ?? {};
  const { clientId, courseId, playerTags, groupTag, createdAt, completedAt, scores } = body;

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

  // group (team) tag — optional, same charset + blocklist as a player tag.
  if (groupTag !== undefined && groupTag !== null && !isValidTag(groupTag)) {
    return res.status(400).json({ ok: false, error: "invalid or blocked groupTag" });
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

    // Course must exist (pars feed the reward computation below).
    const courseRes = await client.query("select id, pars from course where id = $1", [courseId]);
    if (courseRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "courseId does not exist" });
    }

    // Idempotent insert on client_id. ON CONFLICT DO NOTHING means a re-sync
    // returns 0 rows; we then look up the existing round and return its id
    // without touching its scores.
    const insertRound = await client.query(
      `insert into round (course_id, player_tags, group_tag, created_at, completed_at, client_id)
         values ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6)
       on conflict (client_id) do nothing
       returning id`,
      [
        courseId,
        playerTags,
        groupTag ?? null,
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
      // Rewards (punchlist #8): grant achievements for a COMPLETED fresh round.
      // Same transaction as the round itself — a grant without its round (or
      // vice versa) would be a lie at the redemption counter.
      if (completedAt !== null) {
        await grantRewards(client, {
          roundId,
          clientId,
          courseId,
          playerTags,
          scoreRows: collected.rows,
          pars: courseRes.rows[0].pars,
        });
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
