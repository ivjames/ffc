// Dealing a live-trivia session: pick the questions, mint the room.
//
// This lives apart from the routes because CREATING a game is a staff action
// on the admin surface while everything after it — joining, answering,
// advancing — is player-facing and driven by the capability tokens minted
// here. The split is the point: hosting a room means seeing every correct
// answer, so it cannot be something any signed-in player can do. Left on the
// player API, a guest could open rooms of their own and read the answers out
// of the host snapshot until they had learned the venue's whole bank.
import { pool } from "../db.js";
import { generateJoinCode } from "./joinCode.js";
import { MIN_QUESTIONS } from "./triviaLive.js";

const SESSION_FIELDS = `id, join_code as "joinCode", location_id as "locationId",
                        status, question_ids as "questionIds", questions,
                        current_index as "currentIndex", asked_at as "askedAt",
                        config, created_at as "createdAt", ended_at as "endedAt"`;

/**
 * Deal a session for an ALREADY-AUTHORIZED location.
 *
 * The caller resolves and authorizes `loc` (it needs `id` and `org_id`),
 * because the two surfaces answer that question differently — the admin route
 * by org scope, anything else by tenant. This function only deals the cards.
 *
 * Returns `{ session, hostToken, requested, dealt }`, or `{ error, status }`.
 * `session` never carries the dealt `questions` — those hold the answers and
 * are the server's working copy.
 */
export async function dealSession(loc, { count, category, config }) {
  // The bank this venue can draw on: the platform pack (org_id null) plus this
  // org's own questions, plus any written specifically for this venue. A
  // question belonging to another client is never in scope.
  const bank = await pool.query(
    `select id, category, prompt, choices, answer from trivia_question
      where archived_at is null and active
        and (org_id is null or org_id = $1)
        and (location_id is null or location_id = $2)
        and ($3::text is null or category = $3)
      order by random()
      limit $4`,
    [loc.org_id ?? null, loc.id, typeof category === "string" && category ? category : null, count]
  );
  if (bank.rows.length < MIN_QUESTIONS) {
    return {
      status: 409,
      error: `not enough questions in the bank (${bank.rows.length} available, ${MIN_QUESTIONS} needed)`,
    };
  }

  const questionIds = bank.rows.map((r) => r.id);
  // Retry on the partial-unique collision rather than pre-checking: the window
  // between "is this code free" and "insert" is exactly the race.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const inserted = await pool.query(
        `insert into trivia_session
           (location_id, join_code, question_ids, questions, config)
         values ($1, $2, $3::uuid[], $4::jsonb, $5::jsonb)
         returning ${SESSION_FIELDS}, host_token as "hostToken"`,
        [
          loc.id,
          generateJoinCode(),
          questionIds,
          JSON.stringify(bank.rows),
          JSON.stringify(config),
        ]
      );
      const { questions, ...session } = inserted.rows[0];
      return {
        session,
        hostToken: session.hostToken,
        // A category can hold fewer questions than the host asked for. Dealing
        // what exists beats refusing to start a game in front of a room, but
        // the host configured a length and is entitled to know it changed — so
        // the shortfall is stated rather than left to be noticed at question
        // 12 of "20".
        requested: count,
        dealt: questionIds.length,
      };
    } catch (err) {
      if (err?.code !== "23505" || attempt === 4) throw err;
    }
  }
  return { status: 500, error: "could not allocate a join code" };
}
