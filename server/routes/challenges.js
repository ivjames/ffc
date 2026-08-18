// Head-to-head challenges — two players, one arcade game, scores compared.
//
//   POST /api/challenges                  {locationId, game, variant?} -> inviteCode
//   POST /api/challenges/join             {inviteCode}   claim as the opponent
//   POST /api/challenges/:id/play         {score, detail?, sessionId}
//   GET  /api/challenges/:id
//   GET  /api/challenges/mine
//   GET  /api/challenges/:id/events       SSE (the synchronous mode)
//
// Async and sync are the SAME record. They differ only in when the two rounds
// happen: async is "A plays, sends the code, B plays tomorrow"; sync is "both
// join, both play now", with the SSE stream making each side's progress
// visible to the other. Building them as one thing means there is one set of
// rules about who may play, how often, and who won.
//
// Two things this route deliberately does NOT own:
//   1. Ranking. The winner comes from the same per-game direction that ranks
//      the high score boards (lib/gameScores.js), so a go-kart challenge is
//      won by the FASTER lap and a skee-ball challenge by the higher total,
//      with no game knowledge here at all.
//   2. Score recording. Playing a challenge round writes the venue's
//      game_score row too, in the same call — a challenge round is a real
//      round, and making the client post twice would let the two drift.
import { Router } from "express";
import { pool } from "../db.js";
import { requireUser } from "../lib/userAuth.js";
import { UUID_RE } from "../lib/validateLocation.js";
import { tenant, findTenantLocation } from "../lib/tenant.js";
import { moduleLive, locationModuleLive } from "../lib/modules.js";
import { generateJoinCode, normalizeJoinCode } from "../lib/joinCode.js";
import { subscribe, publish, sseSend } from "../lib/gameBus.js";
import { makeRateLimit } from "../lib/rateLimit.js";
import { isScoredGame, scoredGame, normalizeVariant, isBetter, MAX_SCORE } from "../lib/gameScores.js";

export const router = Router();

// A challenge nobody answers shouldn't sit in a list forever. A week is long
// enough for "I'll get you back tomorrow" and short enough that the list stays
// about live rivalries.
const CHALLENGE_TTL_DAYS = 7;

const createLimit = makeRateLimit({
  windowMs: 60_000,
  max: 20,
  keyFn: (req) => req.user?.id ?? null,
  name: "challenge create limit",
});
const joinLimit = makeRateLimit({ windowMs: 60_000, max: 30, name: "challenge join limit" });

export function resetChallengeRateLimits() {
  createLimit.reset();
  joinLimit.reset();
}

const COLS = `c.id, c.location_id as "locationId", c.game, c.variant,
              c.invite_code as "inviteCode", c.created_by as "createdBy",
              c.opponent_id as "opponentId", c.status,
              c.expires_at as "expiresAt", c.created_at as "createdAt",
              c.completed_at as "completedAt"`;

/** Lazily expire a challenge past its window. Returns the effective status. */
async function expireIfStale(challenge) {
  if (challenge.status !== "open") return challenge.status;
  if (new Date(challenge.expiresAt).getTime() > Date.now()) return "open";
  await pool.query(`update challenge set status = 'expired' where id = $1 and status = 'open'`, [
    challenge.id,
  ]);
  return "expired";
}

async function loadChallenge(id) {
  if (!UUID_RE.test(id)) return null;
  const result = await pool.query(`select ${COLS} from challenge c where c.id = $1`, [id]);
  return result.rows[0] ?? null;
}

/**
 * The challenge as its two players see it: both entries, and — once both have
 * played — who won. `viewerId` marks which side "you" are.
 */
