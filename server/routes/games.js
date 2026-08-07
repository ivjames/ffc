// Shared multi-device games — several phones scoring ONE scorecard.
//
//   POST /api/games                {courseId, tag, teamId?}    create (signed-in)
//   POST /api/games/join           {joinCode, tag}             join (guest ok)
//   GET  /api/games/:id            ?participant=<token>        snapshot
//   POST /api/games/:id/scores     {participant, writes:[...]} LWW cell writes
//   POST /api/games/:id/complete   {participant}               finalize -> round
//   GET  /api/games/:id/events     ?participant=<token>        SSE stream
//
// The participant token (shared_game_participant.id) is the per-device bearer
// credential for everything after create/join — including the SSE stream,
// where it rides the query string because EventSource can't set headers.
// Completion writes a canonical round with client_id = 'shared:'+gameId, so
// the leaderboard/TV/admin surfaces need no changes.
import { Router } from "express";
import { pool } from "../db.js";
import { requireUser } from "../lib/userAuth.js";
import { isValidTag } from "../lib/sanitize.js";
import { generateJoinCode, normalizeJoinCode } from "../lib/joinCode.js";
import { applyCellWrite } from "../lib/lww.js";
import { subscribe, publish, sseSend } from "../lib/gameBus.js";
import { makeRateLimit } from "../lib/rateLimit.js";
import { UUID_RE } from "../lib/validateLocation.js";

export const router = Router();

const MAX_PLAYERS = 4;
const HOLE_COUNT = 18;
// A game left open this long is abandoned — its join code returns to the pool
// and late writes are refused. Checked lazily on access (no cron needed).
const GAME_TTL_MS = 24 * 60 * 60 * 1000;

const joinLimit = makeRateLimit({ windowMs: 60_000, max: 20, name: "join limit" });
const scoreLimit = makeRateLimit({
  windowMs: 60_000,
  max: 120,
  keyFn: (req) => (typeof req.body?.participant === "string" ? req.body.participant : null),
  name: "score limit",
});

export function resetGameRateLimits() {
  joinLimit.reset();
  scoreLimit.reset();
}

const GAME_COLS = `g.id, g.join_code as "joinCode", g.course_id as "courseId",
                   g.team_id as "teamId", g.status, g.round_id as "roundId",
                   g.created_at as "createdAt"`;

/** Lazily expire an open game past its TTL. Returns the (possibly updated)
 *  status. Pass the transaction's client as `q` when the caller already holds
 *  a lock on the row — using the pool there would self-deadlock. */
async function expireIfStale(game, q = pool) {
  if (game.status !== "open") return game.status;
  if (Date.now() - new Date(game.createdAt).getTime() < GAME_TTL_MS) return "open";
  await q.query(`update shared_game set status = 'abandoned' where id = $1 and status = 'open'`, [
    game.id,
  ]);
  return "abandoned";
}

/** Resolve a participant token to its game; null on any mismatch. */
async function loadParticipantGame(gameId, participantToken) {
  if (!UUID_RE.test(gameId) || typeof participantToken !== "string" || !UUID_RE.test(participantToken)) {
    return null;
  }
  const result = await pool.query(
    `select ${GAME_COLS}, p.id as "participantId", p.app_user_id as "participantUserId"
       from shared_game_participant p
       join shared_game g on g.id = p.game_id
      where p.id = $1 and p.game_id = $2`,
    [participantToken, gameId]
  );
  return result.rows[0] ?? null;
}

/** Full game snapshot: roster + live cells. */
async function buildSnapshot(game) {
  const players = await pool.query(
    `select sp.slot, sp.tag, sp.app_user_id as "userId", u.display_name as "displayName"
       from shared_game_player sp
       left join app_user u on u.id = sp.app_user_id
      where sp.game_id = $1
      order by sp.slot`,
    [game.id]
  );
  const scores = await pool.query(
    `select slot, hole, strokes, ts_client as "ts", updated_by as "by"
       from shared_score where game_id = $1
      order by slot, hole`,
    [game.id]
  );
  return {
    game: {
      id: game.id,
      joinCode: game.joinCode,
      courseId: game.courseId,
      teamId: game.teamId,
      status: game.status,
      roundId: game.roundId ?? null,
    },
    players: players.rows,
    scores: scores.rows.map((s) => ({ ...s, ts: Number(s.ts) })),
  };
}

