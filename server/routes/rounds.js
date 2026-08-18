// POST /api/rounds — idempotent sync of a completed round from a device.
//
// The client is offline-first: it holds active rounds in IndexedDB and, when a
// round completes, POSTs it here with a stable `clientId`. Re-syncs (retries,
// multiple devices, flaky network) must NOT create duplicates — we UPSERT on
// round.client_id inside a transaction.
import { Router } from "express";
import { pool } from "../db.js";
import { validateTags, isValidTag } from "../lib/sanitize.js";
import { makeRateLimit } from "../lib/rateLimit.js";
import { huntAchievements, scoreAchievements } from "../lib/rewards.js";
import { domainEvents, ROUND_COMPLETED } from "../lib/events.js";
import { resolveSynthetic, syntheticMintsRewards } from "../lib/syntheticConfig.js";
import { tenant, findTenantCourse } from "../lib/tenant.js";

export const router = Router();

// Writes are anonymous, so cap how often a single IP can POST (in-memory
// fixed-window — see lib/rateLimit.js for the multi-process caveat).
const rateLimit = makeRateLimit({ windowMs: 60_000, max: 30, name: "rate limit" });

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
export async function grantRewards(client, { roundId, clientId, courseId, playerTags, scoreRows, pars, appUserId = null }) {
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
  // Hunt finds are keyed by tag, not roster position — credit the first roster
  // slot with that tag (duplicate tags can't be told apart anyway).
  const slotOf = (tag) => playerTags.indexOf(tag);
  const completedTags = new Set();
  for (const { tag } of huntDone.rows) {
    completedTags.add(tag);
    const playerIndex = slotOf(tag);
    if (playerIndex !== -1) grants.push({ playerIndex, achievement: "hunt_master" });
  }

  // The rest of the hunt badges, from this round's submissions. Rules live in
  // lib/rewards.js so they're unit-testable without a DB; this only supplies
  // the rows (every submission, verified or not — several rules are about the
  // rejections).
  const finds = await client.query(
    `select f.player_tag as tag, f.item_id as "itemId", f.verified,
            f.confidence, f.flagged, f.countable, f.hole,
            extract(epoch from f.created_at) as "createdAt"
       from hunt_find f
       join hunt_item i on i.id = f.item_id
      where f.round_client_id = $1 and i.course_id = $2`,
    [clientId, courseId]
  );
  for (const { tag, achievement } of huntAchievements(finds.rows, { completedTags })) {
    const playerIndex = slotOf(tag);
    if (playerIndex !== -1) grants.push({ playerIndex, achievement });
  }

  // Multitasker — finished the hunt AND beat the course, same round. Composed
  // here because it straddles the two rule sets.
  const underPar = new Set(
    grants.filter((g) => g.achievement === "under_par").map((g) => g.playerIndex)
  );
  for (const tag of completedTags) {
    const playerIndex = slotOf(tag);
    if (playerIndex !== -1 && underPar.has(playerIndex)) {
      grants.push({ playerIndex, achievement: "multitasker" });
    }
  }

  // Grand Hunter — Hunt Master on every course at this venue. The only hunt
  // badge judged ACROSS rounds, which makes identity the whole problem.
  //
  // A 3-char tag is a display label, not a person: tags repeat by design, so
  // matching on one would hand a player a badge off a stranger's history and
  // lose their own the moment they picked different letters. But owning the
  // ROUND isn't enough either — a signed-in player hosting a pass-and-play
  // foursome owns a round whose other three seats are guests, so crediting
  // every finisher would let a rotating cast of companions collectively earn
  // one person's badge, and would count a guest's hunt as the owner's history.
  //
  // So this needs a seat whose owner is unambiguous, in both directions:
  //   · a solo round attributed to an account — one seat, one owner
  //   · a shared game — every seat carries its own app_user_id
  // Multi-player pass-and-play has no per-seat identity at all, so it neither
  // earns this nor counts toward it. Every other hunt badge is judged inside a
  // single round, where the tag IS unambiguous, so none of them need this.
  if (completedTags.size > 0) {
    // slot -> the account that unambiguously holds it.
    const seatOwners = new Map();
    if (clientId.startsWith("shared:")) {
      const roster = await client.query(
        `select slot, app_user_id from shared_game_player
          where game_id = $1::uuid and app_user_id is not null`,
        [clientId.slice("shared:".length)]
      );
      for (const r of roster.rows) seatOwners.set(r.slot, r.app_user_id);
    } else if (appUserId && playerTags.length === 1) {
      seatOwners.set(0, appUserId);
    }

    const finishers = [...completedTags]
      .map((tag) => ({ tag, slot: slotOf(tag) }))
      .filter(({ slot }) => slot !== -1 && seatOwners.has(slot));

    if (finishers.length > 0) {
      // Live courses only. An archived course is gone from /api/content and
      // can't be picked, so counting it would make "every course at this venue"
      // permanently unreachable for anyone without a historical grant on it.
      const venueCourses = await client.query(
        `select c.id from course c
          where c.location_id = (select location_id from course where id = $1)
            and c.archived_at is null`,
        [courseId]
      );
      const allCourseIds = venueCourses.rows.map((r) => r.id);
      // A one-course venue would grant this for the same work as Hunt Master,
      // so it isn't an achievement there. Mirrors the client's `reach`
      // predicate, which hides the badge rather than showing it unearnable.
      if (allCourseIds.length >= 2) {
        for (const { slot } of finishers) {
          const owner = seatOwners.get(slot);
          // Courses this ACCOUNT has hunted, counting only rounds where its
          // seat was equally unambiguous — solo owned rounds, and shared games
          // where the roster names the seat.
          const prior = await client.query(
            `select distinct r.course_id as id
               from reward_grant g
               join round r on r.id = g.round_id
              where g.achievement = 'hunt_master'
                and r.course_id = any($2::uuid[])
                and (
                  (r.app_user_id = $1 and array_length(r.player_tags, 1) = 1)
                  or exists (
                    select 1
                      from shared_game sg
                      join shared_game_player sp
                        on sp.game_id = sg.id and sp.slot = g.player_index
                     where r.client_id = 'shared:' || sg.id::text
                       and sp.app_user_id = $1
                  )
                )`,
            [owner, allCourseIds]
          );
          const done = new Set([...prior.rows.map((r) => r.id), courseId]);
          if (allCourseIds.every((id) => done.has(id))) {
            grants.push({ playerIndex: slot, achievement: "grand_hunter" });
          }
        }
      }
    }
  }

  // Team Player — played a round alongside someone from one of your teams.
  // Read off the shared game's roster rather than a team picker, because the
  // app has no screen that ties a round to a team (createGame accepts a teamId
  // that nothing passes). Two members of the same team in one game IS playing
  // with your team, and it needs no new UI to be true.
  if (clientId.startsWith("shared:")) {
    const gameId = clientId.slice("shared:".length);
    const mates = await client.query(
      `select p.slot, p.tag
         from shared_game_player p
        where p.game_id = $1::uuid and p.app_user_id is not null
          and exists (
            select 1
              from team_member me
              join team_member them on them.team_id = me.team_id
              join shared_game_player q on q.app_user_id = them.app_user_id
             where me.app_user_id = p.app_user_id
               and q.game_id = p.game_id
               and q.app_user_id <> p.app_user_id
          )`,
      [gameId]
    );
    for (const { slot } of mates.rows) {
      if (slot >= 0 && slot < playerTags.length) {
        grants.push({ playerIndex: slot, achievement: "team_player" });
      }
    }
  }

  for (const grant of grants) {
    // No redemption code is minted: tickets on the loyalty card are the only
    // payout (since #157), and a grant's internal identity is its UUID plus the
    // per-(round, player, achievement) unique key — which also makes a
    // duplicate re-sync a no-op via ON CONFLICT.
    await client.query(
      `insert into reward_grant (round_id, player_index, player_tag, achievement)
         values ($1, $2, $3, $4)
       on conflict (round_id, player_index, achievement) do nothing`,
      [roundId, grant.playerIndex, playerTags[grant.playerIndex], grant.achievement]
    );
  }
}

