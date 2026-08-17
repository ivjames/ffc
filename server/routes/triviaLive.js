// Live trivia — one host, a room full of phones, one synchronized game.
//
//   POST /api/trivia/sessions                 create (signed-in) -> hostToken
//   POST /api/trivia/sessions/join            {joinCode, name, entrantId?}
//   GET  /api/trivia/sessions/:id             snapshot (?participant= or ?host=)
//   GET  /api/trivia/sessions/:id/events      SSE stream
//   POST /api/trivia/sessions/:id/answer      {participant, choice}
//   POST /api/trivia/sessions/:id/advance     {host}  next state
//   POST /api/trivia/sessions/:id/end         {host}
//
// Two capabilities, deliberately different:
//   hostToken     — created once, never leaves the host's device. Advancing
//                   the game, seeing answers, ending it.
//   participant   — one per DEVICE, handed out at join. Answering, watching.
// Both are bearer tokens in the shared-game tradition (lib/gameBus.js, and the
// SSE stream takes its token in the query string because EventSource cannot
// set headers).
//
// The invariant that matters most: THE ANSWER NEVER TRAVELS TO A PHONE THAT
// CAN STILL ANSWER. Player payloads go through publicQuestion() (which strips
// it) and nothing else; the answer appears only in host payloads and in the
// reveal, after the question has closed.
//
// Scoring is server-clock only. The elapsed time behind the speed bonus is
// measured from trivia_session.asked_at, never taken from the request — a
// client-supplied elapsed time is just a score the client chose for itself.
import { Router } from "express";
import { pool } from "../db.js";
import { requireUser } from "../lib/userAuth.js";
import { UUID_RE } from "../lib/validateLocation.js";
import { tenant, findTenantLocation } from "../lib/tenant.js";
import { moduleLive } from "../lib/modules.js";
import { generateJoinCode, normalizeJoinCode } from "../lib/joinCode.js";
import { subscribe, publish, sseSend } from "../lib/gameBus.js";
import { makeRateLimit } from "../lib/rateLimit.js";
import {
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  DEFAULT_QUESTIONS,
  MAX_ENTRANTS,
  MAX_ENTRANT_NAME,
  normalizeConfig,
  normalizeEntrantName,
  publicQuestion,
  revealedQuestion,
  scoreAnswer,
} from "../lib/triviaLive.js";

export const router = Router();

// A session left running this long is over — the host closed the laptop, the
// night ended. Checked lazily on access, like shared_game (no cron needed).
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Slack past the question's deadline before an answer is refused. Covers the
// round trip on venue wifi, so a tap that landed in time isn't rejected by its
// own latency; short enough that it can't be played as extra thinking time.
const ANSWER_GRACE_MS = 1500;

const joinLimit = makeRateLimit({ windowMs: 60_000, max: 60, name: "trivia join limit" });
const answerLimit = makeRateLimit({
  windowMs: 60_000,
  max: 120,
  keyFn: (req) => (typeof req.body?.participant === "string" ? req.body.participant : null),
  name: "trivia answer limit",
});

export function resetTriviaRateLimits() {
  joinLimit.reset();
  answerLimit.reset();
}

// The session projection, in two spellings: joined reads alias the table as
// `s`, INSERT/UPDATE ... RETURNING has no alias to qualify with. Written out
// twice on purpose — deriving one from the other by string surgery is the kind
// of cleverness that breaks silently the first time a column name contains the
// prefix being stripped.
const SESSION_FIELDS = `id, join_code as "joinCode", location_id as "locationId",
                        status, question_ids as "questionIds",
                        current_index as "currentIndex", asked_at as "askedAt",
                        config, created_at as "createdAt", ended_at as "endedAt"`;
const SESSION_COLS = SESSION_FIELDS.replace(/(^|,)(\s*)(\w+)/g, "$1$2s.$3");

// --- Loading + authorization ------------------------------------------------

