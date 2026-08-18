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
import { moduleLive, locationModuleLive } from "../lib/modules.js";
import { dealSession } from "../lib/triviaDeal.js";
import { generateJoinCode, normalizeJoinCode } from "../lib/joinCode.js";
import { subscribe, publish, sseSend } from "../lib/gameBus.js";
import { makeRateLimit } from "../lib/rateLimit.js";
import {
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  DEFAULT_QUESTIONS,
  DEFAULT_SECONDS,
  DEFAULT_REVEAL_SECONDS,
  DEFAULT_LOBBY_SECONDS,
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

// Anyone may open a room, so the brake is here rather than on a staff role:
// enough for a venue's evening, nowhere near enough to enumerate the bank by
// dealing rooms — and dealing one tells you nothing anyway.
const createLimit = makeRateLimit({
  windowMs: 60_000,
  max: 10,
  keyFn: (req) => req.user?.id ?? null,
  name: "trivia create limit",
});
const joinLimit = makeRateLimit({ windowMs: 60_000, max: 60, name: "trivia join limit" });
const answerLimit = makeRateLimit({
  windowMs: 60_000,
  max: 120,
  keyFn: (req) => (typeof req.body?.participant === "string" ? req.body.participant : null),
  name: "trivia answer limit",
});

export function resetTriviaRateLimits() {
  createLimit.reset();
  joinLimit.reset();
  answerLimit.reset();
}

// The session projection, in two spellings: joined reads alias the table as
// `s`, INSERT/UPDATE ... RETURNING has no alias to qualify with. Written out
// twice on purpose — deriving one from the other by string surgery is the kind
// of cleverness that breaks silently the first time a column name contains the
// prefix being stripped.
// Exported for the integration test, which builds the row the TICKER holds —
// a session read before the host's tap landed — so it can drive a genuinely
// stale transition through autoAdvanceIfDue rather than re-implementing the
// predicate that rejects it.
export const SESSION_FIELDS = `id, join_code as "joinCode", location_id as "locationId",
                        status, question_ids as "questionIds", questions,
                        current_index as "currentIndex", asked_at as "askedAt",
                        auto_at as "autoAt",
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

/**
 * The current question, as DEALT — read from the session's own copy, not from
 * the bank it was drawn out of.
 *
 * The bank stays editable while a game is running, so re-reading it meant an
 * admin's edit could land mid-round: answers a second apart scored against
 * different correct choices, and the prompt on every phone in the room
 * replaced between the ask and the reveal.
 *
 * `q` lets the answer path read inside its own transaction — using the pool
 * there would read outside the row lock it is holding. It is only needed by
 * the fallback below, which serves sessions that were already in a lobby when
 * this column was added; those have no copy to read.
 */
async function currentQuestionRow(session, q = pool) {
  const dealt = session.questions?.[session.currentIndex];
  if (dealt) return dealt;
  const id = session.questionIds?.[session.currentIndex];
  if (!id) return null;
  const result = await q.query(
    `select id, category, prompt, choices, answer from trivia_question where id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Build the snapshot. `entrantId` personalizes `myAnswer` and nothing else —
 * there is no longer a host/player split to make, because the answer's
 * visibility is decided by the game's PHASE rather than by who is asking.
 */
async function buildSnapshot(session, { entrantId = null } = {}) {
  const total = session.questionIds.length;
  const row = await currentQuestionRow(session);
  const board = await loadBoard(session.id);

  // The answer is visible once the question has CLOSED, and to nobody before
  // then — the host included. Handing it to the host early was the one thing
  // that made a room worth stealing, and it bought nothing: an MC announces
  // the answer at the reveal, which is exactly when this releases it.
  const revealed = session.status === "reveal" || session.status === "final";
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
      // When this phase moves itself along. The room needs it to render the
      // "starts in 0:42" the lobby runs on — without it a self-running game
      // looks like a stuck one.
      autoAt: session.autoAt ?? null,
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
 * SSE channel for one session — ONE channel now, carrying one frame.
 *
 * This used to be two, split by audience, because the host frame carried the
 * correct answer and lib/gameBus.js fans a published frame out to every
 * subscriber on its channel: a single combined frame would have put the answer
 * on the wire to every phone in the room. Nothing carries the answer early any
 * more, so there is no second payload to keep apart — and one frame per change
 * means the host's screen and the players' cannot disagree about the room.
 */
function channelFor(sessionId) {
  return `trivia:${sessionId}`;
}

/** Push the new state to every connected device. The frame is viewer-neutral
 *  (no `myAnswer`); each phone folds its own answer in client-side. */
async function broadcast(session) {
  publish(channelFor(session.id), "state", await buildSnapshot(session));
}

/** Re-read a session and push its CURRENT state to the room. For the paths
 *  that change status as a side effect (expiry) and would otherwise leave
 *  every connected phone rendering a state that no longer exists. */
async function broadcastById(sessionId) {
  const result = await pool.query(
    `select ${SESSION_COLS} from trivia_session s where s.id = $1`,
    [sessionId]
  );
  if (result.rows[0]) await broadcast(result.rows[0]);
}

// --- Create -----------------------------------------------------------------
//
// Open to any signed-in player, and that is now a safe thing to say. A room
// confers no informational advantage over the people in it: the answer is
// released by the game's PHASE, so the host token that comes back can pace the
// room and nothing else. Hosting briefly lived behind the Master Control gate,
// back when the host payload carried answers — the gate was the wrong fix for
// a privilege that should never have existed.
router.post("/sessions", requireUser, tenant(), createLimit, async (req, res) => {
  const { locationId, questionCount, category, config: rawConfig } = req.body ?? {};
  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  const count = questionCount ?? DEFAULT_QUESTIONS;
  if (!Number.isInteger(count) || count < MIN_QUESTIONS || count > MAX_QUESTIONS) {
    return res
      .status(400)
      .json({ ok: false, error: `questionCount must be ${MIN_QUESTIONS}..${MAX_QUESTIONS}` });
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
    const dealt = await dealSession(loc, {
      count,
      category,
      config: configCheck.config,
      createdBy: req.user.id,
    });
    if (dealt.error) return res.status(dealt.status).json({ ok: false, error: dealt.error });
    return res.json({ ok: true, ...dealt });
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
    // A trivia room outlives its create call by a whole evening, so the
    // entitlement is rechecked on every join rather than assumed from setup.
    if (!(await locationModuleLive(client, session.locationId, "arcade"))) {
      await client.query("rollback");
      return res.status(403).json({ ok: false, error: "the arcade is not enabled for this venue" });
    }

    let entrant;
    if (typeof entrantId === "string" && UUID_RE.test(entrantId)) {
      // TEAMS ONLY, and that clause is a security boundary rather than a
      // nicety. Every phone in the room is sent the full board, entrant ids
      // included, so without `is_team` any participant could join as another
      // SOLO player: the token minted below is bound to whatever entrant is
      // named here, and one entrant answers once, so the impersonator could
      // answer first and spend the victim's turn on a wrong choice.
      //
      // A team is different in kind, not degree: it is a table that several
      // devices are meant to share, and holding the join code is exactly the
      // claim to sit at one.
      const existing = await client.query(
        `select id, name, is_team as "isTeam" from trivia_entrant
          where id = $1 and session_id = $2 and is_team = true`,
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
            // Trim the BASE to make room for the suffix, never the joined
            // string: slicing afterwards gives a max-length name back its
            // original 32 characters, so the "disambiguated" name collides
            // with the one it was meant to differ from and the insert 500s.
            const suffix = ` (${n})`;
            const suffixed = name.slice(0, MAX_ENTRANT_NAME - suffix.length) + suffix;
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

    // The lobby's clock starts when the FIRST person walks in, not when the
    // room was made: a code read out ten minutes before anyone arrives should
    // not burn the whole wait, and a room nobody joins should never start.
    // Only ever set once — later arrivals don't push the start back, or a busy
    // room would never get going.
    let fresh = session;
    if (session.status === "lobby" && !session.autoAt) {
      const started = await client.query(
        `update trivia_session
            set auto_at = now() + make_interval(secs => $2::int)
          where id = $1 and status = 'lobby' and auto_at is null
          returning ${SESSION_FIELDS}`,
        [session.id, session.config?.lobbySeconds ?? DEFAULT_LOBBY_SECONDS]
      );
      if (started.rows[0]) fresh = started.rows[0];
    }
    await client.query("commit");

    const snapshot = await buildSnapshot(fresh, { entrantId: entrant.id });
    // The roster changed — everyone's lobby list updates.
    await broadcast(fresh);
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
    // expireIfStale can CHANGE the status, so the snapshot has to be built
    // from the effective one — building it from the row we loaded a moment ago
    // tells a reconnecting host the expired game is live, and then refuses
    // their very next tap. Cheap to apply: the status is all that moved.
    if (hostToken) {
      const session = await loadHostSession(id, hostToken);
      if (!session) return res.status(404).json({ ok: false, error: "unknown session" });
      const status = await expireIfStale(session);
      // A phone reconnecting to a room nobody has touched should see where the
      // CLOCK says the game is, not where it was parked — same lazy treatment
      // the TTL gets, and it keeps a room correct even if the ticker is down.
      const effective = (await autoAdvanceIfDue({ ...session, status })) ?? { ...session, status };
      return res.json({ ok: true, ...(await buildSnapshot(effective)) });
    }
    const ctx = await loadParticipant(id, req.query.participant);
    if (!ctx) return res.status(404).json({ ok: false, error: "unknown session" });
    const status = await expireIfStale(ctx);
    const effective = (await autoAdvanceIfDue({ ...ctx, status })) ?? { ...ctx, status };
    return res.json({
      ok: true,
      entrant: { id: ctx.entrantId, name: ctx.entrantName },
      ...(await buildSnapshot(effective, { entrantId: ctx.entrantId })),
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
  try {
    if (hostToken) {
      session = await loadHostSession(id, hostToken);
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

  // One channel for the room: the frame is the same for everyone on it,
  // because nothing in it depends on who is reading.
  const unsubscribe = subscribe(channelFor(id), res);
  req.on("close", unsubscribe);

  // Open with the current state so a device that connects mid-question isn't
  // staring at a blank screen until the game moves on.
  try {
    const now = (await autoAdvanceIfDue(session)) ?? session;
    sseSend(res, "state", await buildSnapshot(now, { entrantId }));
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
  // The participant lookup above resolved the session as it was a moment ago.
  // Everything that decides whether this answer counts is re-read below under
  // a row lock, because the host can advance between the two.
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Lock the session row for the duration. `advance` UPDATEs the same row,
    // so the two serialize: an answer either lands wholly before the host
    // closes the question or is refused. Without this, an answer could be
    // scored against a question that had already been revealed — and, worse,
    // the broadcast below would republish a stale `status: "question"` and roll
    // every phone in the room back out of the reveal.
    const locked = await client.query(
      `select ${SESSION_COLS} from trivia_session s where s.id = $1 for update`,
      [ctx.id]
    );
    const session = locked.rows[0];
    if (!session || session.status !== "question") {
      await client.query("rollback");
      return res.status(409).json({ ok: false, error: "no question is open" });
    }
    // Expiry is enforced HERE too, not only on join/snapshot. A room whose
    // clients stay connected over SSE never re-joins and never re-fetches, so
    // the 12-hour TTL would otherwise never fire for the people still in it —
    // a session left overnight could be resumed and scored indefinitely.
    if ((await expireIfStale(session, client)) === "abandoned") {
      await client.query("commit");
      // Tell the room. Without this the phones sit on the old question
      // forever, and the player UI treats the 409 as "a teammate got there
      // first" — so the game looks live and every tap is dead.
      await broadcastById(session.id);
      return res.status(409).json({ ok: false, error: "that game has ended" });
    }
    // And the module: a room outlives its create call, so the entitlement is
    // rechecked on every scoring mutation.
    if (!(await locationModuleLive(client, session.locationId, "arcade"))) {
      await client.query("rollback");
      return res.status(403).json({ ok: false, error: "the arcade is not enabled for this venue" });
    }

    const row = await currentQuestionRow(session, client);
    if (!row) {
      await client.query("rollback");
      return res.status(409).json({ ok: false, error: "no question is open" });
    }
    if (choice >= row.choices.length) {
      await client.query("rollback");
      return res.status(400).json({ ok: false, error: "choice is out of range" });
    }

    // Server clock, always: elapsed comes from asked_at, never the request.
    const msElapsed = session.askedAt ? Date.now() - new Date(session.askedAt).getTime() : 0;

    // The countdown has to actually close answers. Checking only "has the host
    // advanced?" meant the configured question length was decorative: while a
    // host chatted before hitting reveal, the timer sat at 0:00 on every phone
    // and answers were still accepted — which quietly deletes the speed bonus
    // as a mechanic, since waiting costs nothing.
    //
    // The grace window is for the network, not the player: a tap at 19.9s on a
    // busy venue wifi must not be thrown away by its own latency.
    const deadlineMs = session.config.questionSeconds * 1000 + ANSWER_GRACE_MS;
    if (session.askedAt && msElapsed > deadlineMs) {
      await client.query("rollback");
      return res.status(409).json({ ok: false, error: "time's up on that question" });
    }

    const correct = choice === row.answer;
    const points = scoreAnswer(correct, msElapsed, session.config);

    // ON CONFLICT DO NOTHING against the (session, entrant, question) primary
    // key IS the one-answer-per-team rule: at a table where three people tap,
    // the first lands and the rest are refused. Without it a team could
    // brute-force every choice.
    const inserted = await client.query(
      `insert into trivia_answer
         (session_id, entrant_id, question_index, choice, correct, points, ms_elapsed, answered_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (session_id, entrant_id, question_index) do nothing
       returning choice`,
      [session.id, ctx.entrantId, session.currentIndex, choice, correct, points, msElapsed, ctx.participantId]
    );
    if (inserted.rowCount === 0) {
      await client.query("rollback");
      return res.status(409).json({ ok: false, error: "already answered" });
    }

    if (points > 0) {
      await client.query(`update trivia_entrant set score = score + $1 where id = $2`, [
        points,
        ctx.entrantId,
      ]);
    }
    await client.query("commit");

    // Tell the room how many have locked in — but not who, and not whether
    // this one was right: the question is still open.
    //
    // Re-read AFTER the commit, not the row we held under the lock. The lock
    // orders the two writes but is released by the commit, so a host advance
    // waiting on it can update to 'reveal' and publish in the gap before this
    // line runs — and publishing the locked (now stale) row last would drag
    // the whole room back out of the reveal. Reading fresh shrinks that to a
    // race we can't win here at all; the client drops out-of-order frames
    // outright (isFresh in src/lib/triviaLiveApi.ts), which is what actually
    // closes it.
    const latest = await pool.query(
      `select ${SESSION_COLS} from trivia_session s where s.id = $1`,
      [session.id]
    );
    await broadcast(latest.rows[0] ?? session);
    return res.json({ ok: true, locked: choice });
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error("[trivia] answer error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});

// --- Host controls ----------------------------------------------------------

/**
 * One step of the state machine:
 *   lobby    -> question (index 0, clock starts)
 *   question -> reveal   (answers close, correctness lands)
 *   reveal   -> question (next) | final (that was the last one)
 */
/**
 * Where the game goes next from `session`, and when that next phase should
 * move itself along.
 *
 * Pure, so the host's tap and the autopilot's tick cannot disagree about what
 * "next" means — the only difference between them is what makes the call.
 */
function nextPhase(session) {
  const cfg = session.config ?? {};
  const after = (seconds) => new Date(Date.now() + seconds * 1000);
  if (session.status === "lobby") {
    return { status: "question", currentIndex: 0, ...openQuestion(cfg) };
  }
  if (session.status === "question") {
    return {
      status: "reveal",
      currentIndex: session.currentIndex,
      askedAt: session.askedAt,
      autoAt: after(cfg.revealSeconds ?? DEFAULT_REVEAL_SECONDS),
    };
  }
  const following = session.currentIndex + 1;
  // The last reveal ends the game rather than dealing a question that isn't
  // there — and a final board waits for nobody, so it has no deadline.
  return following >= session.questionIds.length
    ? { status: "final", currentIndex: session.currentIndex, askedAt: null, autoAt: null }
    : { status: "question", currentIndex: following, ...openQuestion(cfg) };
}

/**
 * Open a question: when it was asked, and when the clock should close it.
 *
 * The deadline sits ANSWER_GRACE_MS past the configured length, and that is
 * not slack for the player — it is the same network allowance the answer
 * handler applies. Closing the phase exactly on the configured length would
 * flip the session to `reveal` while a tap made at 19.9s was still in flight,
 * and the handler's status check would refuse it before ever reaching the
 * grace calculation. The allowance would then hold or not depending on how the
 * ticker's second happened to line up, which is no allowance at all.
 *
 * Players never see this: their countdown runs off asked_at and the configured
 * length, so the extra second and a half is invisible slack, exactly as it was
 * when only a human closed the question.
 */
function openQuestion(cfg) {
  const askedAt = new Date();
  const lengthMs = (cfg.questionSeconds ?? DEFAULT_SECONDS) * 1000;
  return { askedAt, autoAt: new Date(askedAt.getTime() + lengthMs + ANSWER_GRACE_MS) };
}

/**
 * Apply one transition, predicated on the status it was computed FROM.
 *
 * That predicate is what makes the host and the autopilot safe to run against
 * each other: a host tapping "reveal" at the same instant the clock closes the
 * question means two transitions computed from the same state, and only the
 * first can land. The loser sees rowCount 0 and reports where the game
 * actually is instead of writing a stale next-state over it.
 *
 * It takes BOTH the status and the index, because status alone repeats. A
 * stalled actor holding (question, 0) would otherwise still match a room that
 * had moved on to (question, 1) — and its transition, computed against the
 * question before last, would drag the whole room back a question and reveal
 * the wrong answer. Together the two are a version: within a session the index
 * only ever grows, so a (status, index) pair never comes round again.
 */
async function applyPhase(session, next) {
  const updated = await pool.query(
    `update trivia_session
        set status = $1, current_index = $2, asked_at = $3, auto_at = $4,
            ended_at = case when $1 = 'final' then now() else ended_at end
      where id = $5 and status = $6 and current_index = $7
      returning ${SESSION_FIELDS}`,
    [
      next.status,
      next.currentIndex,
      next.askedAt,
      next.autoAt,
      session.id,
      session.status,
      session.currentIndex,
    ]
  );
  return updated.rows[0] ?? null;
}

/**
 * Move a session on if its phase has outlived its deadline. Returns the fresh
 * row when it moved, else null.
 *
 * Called from the read paths as well as the ticker, in the same lazy style as
 * expireIfStale: a phone that reconnects to a room nobody has touched should
 * see where the clock says the game is, not where it was parked.
 */
export async function autoAdvanceIfDue(session) {
  if (!session?.autoAt) return null;
  if (session.status === "final" || session.status === "abandoned") return null;
  if (new Date(session.autoAt).getTime() > Date.now()) return null;
  const fresh = await applyPhase(session, nextPhase(session));
  if (fresh) await broadcast(fresh);
  return fresh;
}

/**
 * The clock that lets a room run unattended.
 *
 * Not started by importing this module — app.js is imported by every
 * integration test, and a timer firing under a test suite would advance games
 * out from under assertions. index.js starts it for the real server; tests
 * drive autoAdvanceIfDue directly.
 */
let autopilot = null;
export function startTriviaAutopilot({ intervalMs = 1000 } = {}) {
  if (autopilot) return autopilot;
  autopilot = setInterval(() => {
    void tickAutopilot().catch((err) => console.error("[trivia] autopilot:", err));
  }, intervalMs);
  autopilot.unref?.();
  return autopilot;
}

export function stopTriviaAutopilot() {
  if (autopilot) clearInterval(autopilot);
  autopilot = null;
}

/** One sweep: advance every live session whose phase is out of time. */
export async function tickAutopilot() {
  const due = await pool.query(
    `select ${SESSION_COLS} from trivia_session s
      where s.status in ('lobby','question','reveal')
        and s.auto_at is not null and s.auto_at <= now()
      limit 50`
  );
  for (const session of due.rows) {
    await autoAdvanceIfDue(session).catch((err) =>
      console.error("[trivia] autopilot advance failed:", err)
    );
  }
  return due.rowCount;
}

router.post("/sessions/:id/advance", async (req, res) => {
  const session = await loadHostSession(req.params.id, req.body?.host).catch(() => null);
  if (!session) return res.status(404).json({ ok: false, error: "unknown session" });
  if (session.status === "final" || session.status === "abandoned") {
    return res.status(409).json({ ok: false, error: "that game has ended" });
  }

  try {
    // The host can sit on a lobby or a reveal indefinitely, and their own
    // screen holds an SSE connection rather than re-fetching — so without this
    // the TTL never fires for the one person who can restart the game.
    if ((await expireIfStale(session)) === "abandoned") {
      await broadcastById(session.id);
      return res.status(409).json({ ok: false, error: "that game has ended" });
    }
    if (!(await locationModuleLive(pool, session.locationId, "arcade"))) {
      return res.status(403).json({ ok: false, error: "the arcade is not enabled for this venue" });
    }
    // The host's button is a SHORTCUT, not the engine: the same transition the
    // clock would have made, made early. Sharing nextPhase/applyPhase with the
    // autopilot is what stops the two from ever disagreeing about "next".
    const fresh = await applyPhase(session, nextPhase(session));
    if (!fresh) {
      // The autopilot got there first, or the host ended the game from another
      // tab. Answer with where it actually IS rather than an error they can do
      // nothing about — from the host's side the tap simply had no work left.
      const current = await pool.query(
        `select ${SESSION_COLS} from trivia_session s where s.id = $1`,
        [session.id]
      );
      const now = current.rows[0];
      if (!now) return res.status(404).json({ ok: false, error: "unknown session" });
      return res.json({ ok: true, ...(await buildSnapshot(now)) });
    }
    await broadcast(fresh);
    return res.json({ ok: true, ...(await buildSnapshot(fresh)) });
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
      `update trivia_session set status = 'final', ended_at = now(), auto_at = null
        where id = $1 returning ${SESSION_FIELDS}`,
      [session.id]
    );
    const fresh = updated.rows[0];
    await broadcast(fresh);
    return res.json({ ok: true, ...(await buildSnapshot(fresh)) });
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