// --- Route -----------------------------------------------------------------
router.post("/", rateLimit, tenant(), async (req, res) => {
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

  // synthetic — a privileged, operator-only flag (bot load/soak + demo seed).
  // Any device can *send* it, but only a request carrying the matching
  // x-synthetic-key may actually mark the round synthetic; otherwise it's a
  // 403 (so a bypassed client can't self-flag to dodge a board). See
  // lib/syntheticConfig.js.
  const syn = resolveSynthetic(body.synthetic, req.get("x-synthetic-key"), process.env);
  if (!syn.ok) {
    return res.status(403).json({ ok: false, error: syn.error });
  }
  const synthetic = syn.synthetic;

  // scores — collect the non-null holes to insert.
  const collected = collectScoreRows(scores, playerTags.length);
  if (collected.error) {
    return res.status(400).json({ ok: false, error: collected.error });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Course must exist AND belong to this tenant (pars feed the reward
    // computation below). A foreign tenant's course id answers exactly like a
    // nonexistent one — a guessed/stale UUID must not write a round onto
    // another venue's leaderboard.
    const course = await findTenantCourse(courseId, req.tenant, client);
    if (!course) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "courseId does not exist" });
    }

    // Idempotent insert on client_id. ON CONFLICT DO NOTHING means a re-sync
    // returns 0 rows; we then look up the existing round and return its id
    // without touching its scores.
    // Attribute the round to the signed-in player, if any (req.user is
    // resolved from the session cookie by attachUser). Anonymous syncs stay
    // null — the walk-up tag flow is unchanged. Shared games are NEVER
    // single-owned: every participant syncs the same `shared:<gameId>` id to
    // one canonical round, so a single app_user_id would just be whoever
    // synced first.
    const ownable = !clientId.startsWith("shared:");
    const appUserId = ownable ? (req.user?.id ?? null) : null;
    const insertRound = await client.query(
      `insert into round (course_id, player_tags, group_tag, created_at, completed_at, client_id, app_user_id, synthetic)
         values ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6, $7, $8)
       on conflict (client_id) do nothing
       returning id`,
      [
        courseId,
        playerTags,
        groupTag ?? null,
        createdAt,
        completedAt === null ? null : new Date(completedAt),
        clientId,
        appUserId,
        synthetic,
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
      // Synthetic rounds mint grants by default (full-path testing); an
      // operator can suppress that with SYNTHETIC_MINT_REWARDS=false so a bot
      // run never dispenses real tickets. Real rounds are unaffected.
      const mintRewards = !synthetic || syntheticMintsRewards(process.env);
      if (completedAt !== null && mintRewards) {
        await grantRewards(client, {
          roundId,
          clientId,
          courseId,
          playerTags,
          scoreRows: collected.rows,
          pars: course.pars,
          appUserId,
        });
      }
    } else {
      // Duplicate sync — round already exists. Return its id, leave scores
      // alone. If the device is signed in now and the round is still
      // unowned, attribute it (a re-sync doubles as a retroactive claim);
      // never overwrite an existing owner.
      const existing = await client.query(
        appUserId
          ? `update round set app_user_id = $2
               where client_id = $1 and app_user_id is null
             returning id`
          : "select id from round where client_id = $1",
        appUserId ? [clientId, appUserId] : [clientId]
      );
      roundId =
        existing.rows[0]?.id ??
        (await client.query("select id from round where client_id = $1", [clientId])).rows[0].id;
    }

    await client.query("COMMIT");
    // Wake live subscribers (leaderboard SSE) — only a FRESH completed round
    // can change a board, and only after its transaction is committed.
    if (insertRound.rowCount === 1 && completedAt !== null) {
      domainEvents.emit(ROUND_COMPLETED, { courseId });
    }
    return res.json({ ok: true, roundId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[rounds] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});

// POST /api/rounds/claim — retroactively attach this device's already-synced
// rounds to the signed-in account ("sign in to keep your scores"). The device
// sends the client_ids it holds; we claim only the ones that exist and are
// still UNOWNED — tags collide by design, so ownership is keyed off the
// device's own round ids, never the tag, and we never take a round already
// owned by another account. Requires a player session.
const MAX_CLAIM_IDS = 500;

router.post("/claim", async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "sign in to claim rounds" });
  const raw = Array.isArray(req.body?.clientIds) ? req.body.clientIds : null;
  if (!raw) return res.status(400).json({ ok: false, error: "clientIds must be an array" });
  // Keep well-formed, de-duped ids, capped so a bad client can't drive an
  // unbounded update. Shared-game rounds (`shared:<gameId>`) are excluded — one
  // canonical round is shared by all participants, so it can't be single-owned.
  const clientIds = [
    ...new Set(
      raw.filter(
        (x) => typeof x === "string" && x.length > 0 && x.length <= 200 && !x.startsWith("shared:"),
      ),
    ),
  ].slice(0, MAX_CLAIM_IDS);
  if (clientIds.length === 0) return res.json({ ok: true, claimed: 0 });
  try {
    const result = await pool.query(
      `update round set app_user_id = $1
         where client_id = any($2::text[]) and app_user_id is null`,
      [req.user.id, clientIds]
    );
    return res.json({ ok: true, claimed: result.rowCount });
  } catch (err) {
    console.error("[rounds] claim error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