/** Lazily abandon a session past its TTL. Returns the effective status. */
async function expireIfStale(session, q = pool) {
  if (session.status === "final" || session.status === "abandoned") return session.status;
  if (Date.now() - new Date(session.createdAt).getTime() < SESSION_TTL_MS) return session.status;
  await q.query(
    `update trivia_session set status = 'abandoned', ended_at = now()
      where id = $1 and status not in ('final','abandoned')`,
    [session.id]
  );
  return "abandoned";
}

/** Resolve a host token to its session; null on any mismatch. */
async function loadHostSession(id, hostToken) {
  if (typeof hostToken !== "string" || !UUID_RE.test(hostToken)) return null;
  if (!UUID_RE.test(id)) return null;
  const result = await pool.query(
    `select ${SESSION_COLS} from trivia_session s where s.id = $1 and s.host_token = $2`,
    [id, hostToken]
  );
  return result.rows[0] ?? null;
}

/** Resolve a participant token to its (session, entrant); null on mismatch. */
async function loadParticipant(id, token) {
  if (typeof token !== "string" || !UUID_RE.test(token)) return null;
  if (!UUID_RE.test(id)) return null;
  const result = await pool.query(
    `select p.id as "participantId", p.entrant_id as "entrantId", e.name as "entrantName",
            ${SESSION_COLS}
       from trivia_participant p
       join trivia_session s on s.id = p.session_id
       join trivia_entrant e on e.id = p.entrant_id
      where p.id = $1 and p.session_id = $2`,
    [token, id]
  );
  return result.rows[0] ?? null;
}

// --- Snapshots --------------------------------------------------------------