// --- Create ----------------------------------------------------------------
router.post("/", requireUser, async (req, res) => {
  const { courseId, teamId, tag } = req.body ?? {};
  if (typeof courseId !== "string" || !UUID_RE.test(courseId)) {
    return res.status(400).json({ ok: false, error: "courseId must be a uuid" });
  }
  if (!isValidTag(tag)) {
    return res.status(400).json({ ok: false, error: "tag must be 3 characters A-Z 0-9" });
  }
  if (teamId !== undefined && teamId !== null && (typeof teamId !== "string" || !UUID_RE.test(teamId))) {
    return res.status(400).json({ ok: false, error: "teamId must be a uuid" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const course = await client.query(`select id from course where id = $1`, [courseId]);
    if (course.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "courseId does not exist" });
    }
    if (teamId) {
      const member = await client.query(
        `select 1 from team_member where team_id = $1 and app_user_id = $2`,
        [teamId, req.user.id]
      );
      if (member.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({ ok: false, error: "not a member of that team" });
      }
    }

    // Mint a code, retrying the (vanishingly rare) collision with an open game.
    let game;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await client.query(
          `insert into shared_game (join_code, course_id, team_id, created_by)
             values ($1, $2, $3, $4)
           returning id, join_code as "joinCode", course_id as "courseId",
                     team_id as "teamId", status, round_id as "roundId",
                     created_at as "createdAt"`,
          [generateJoinCode(), courseId, teamId ?? null, req.user.id]
        );
        game = result.rows[0];
        break;
      } catch (err) {
        if (err?.code !== "23505") throw err; // 23505 = unique_violation on the code
      }
    }
    if (!game) throw new Error("could not allocate a join code");

    await client.query(
      `insert into shared_game_player (game_id, slot, tag, app_user_id) values ($1, 0, $2, $3)`,
      [game.id, tag, req.user.id]
    );
    const participant = await client.query(
      `insert into shared_game_participant (game_id, app_user_id) values ($1, $2) returning id`,
      [game.id, req.user.id]
    );
    await client.query("COMMIT");
    return res.json({
      ok: true,
      game: { ...game, roundId: null },
      participantToken: participant.rows[0].id,
      slot: 0,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[games] create error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});

// --- Join ------------------------------------------------------------------
router.post("/join", joinLimit, async (req, res) => {
  const code = normalizeJoinCode(req.body?.joinCode);
  const { tag } = req.body ?? {};
  if (!code) return res.status(400).json({ ok: false, error: "joinCode must be 6 characters" });
  if (!isValidTag(tag)) {
    return res.status(400).json({ ok: false, error: "tag must be 3 characters A-Z 0-9" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock the game row so two devices claiming the last slot serialize.
    const gameRes = await client.query(
      `select ${GAME_COLS} from shared_game g
        where g.join_code = $1 and g.status = 'open'
        for update`,
      [code]
    );
    const game = gameRes.rows[0];
    if (!game || (await expireIfStale(game, client)) !== "open") {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "no open game with that code" });
    }

    const players = await client.query(
      `select slot, tag, app_user_id as "userId" from shared_game_player
        where game_id = $1 order by slot`,
      [game.id]
    );

    // Rejoin: a signed-in user who already has a slot keeps it; otherwise a
    // matching tag reclaims its slot unless it belongs to a DIFFERENT account
    // (guest slots are reclaimable by tag — the join code is the capability).
    let slot = null;
    const mine = req.user ? players.rows.find((p) => p.userId === req.user.id) : undefined;
    const sameTag = players.rows.find((p) => p.tag === tag);
    if (mine) {
      slot = mine.slot;
    } else if (sameTag) {
      if (sameTag.userId && sameTag.userId !== (req.user?.id ?? null)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, error: "that tag is taken in this game" });
      }
      slot = sameTag.slot;
    } else {
      if (players.rowCount >= MAX_PLAYERS) {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, error: "game is full" });
      }
      slot = players.rowCount === 0 ? 0 : Math.max(...players.rows.map((p) => p.slot)) + 1;
      await client.query(
        `insert into shared_game_player (game_id, slot, tag, app_user_id) values ($1, $2, $3, $4)`,
        [game.id, slot, tag, req.user?.id ?? null]
      );
    }

    const participant = await client.query(
      `insert into shared_game_participant (game_id, app_user_id) values ($1, $2) returning id`,
      [game.id, req.user?.id ?? null]
    );
    await client.query("COMMIT");

    const snapshot = await buildSnapshot(game);
    if (!mine && !sameTag) {
      publish(game.id, "player_joined", { slot, tag, userId: req.user?.id ?? null });
    }
    return res.json({
      ok: true,
      game: snapshot.game,
      participantToken: participant.rows[0].id,
      slot,
      snapshot,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[games] join error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});