async function buildView(challenge, viewerId = null) {
  const entries = await pool.query(
    `select e.app_user_id as "userId", e.score::bigint as score, e.detail,
            e.played_at as "playedAt", u.display_name as name, u.default_tag as tag
       from challenge_entry e
       join app_user u on u.id = e.app_user_id
      where e.challenge_id = $1`,
    [challenge.id]
  );
  const byUser = new Map(entries.rows.map((r) => [r.userId, { ...r, score: Number(r.score) }]));
  const challenger = byUser.get(challenge.createdBy) ?? null;
  const opponent = challenge.opponentId ? (byUser.get(challenge.opponentId) ?? null) : null;

  // A winner exists only when BOTH have played — a challenge with one entry is
  // not a 1-0 lead, it's an unanswered challenge.
  let winnerId = null;
  let tied = false;
  if (challenger && opponent) {
    if (challenger.score === opponent.score) tied = true;
    else {
      // The board's own comparator decides, so "better" means faster on a lap
      // game and higher on a points game without this code knowing which.
      winnerId = isBetter(challenge.game, challenger.score, opponent.score)
        ? challenge.createdBy
        : challenge.opponentId;
    }
  }

  return {
    challenge: {
      id: challenge.id,
      locationId: challenge.locationId,
      game: challenge.game,
      variant: challenge.variant,
      meta: scoredGame(challenge.game),
      inviteCode: challenge.status === "open" ? challenge.inviteCode : null,
      status: challenge.status,
      expiresAt: challenge.expiresAt,
      completedAt: challenge.completedAt,
    },
    challenger: challenger
      ? { ...challenger, isYou: challenger.userId === viewerId }
      : { userId: challenge.createdBy, score: null, isYou: challenge.createdBy === viewerId },
    opponent: opponent
      ? { ...opponent, isYou: opponent.userId === viewerId }
      : challenge.opponentId
        ? { userId: challenge.opponentId, score: null, isYou: challenge.opponentId === viewerId }
        : null,
    winnerId,
    tied,
    youWon: winnerId != null && winnerId === viewerId,
  };
}

/** Push the challenge's new state to both sides (the synchronous mode). */
async function broadcast(challenge) {
  // Viewer-neutral payload: `isYou`/`youWon` are resolved per subscriber
  // client-side from the ids, so one frame serves both connections.
  publish(challenge.id, "state", await buildView(challenge, null));
}

/** May this user see/act on this challenge? The creator always; the opponent
 *  once claimed; nobody else — a challenge id is not a public capability. */
function isParty(challenge, userId) {
  return challenge.createdBy === userId || challenge.opponentId === userId;
}

// --- Create -----------------------------------------------------------------