async function loadBoard(sessionId) {
  const result = await pool.query(
    `select e.id, e.name, e.is_team as "isTeam", e.score,
            (select count(*)::int from trivia_participant p where p.entrant_id = e.id) as devices
       from trivia_entrant e
      where e.session_id = $1
      order by e.score desc, e.created_at asc`,
    [sessionId]
  );
  return result.rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

async function currentQuestionRow(session) {
  const id = session.questionIds?.[session.currentIndex];
  if (!id) return null;
  const result = await pool.query(
    `select id, category, prompt, choices, answer from trivia_question where id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Build the snapshot for one audience. `forHost` decides whether the answer is
 * included — the single place that decision is made.
 */
async function buildSnapshot(session, { forHost, entrantId = null }) {
  const total = session.questionIds.length;
  const row = await currentQuestionRow(session);
  const board = await loadBoard(session.id);

  // The answer is visible to the host at all times (they read it out), and to
  // everyone once the question has closed. Never to a player mid-question.
  const revealed = forHost || session.status === "reveal" || session.status === "final";
  let question = null;
  if (row && (session.status === "question" || session.status === "reveal")) {
    question = revealed
      ? revealedQuestion(row, session.currentIndex, total)
      : publicQuestion(row, session.currentIndex, total);
  }

  // How many entrants have locked in — the host's "wait for stragglers?" cue,
  // and a nice tension bar on the players' screens. Counts only, never who.
  const answered = await pool.query(
    `select count(*)::int as n from trivia_answer
      where session_id = $1 and question_index = $2`,
    [session.id, session.currentIndex]
  );

  // This entrant's own answer, so a phone that reloads mid-question sees its
  // locked-in choice instead of a fresh set of buttons.
  let myAnswer = null;
  if (entrantId) {
    const mine = await pool.query(
      `select choice, correct, points from trivia_answer
        where session_id = $1 and entrant_id = $2 and question_index = $3`,
      [session.id, entrantId, session.currentIndex]
    );
    myAnswer = mine.rows[0] ?? null;
    // Correctness is withheld until the reveal, or a player could read their
    // own result and infer the answer while the question is still open.
    if (myAnswer && session.status === "question") {
      myAnswer = { choice: myAnswer.choice };
    }
  }

  return {
    session: {
      id: session.id,
      joinCode: session.joinCode,
      status: session.status,
      currentIndex: session.currentIndex,
      total,
      askedAt: session.askedAt,
      config: session.config,
    },
    question,
    board,
    answeredCount: answered.rows[0].n,
    entrantCount: board.length,
    myAnswer,
  };
}

/**
 * SSE channel for one audience of one session.
 *
 * The two audiences are SEPARATE CHANNELS, not one channel carrying both
 * payloads. That distinction is the whole answer-secrecy guarantee on the
 * stream: lib/gameBus.js fans a published frame out to every subscriber on the
 * channel, so a single `{player, host}` frame would put the correct answer on
 * the wire to every phone in the room. The client selecting `payload.player`
 * is a rendering choice, not a security boundary — anyone can open devtools
 * and read the frame.
 */
function channelFor(sessionId, forHost) {
  return `trivia:${sessionId}:${forHost ? "host" : "player"}`;
}

/** Push the new state to every connected device, each audience on its own
 *  channel so a player connection never receives the host payload. */
async function broadcast(session) {
  const [playerView, hostView] = await Promise.all([
    buildSnapshot(session, { forHost: false }),
    buildSnapshot(session, { forHost: true }),
  ]);
  publish(channelFor(session.id, false), "state", { player: playerView });
  publish(channelFor(session.id, true), "state", { host: hostView });
}

// --- Create -----------------------------------------------------------------

router.post("/sessions", requireUser, tenant(), async (req, res) => {
  const { locationId, questionCount, category, config: rawConfig } = req.body ?? {};
  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  const count = questionCount ?? DEFAULT_QUESTIONS;
  if (!Number.isInteger(count) || count < MIN_QUESTIONS || count > MAX_QUESTIONS) {
    return res.status(400).json({ ok: false, error: `questionCount must be ${MIN_QUESTIONS}..${MAX_QUESTIONS}` });
  }
  const configCheck = normalizeConfig(rawConfig);
  if (configCheck.error) return res.status(400).json({ ok: false, error: configCheck.error });

  try {
    const loc = await findTenantLocation(locationId, req.tenant, {
      cols: "id, org_id, pos, modules",
    });
    if (!loc) return res.status(404).json({ ok: false, error: "unknown location" });
    // The venue's plan has to include the arcade before we record arcade work
    // for it (lib/modules.js). The client route guard keeps players out of the
    // UI; this keeps a hand-rolled request out of the data.
    if (!moduleLive(loc, "arcade")) {
      return res.status(403).json({ ok: false, error: "the arcade is not enabled for this venue" });
    }

    // The bank this venue can draw on: the platform pack (org_id null) plus
    // this org's own questions, plus any written specifically for this venue.
    // A question belonging to another client is never in scope.
    const bank = await pool.query(
      `select id from trivia_question
        where archived_at is null and active
          and (org_id is null or org_id = $1)
          and (location_id is null or location_id = $2)
          and ($3::text is null or category = $3)
        order by random()
        limit $4`,
      [loc.org_id ?? null, locationId, typeof category === "string" && category ? category : null, count]
    );
    if (bank.rows.length < MIN_QUESTIONS) {
      return res.status(409).json({
        ok: false,
        error: `not enough questions in the bank (${bank.rows.length} available, ${MIN_QUESTIONS} needed)`,
      });
    }

    const questionIds = bank.rows.map((r) => r.id);
    // Retry on the partial-unique collision rather than pre-checking: the
    // window between "is this code free" and "insert" is exactly the race.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const inserted = await pool.query(
          `insert into trivia_session (location_id, join_code, created_by, question_ids, config)
           values ($1, $2, $3, $4::uuid[], $5::jsonb)
           returning ${SESSION_FIELDS}, host_token as "hostToken"`,
          [locationId, generateJoinCode(), req.user.id, questionIds, JSON.stringify(configCheck.config)]
        );
        const row = inserted.rows[0];
        return res.json({ ok: true, session: row, hostToken: row.hostToken });
      } catch (err) {
        if (err?.code !== "23505" || attempt === 4) throw err;
      }
    }
  } catch (err) {
    console.error("[trivia] create error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Join -------------------------------------------------------------------

router.post("/sessions/join", joinLimit, async (req, res) => {
  const code = normalizeJoinCode(req.body?.joinCode);
  if (!code) return res.status(400).json({ ok: false, error: "joinCode is required" });
  const { entrantId } = req.body ?? {};
  const name = normalizeEntrantName(req.body?.name);
  // Joining an EXISTING entrant (sitting down at a table already on the board)
  // needs no name; creating one does.
  if (!name && !entrantId) {
    return res.status(400).json({ ok: false, error: "name is required (1..32 characters)" });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Lock the session row: two phones joining the same new team name at the
    // same instant must not both create it.
    const found = await client.query(
      `select ${SESSION_COLS} from trivia_session s
        where s.join_code = $1 and s.status not in ('final','abandoned')
        for update`,
      [code]
    );
    const session = found.rows[0];
    if (!session) {
      await client.query("rollback");
      return res.status(404).json({ ok: false, error: "no live game with that code" });
    }
    if ((await expireIfStale(session, client)) === "abandoned") {
      await client.query("commit");
      return res.status(409).json({ ok: false, error: "that game has ended" });
    }

    let entrant;
    if (typeof entrantId === "string" && UUID_RE.test(entrantId)) {
      const existing = await client.query(
        `select id, name, is_team as "isTeam" from trivia_entrant
          where id = $1 and session_id = $2`,
        [entrantId, session.id]
      );
      entrant = existing.rows[0];
      if (!entrant) {
        await client.query("rollback");
        return res.status(404).json({ ok: false, error: "unknown team for this game" });
      }
    } else {
      const total = await client.query(
        `select count(*)::int as n from trivia_entrant where session_id = $1`,
        [session.id]
      );
      if (total.rows[0].n >= MAX_ENTRANTS) {
        await client.query("rollback");
        return res.status(409).json({ ok: false, error: "this game is full" });
      }
      // A name collision means two different things depending on intent, and
      // guessing wrong is costly either way:
      //
      //   Both sides say TEAM  -> "I'm sitting at that table". Merge: one
      //                           entrant, one score, one answer per question.
      //   Either side is SOLO  -> two people who happen to both be called Dave.
      //                           Merging them would pool their scores AND make
      //                           the one-answer-per-entrant rule refuse the
      //                           second Dave's answer with "already answered",
      //                           which is baffling from his side of the room.
      //
      // So solo joiners get a distinct entrant, disambiguated rather than
      // rejected — a walk-up player in a loud bar should not be sent back to
      // retype their name because a stranger shares it.
      const wantsTeam = Boolean(req.body?.isTeam);
      const existing = await client.query(
        `select id, name, is_team as "isTeam" from trivia_entrant
          where session_id = $1 and name = $2`,
        [session.id, name]
      );
      if (existing.rowCount > 0 && wantsTeam && existing.rows[0].isTeam) {
        entrant = existing.rows[0];
      } else {
        // Find a free name. Bounded by MAX_ENTRANTS, so the loop cannot run
        // away even if a whole room shares one name.
        let candidate = name;
        if (existing.rowCount > 0) {
          for (let n = 2; n <= MAX_ENTRANTS + 1; n++) {
            const suffixed = `${name} (${n})`.slice(0, MAX_ENTRANT_NAME);
            const taken = await client.query(
              `select 1 from trivia_entrant where session_id = $1 and name = $2`,
              [session.id, suffixed]
            );
            if (taken.rowCount === 0) {
              candidate = suffixed;
              break;
            }
          }
        }
        const created = await client.query(
          `insert into trivia_entrant (session_id, name, is_team)
           values ($1, $2, $3)
           returning id, name, is_team as "isTeam"`,
          [session.id, candidate, wantsTeam]
        );
        entrant = created.rows[0];
      }
    }

    const participant = await client.query(
      `insert into trivia_participant (session_id, entrant_id, app_user_id)
       values ($1, $2, $3) returning id`,
      [session.id, entrant.id, req.user?.id ?? null]
    );
    await client.query("commit");

    const snapshot = await buildSnapshot(session, { forHost: false, entrantId: entrant.id });
    // The roster changed — everyone's lobby list updates.
    await broadcast(session);
    return res.json({
      ok: true,
      participantToken: participant.rows[0].id,
      entrant,
      snapshot,
    });
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error("[trivia] join error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});

// --- Snapshot ---------------------------------------------------------------

router.get("/sessions/:id", async (req, res) => {
  const { id } = req.params;
  const hostToken = typeof req.query.host === "string" ? req.query.host : null;
  try {
    if (hostToken) {
      const session = await loadHostSession(id, hostToken);
      if (!session) return res.status(404).json({ ok: false, error: "unknown session" });
      await expireIfStale(session);
      return res.json({ ok: true, ...(await buildSnapshot(session, { forHost: true })) });
    }
    const ctx = await loadParticipant(id, req.query.participant);
    if (!ctx) return res.status(404).json({ ok: false, error: "unknown session" });
    await expireIfStale(ctx);
    return res.json({
      ok: true,
      entrant: { id: ctx.entrantId, name: ctx.entrantName },
      ...(await buildSnapshot(ctx, { forHost: false, entrantId: ctx.entrantId })),
    });
  } catch (err) {
    console.error("[trivia] snapshot error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- SSE --------------------------------------------------------------------

router.get("/sessions/:id/events", async (req, res) => {
  const { id } = req.params;
  const hostToken = typeof req.query.host === "string" ? req.query.host : null;
  let session = null;
  let entrantId = null;
  let forHost = false;
  try {
    if (hostToken) {
      session = await loadHostSession(id, hostToken);
      forHost = true;
    } else {
      const ctx = await loadParticipant(id, req.query.participant);
      if (ctx) {
        session = ctx;
        entrantId = ctx.entrantId;
      }
    }
  } catch (err) {
    console.error("[trivia] stream auth error:", err);
    return res.status(500).end();
  }
  if (!session) return res.status(404).json({ ok: false, error: "unknown session" });

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    // nginx buffers proxied responses by default, which would hold every
    // question until the buffer filled — the whole point is simultaneity.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  // Subscribe to THIS audience's channel only — a player connection is never
  // on the host channel, so the answer cannot reach it even as unread bytes.
  const unsubscribe = subscribe(channelFor(id, forHost), res);
  req.on("close", unsubscribe);

  // Open with the current state so a device that connects mid-question isn't
  // staring at a blank screen until the host advances.
  try {
    const snapshot = await buildSnapshot(session, { forHost, entrantId });
    sseSend(res, "state", forHost ? { host: snapshot } : { player: snapshot });
  } catch (err) {
    console.error("[trivia] stream open error:", err);
  }
});

// --- Answer -----------------------------------------------------------------

router.post("/sessions/:id/answer", answerLimit, async (req, res) => {
  const ctx = await loadParticipant(req.params.id, req.body?.participant).catch(() => null);
  if (!ctx) return res.status(404).json({ ok: false, error: "unknown session" });
  const { choice } = req.body ?? {};
  if (!Number.isInteger(choice) || choice < 0 || choice > 5) {
    return res.status(400).json({ ok: false, error: "choice must be a choice index" });
  }
  if (ctx.status !== "question") {
    return res.status(409).json({ ok: false, error: "no question is open" });
  }

  try {
    const row = await currentQuestionRow(ctx);
    if (!row) return res.status(409).json({ ok: false, error: "no question is open" });
    if (choice >= row.choices.length) {
      return res.status(400).json({ ok: false, error: "choice is out of range" });
    }

    // Server clock, always: elapsed comes from asked_at, never the request.
    const msElapsed = ctx.askedAt ? Date.now() - new Date(ctx.askedAt).getTime() : 0;

    // The countdown has to actually close answers. Checking only "has the host
    // advanced?" meant the configured question length was decorative: while a
    // host chatted before hitting reveal, the timer sat at 0:00 on every phone
    // and answers were still accepted — which quietly deletes the speed bonus
    // as a mechanic, since waiting costs nothing.
    //
    // The grace window is for the network, not the player: a tap at 19.9s on a
    // busy venue wifi must not be thrown away by its own latency.
    const deadlineMs = ctx.config.questionSeconds * 1000 + ANSWER_GRACE_MS;
    if (ctx.askedAt && msElapsed > deadlineMs) {
      return res.status(409).json({ ok: false, error: "time's up on that question" });
    }

    const correct = choice === row.answer;
    const points = scoreAnswer(correct, msElapsed, ctx.config);

    // ON CONFLICT DO NOTHING against the (session, entrant, question) primary
    // key IS the one-answer-per-team rule: at a table where three people tap,
    // the first lands and the rest are refused. Without it a team could
    // brute-force every choice.
    const inserted = await pool.query(
      `insert into trivia_answer
         (session_id, entrant_id, question_index, choice, correct, points, ms_elapsed, answered_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (session_id, entrant_id, question_index) do nothing
       returning choice`,
      [ctx.id, ctx.entrantId, ctx.currentIndex, choice, correct, points, msElapsed, ctx.participantId]
    );
    if (inserted.rowCount === 0) {
      return res.status(409).json({ ok: false, error: "already answered" });
    }

    if (points > 0) {
      await pool.query(`update trivia_entrant set score = score + $1 where id = $2`, [
        points,
        ctx.entrantId,
      ]);
    }

    // Tell the room how many have locked in — but not who, and not whether
    // this one was right: the question is still open.
    await broadcast(ctx);
    return res.json({ ok: true, locked: choice });
  } catch (err) {
    console.error("[trivia] answer error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Host controls ----------------------------------------------------------

/**
 * One step of the state machine:
 *   lobby    -> question (index 0, clock starts)
 *   question -> reveal   (answers close, correctness lands)
 *   reveal   -> question (next) | final (that was the last one)
 */
router.post("/sessions/:id/advance", async (req, res) => {
  const session = await loadHostSession(req.params.id, req.body?.host).catch(() => null);
  if (!session) return res.status(404).json({ ok: false, error: "unknown session" });
  if (session.status === "final" || session.status === "abandoned") {
    return res.status(409).json({ ok: false, error: "that game has ended" });
  }

  try {
    let next;
    if (session.status === "lobby") {
      next = { status: "question", currentIndex: 0, askedAt: new Date() };
    } else if (session.status === "question") {
      next = { status: "reveal", currentIndex: session.currentIndex, askedAt: session.askedAt };
    } else {
      const following = session.currentIndex + 1;
      next =
        following >= session.questionIds.length
          ? { status: "final", currentIndex: session.currentIndex, askedAt: null }
          : { status: "question", currentIndex: following, askedAt: new Date() };
    }

    const updated = await pool.query(
      `update trivia_session
          set status = $1, current_index = $2, asked_at = $3,
              ended_at = case when $1 = 'final' then now() else ended_at end
        where id = $4
        returning ${SESSION_FIELDS}`,
      [next.status, next.currentIndex, next.askedAt, session.id]
    );
    const fresh = updated.rows[0];
    await broadcast(fresh);
    return res.json({ ok: true, ...(await buildSnapshot(fresh, { forHost: true })) });
  } catch (err) {
    console.error("[trivia] advance error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.post("/sessions/:id/end", async (req, res) => {
  const session = await loadHostSession(req.params.id, req.body?.host).catch(() => null);
  if (!session) return res.status(404).json({ ok: false, error: "unknown session" });
  try {
    const updated = await pool.query(
      `update trivia_session set status = 'final', ended_at = now()
        where id = $1 returning ${SESSION_FIELDS}`,
      [session.id]
    );
    const fresh = updated.rows[0];
    await broadcast(fresh);
    return res.json({ ok: true, ...(await buildSnapshot(fresh, { forHost: true })) });
  } catch (err) {
    console.error("[trivia] end error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Categories -------------------------------------------------------------
// What a host can pick from when starting a game at this venue.

router.get("/categories", tenant(), async (req, res) => {
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : null;
  if (!locationId || !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  try {
    const loc = await findTenantLocation(locationId, req.tenant, { cols: "id, org_id" });
    if (!loc) return res.status(404).json({ ok: false, error: "unknown location" });
    const result = await pool.query(
      `select category, count(*)::int as n from trivia_question
        where archived_at is null and active
          and (org_id is null or org_id = $1)
          and (location_id is null or location_id = $2)
        group by category order by category`,
      [loc.org_id ?? null, locationId]
    );
    return res.json({ ok: true, categories: result.rows });
  } catch (err) {
    console.error("[trivia] categories error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