// --- Snapshot --------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const game = await loadParticipantGame(req.params.id, req.query?.participant);
    if (!game) return res.status(401).json({ ok: false, error: "unknown game or participant" });
    game.status = await expireIfStale(game);
    return res.json({ ok: true, snapshot: await buildSnapshot(game) });
  } catch (err) {
    console.error("[games] snapshot error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Score writes ----------------------------------------------------------
function validateWrites(writes, playerCount) {
  if (!Array.isArray(writes) || writes.length === 0 || writes.length > MAX_PLAYERS * HOLE_COUNT) {
    return { error: "writes must be a non-empty array" };
  }
  for (const w of writes) {
    if (w == null || typeof w !== "object") return { error: "each write must be an object" };
    if (!Number.isInteger(w.slot) || w.slot < 0 || w.slot >= playerCount) {
      return { error: `invalid slot: ${w.slot}` };
    }
    if (!Number.isInteger(w.hole) || w.hole < 1 || w.hole > HOLE_COUNT) {
      return { error: `invalid hole: ${w.hole}` };
    }
    if (w.strokes !== null && (!Number.isInteger(w.strokes) || w.strokes < 1)) {
      return { error: "strokes must be an integer >= 1 or null" };
    }
    if (!Number.isFinite(w.ts)) return { error: "ts must be a ms-epoch number" };
  }
  return {};
}

router.post("/:id/scores", scoreLimit, async (req, res) => {
  try {
    const game = await loadParticipantGame(req.params.id, req.body?.participant);
    if (!game) return res.status(401).json({ ok: false, error: "unknown game or participant" });
    if ((await expireIfStale(game)) !== "open") {
      return res.status(409).json({ ok: false, error: "game is no longer open" });
    }
    const playerCount = (
      await pool.query(`select count(*)::int as n from shared_game_player where game_id = $1`, [game.id])
    ).rows[0].n;
    const check = validateWrites(req.body?.writes, playerCount);
    if (check.error) return res.status(400).json({ ok: false, error: check.error });

    let applied = 0;
    for (const w of req.body.writes) {
      const result = await applyCellWrite(pool, game.id, w, game.participantId);
      if (result.applied) {
        applied++;
        // Broadcast with the CLAMPED ts the server stored, so every replica
        // compares the same value.
        publish(game.id, "score", {
          slot: w.slot,
          hole: w.hole,
          strokes: w.strokes,
          ts: result.ts,
          by: game.participantId,
        });
      }
    }
    await pool.query(`update shared_game_participant set last_seen_at = now() where id = $1`, [
      game.participantId,
    ]);
    return res.json({ ok: true, applied });
  } catch (err) {
    console.error("[games] scores error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Complete --------------------------------------------------------------
router.post("/:id/complete", async (req, res) => {
  const client = await pool.connect();
  try {
    const game = await loadParticipantGame(req.params.id, req.body?.participant);
    if (!game) {
      client.release();
      return res.status(401).json({ ok: false, error: "unknown game or participant" });
    }
    await client.query("BEGIN");
    // Serialize completion — two devices tapping Finish must produce ONE round.
    const locked = await client.query(
      `select status, round_id as "roundId" from shared_game where id = $1 for update`,
      [game.id]
    );
    if (locked.rows[0].status === "completed") {
      await client.query("COMMIT");
      return res.json({ ok: true, roundId: locked.rows[0].roundId });
    }
    if (locked.rows[0].status !== "open") {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "game is no longer open" });
    }

    const players = await client.query(
      `select slot, tag from shared_game_player where game_id = $1 order by slot`,
      [game.id]
    );
    const cells = await client.query(
      `select slot, hole, strokes from shared_score
        where game_id = $1 and strokes is not null`,
      [game.id]
    );
    // Same completeness rule as the solo Finish button: every player scored on
    // every hole.
    if (cells.rowCount < players.rowCount * HOLE_COUNT) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "not every hole is scored yet" });
    }

    // Slots are contiguous 0..n-1 (join assigns max+1 and the roster is frozen
    // once play starts), so tags in slot order ARE the positional player_tags.
    const tags = players.rows.map((p) => p.tag);
    const round = await client.query(
      `insert into round (course_id, player_tags, created_at, completed_at, client_id)
         values ($1, $2, $3, now(), $4)
       on conflict (client_id) do nothing
       returning id`,
      [game.courseId, tags, game.createdAt, `shared:${game.id}`]
    );
    let roundId;
    if (round.rowCount === 1) {
      roundId = round.rows[0].id;
      for (const cell of cells.rows) {
        await client.query(
          `insert into score (round_id, player_index, hole, strokes) values ($1, $2, $3, $4)
           on conflict (round_id, player_index, hole) do nothing`,
          [roundId, cell.slot, cell.hole, cell.strokes]
        );
      }
    } else {
      const existing = await client.query(`select id from round where client_id = $1`, [
        `shared:${game.id}`,
      ]);
      roundId = existing.rows[0].id;
    }
    await client.query(
      `update shared_game set status = 'completed', completed_at = now(), round_id = $2 where id = $1`,
      [game.id, roundId]
    );
    await client.query("COMMIT");
    publish(game.id, "game_completed", { roundId });
    return res.json({ ok: true, roundId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[games] complete error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});

// --- SSE stream ------------------------------------------------------------
router.get("/:id/events", async (req, res) => {
  try {
    const game = await loadParticipantGame(req.params.id, req.query?.participant);
    if (!game) return res.status(401).json({ ok: false, error: "unknown game or participant" });
    game.status = await expireIfStale(game);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell nginx not to buffer the stream (DEPLOY.md covers proxy_read_timeout).
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    // Full state on every (re)connect — no event-log replay to get wrong.
    sseSend(res, "snapshot", await buildSnapshot(game));

    const unsubscribe = subscribe(game.id, res);
    req.on("close", () => {
      unsubscribe();
      res.end();
    });
    void pool
      .query(`update shared_game_participant set last_seen_at = now() where id = $1`, [
        game.participantId,
      ])
      .catch(() => {});
  } catch (err) {
    console.error("[games] events error:", err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: "internal error" });
  }
});