router.post("/", requireUser, createLimit, tenant(), async (req, res) => {
  const { locationId, game, variant: rawVariant } = req.body ?? {};
  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  if (typeof game !== "string" || !isScoredGame(game)) {
    return res.status(400).json({ ok: false, error: "unknown game" });
  }
  const variantCheck = normalizeVariant(game, rawVariant);
  if (variantCheck.error) return res.status(400).json({ ok: false, error: variantCheck.error });

  try {
    const loc = await findTenantLocation(locationId, req.tenant, { cols: "id, pos, modules" });
    if (!loc) return res.status(404).json({ ok: false, error: "unknown location" });
    // The venue's plan has to include the arcade before we record arcade work
    // for it (lib/modules.js). The client route guard keeps players out of the
    // UI; this keeps a hand-rolled request out of the data.
    if (!moduleLive(loc, "arcade")) {
      return res.status(403).json({ ok: false, error: "the arcade is not enabled for this venue" });
    }

    const expires = new Date(Date.now() + CHALLENGE_TTL_DAYS * 24 * 60 * 60 * 1000);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const inserted = await pool.query(
          `insert into challenge (location_id, game, variant, invite_code, created_by, expires_at)
           values ($1, $2, $3, $4, $5, $6)
           returning ${COLS.replace(/c\./g, "")}`,
          [locationId, game, variantCheck.variant, generateJoinCode(), req.user.id, expires]
        );
        return res.json({ ok: true, ...(await buildView(inserted.rows[0], req.user.id)) });
      } catch (err) {
        // Retry the code collision rather than pre-checking: the gap between
        // "is this code free" and "insert" is precisely the race.
        if (err?.code !== "23505" || attempt === 4) throw err;
      }
    }
  } catch (err) {
    console.error("[challenges] create error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Join -------------------------------------------------------------------

router.post("/join", requireUser, joinLimit, async (req, res) => {
  const code = normalizeJoinCode(req.body?.inviteCode);
  if (!code) return res.status(400).json({ ok: false, error: "inviteCode is required" });

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Lock the row: two friends racing the same code must not both become the
    // opponent, which would silently make one of their rounds unscoreable.
    const found = await client.query(
      `select ${COLS} from challenge c where c.invite_code = $1 and c.status = 'open' for update`,
      [code]
    );
    const challenge = found.rows[0];
    if (!challenge) {
      await client.query("rollback");
      return res.status(404).json({ ok: false, error: "no open challenge with that code" });
    }
    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      await client.query(`update challenge set status = 'expired' where id = $1`, [challenge.id]);
      await client.query("commit");
      return res.status(409).json({ ok: false, error: "that challenge has expired" });
    }
    if (challenge.createdBy === req.user.id) {
      await client.query("rollback");
      return res.status(409).json({ ok: false, error: "that's your own challenge" });
    }
    if (challenge.opponentId && challenge.opponentId !== req.user.id) {
      await client.query("rollback");
      return res.status(409).json({ ok: false, error: "someone already took this challenge" });
    }
    // Rechecked here, not just at create: a challenge is open for a week, so
    // the venue can lose the arcade module long after it was issued.
    if (!(await locationModuleLive(client, challenge.locationId, "arcade"))) {
      await client.query("rollback");
      return res.status(403).json({ ok: false, error: "the arcade is not enabled for this venue" });
    }

    const claimed = await client.query(
      `update challenge set opponent_id = $1 where id = $2 returning ${COLS.replace(/c\./g, "")}`,
      [req.user.id, challenge.id]
    );
    await client.query("commit");
    const fresh = claimed.rows[0];
    await broadcast(fresh);
    return res.json({ ok: true, ...(await buildView(fresh, req.user.id)) });
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error("[challenges] join error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});

// --- Play -------------------------------------------------------------------

router.post("/:id/play", requireUser, async (req, res) => {
  const { score, detail, sessionId } = req.body ?? {};
  if (!Number.isInteger(score) || score < -MAX_SCORE || score > MAX_SCORE) {
    return res.status(400).json({ ok: false, error: `score must be an integer within ±${MAX_SCORE}` });
  }
  if (typeof sessionId !== "string" || sessionId.length < 8 || sessionId.length > 100) {
    return res.status(400).json({ ok: false, error: "sessionId is required (8..100 chars)" });
  }
  if (detail !== undefined && detail !== null && (typeof detail !== "object" || Array.isArray(detail))) {
    return res.status(400).json({ ok: false, error: "detail must be an object" });
  }

  try {
    const challenge = await loadChallenge(req.params.id);
    if (!challenge) return res.status(404).json({ ok: false, error: "unknown challenge" });
    // A challenge id is not a public capability — a stranger who guessed one
    // must not be able to add a round to it.
    if (!isParty(challenge, req.user.id)) {
      return res.status(403).json({ ok: false, error: "you're not in this challenge" });
    }
    // A REPLAY of a round already recorded is answered before any of the gates
    // below, because none of them are about this request: the round is already
    // in, and the only question left is what to show for it. Checking after the
    // status gate meant a retry that arrived a moment after the opponent
    // finished — exactly when both phones are on the screen together — was
    // refused as "that challenge is closed", and the marker cleared on it.
    const mine = await pool.query(
      `select session_id as "sessionId" from challenge_entry
        where challenge_id = $1 and app_user_id = $2`,
      [challenge.id, req.user.id]
    );
    if (mine.rows[0]?.sessionId === sessionId) {
      return res.json({ ok: true, ...(await buildView(challenge, req.user.id)) });
    }

    if ((await expireIfStale(challenge)) !== "open") {
      return res.status(409).json({ ok: false, error: "that challenge is closed" });
    }
    // Same recheck as join — this writes a challenge_entry AND a board row, so
    // it must not run for a venue that no longer has the module.
    if (!(await locationModuleLive(pool, challenge.locationId, "arcade"))) {
      return res.status(403).json({ ok: false, error: "the arcade is not enabled for this venue" });
    }

    // ON CONFLICT DO NOTHING against (challenge, user) IS the one-round rule:
    // without it a player could replay until the score was good enough.
    const inserted = await pool.query(
      `insert into challenge_entry (challenge_id, app_user_id, score, detail, session_id)
       values ($1, $2, $3, $4::jsonb, $5)
       on conflict (challenge_id, app_user_id) do nothing
       returning score`,
      [challenge.id, req.user.id, score, JSON.stringify(detail ?? {}), sessionId]
    );
    if (inserted.rowCount === 0) {
      // Two copies of the same submit in flight at once — the early check
      // above found nothing because neither had landed yet. Same rule: the
      // round's own session id decides whether this is that round arriving
      // twice or a second attempt at the challenge.
      const existing = await pool.query(
        `select session_id as "sessionId" from challenge_entry
          where challenge_id = $1 and app_user_id = $2`,
        [challenge.id, req.user.id]
      );
      if (existing.rows[0]?.sessionId !== sessionId) {
        return res.status(409).json({ ok: false, error: "you've already played this challenge" });
      }
      // Same round: fall through and answer with where the challenge stands.
      // The board write below is keyed on (game, session_id) and the
      // completion is guarded on status, so replaying changes nothing.
    }

    // A challenge round is a real round, so it lands on the venue's board too —
    // written here rather than by a second client call, so the two can't drift.
    // Best-effort: a board write that fails must not cost the player the round
    // they just played.
    await pool
      .query(
        `insert into game_score
           (location_id, game, variant, app_user_id, score, detail, session_id)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7)
         on conflict (game, session_id) do nothing`,
        [
          challenge.locationId,
          challenge.game,
          challenge.variant,
          req.user.id,
          score,
          JSON.stringify(detail ?? {}),
          sessionId,
        ]
      )
      .catch((err) => console.error("[challenges] board write failed:", err));

    // Complete once both sides have a round in.
    const count = await pool.query(
      `select count(*)::int as n from challenge_entry where challenge_id = $1`,
      [challenge.id]
    );
    let fresh = challenge;
    if (count.rows[0].n >= 2) {
      const done = await pool.query(
        `update challenge set status = 'complete', completed_at = now()
          where id = $1 and status = 'open' returning ${COLS.replace(/c\./g, "")}`,
        [challenge.id]
      );
      // Guarded on `open` so a replayed round can't move completed_at, which
      // means the update can legitimately match nothing — re-read instead of
      // trusting the returning clause to have a row.
      fresh = done.rows[0] ?? (await loadChallenge(challenge.id)) ?? challenge;
    }

    await broadcast(fresh);
    return res.json({ ok: true, ...(await buildView(fresh, req.user.id)) });
  } catch (err) {
    console.error("[challenges] play error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Read -------------------------------------------------------------------

router.get("/mine", requireUser, async (req, res) => {
  try {
    // Expire this player's stale rows before reading them. The TTL is only
    // ever applied lazily, so without this the list is the one place a
    // week-old challenge still reads as Open: it sorts into the Open section
    // with a "Play your round" button that `/play` then refuses. One
    // set-based update rather than a call per row — the list holds 50.
    await pool.query(
      `update challenge set status = 'expired'
        where status = 'open' and expires_at <= now()
          and (created_by = $1 or opponent_id = $1)`,
      [req.user.id]
    );
    const result = await pool.query(
      `select ${COLS} from challenge c
        where (c.created_by = $1 or c.opponent_id = $1)
        order by case when c.status = 'open' then 0 else 1 end, c.created_at desc
        limit 50`,
      [req.user.id]
    );
    const views = await Promise.all(result.rows.map((row) => buildView(row, req.user.id)));
    return res.json({ ok: true, challenges: views });
  } catch (err) {
    console.error("[challenges] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.get("/:id", requireUser, async (req, res) => {
  try {
    const challenge = await loadChallenge(req.params.id);
    if (!challenge) return res.status(404).json({ ok: false, error: "unknown challenge" });
    if (!isParty(challenge, req.user.id)) {
      // 404, not 403: a non-party has no business learning that this id exists.
      return res.status(404).json({ ok: false, error: "unknown challenge" });
    }
    await expireIfStale(challenge);
    const fresh = await loadChallenge(req.params.id);
    return res.json({ ok: true, ...(await buildView(fresh, req.user.id)) });
  } catch (err) {
    console.error("[challenges] read error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- SSE (the synchronous mode) ---------------------------------------------
// Both sides watching one challenge see the other's round land the moment it
// does — which is the whole difference between "play together" and "play, then
// text them your score".

router.get("/:id/events", requireUser, async (req, res) => {
  const challenge = await loadChallenge(req.params.id).catch(() => null);
  if (!challenge || !isParty(challenge, req.user.id)) {
    return res.status(404).json({ ok: false, error: "unknown challenge" });
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const unsubscribe = subscribe(challenge.id, res);
  req.on("close", unsubscribe);

  try {
    sseSend(res, "state", await buildView(challenge, null));
  } catch (err) {
    console.error("[challenges] stream open error:", err);
  }
});
