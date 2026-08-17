// Arcade high scores — the boards the mini-games rank on.
//
//   POST /api/game-scores               {locationId, game, score, detail?, sessionId}
//        -> records the round and hands back the board it landed on, the
//           player's rank, and whether it beat their own best. One round trip
//           drives the whole end screen.
//   GET  /api/game-scores/board         ?game=&locationId=&period=&limit=
//        -> one game's top-N at one venue. Open read, like /api/leaderboard:
//           a board nobody can see is not a board.
//   GET  /api/game-scores/boards        ?locationId=&period=&limit=
//        -> every scored game's top-N in one call, for the arcade-wide board
//           screen and the TV wall.
//
// Ranking is per game, never per board: lib/gameScores.js says whether big or
// small wins, so a go-kart lap and a skee-ball total sort correctly through the
// same code. Ties break on who got there FIRST — the earlier run keeps the
// higher slot, which is the arcade convention and also makes the order stable
// across refetches.
//
// Identity: recording requires a signed-in account (the account-required model,
// PR #200). A board of 3-char tags would be unownable and spoofable — anyone
// could claim anyone's record — so an anonymous device plays for fun and gets
// nudged to sign in, exactly like the ticket award does.
//
// Tenant isolation: writes resolve the location through findTenantLocation (a
// foreign venue id 404s like a nonexistent one), and reads carry the same
// org filter /api/leaderboard uses, so one client's board can never surface
// another client's players.
import { Router } from "express";
import { pool } from "../db.js";
import { requireUser } from "../lib/userAuth.js";
import { UUID_RE } from "../lib/validateLocation.js";
import { tenant, tenantOrgFilter, findTenantLocation } from "../lib/tenant.js";
import { moduleLive } from "../lib/modules.js";
import { boardSyntheticFilter, resolveSynthetic } from "../lib/syntheticConfig.js";
import {
  SCORED_GAMES,
  allBoards,
  isScoredGame,
  scoredGame,
  normalizeVariant,
  sortDirection,
  isBetter,
  MAX_SCORE,
} from "../lib/gameScores.js";

export const router = Router();

const VENUE_TZ = process.env.VENUE_TZ || "America/Los_Angeles";

// Same calendar-window vocabulary as /api/leaderboard: "day" is since local
// midnight at the venue, not the last 24 hours.
const PERIOD_UNITS = { day: "day", week: "week", month: "month", all: null };

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** `detail` is display-only (lap splits, correct/total) and never ranked, so it
 *  needs no schema — just a ceiling, so a client can't park a payload in it. */
const MAX_DETAIL_BYTES = 2000;

// --- Shared board machinery -------------------------------------------------

/**
 * Build the WHERE fragments + bound params every board query shares. Returns
 * the fragments as strings to splice into SQL — each is either "" or built
 * from caller-chosen literals and `$n` placeholders, never from user input.
 */
function boardScope({ locationId, unit, tenant: t }) {
  const params = [];
  let timeFilter = "";
  if (unit !== null) {
    params.push(VENUE_TZ, unit);
    const zone = `coalesce(loc.tz, $1)`;
    timeFilter = `and gs.created_at >= timezone(${zone}, date_trunc($2, timezone(${zone}, now())))`;
  }
  let locationFilter = "";
  if (locationId !== null) {
    params.push(locationId);
    locationFilter = `and gs.location_id = $${params.length}`;
  }
  let tenantFilter = "";
  if (t != null) {
    params.push(t.org.id);
    tenantFilter = tenantOrgFilter(t, "loc.org_id", `$${params.length}`);
  }
  const syntheticFilter = boardSyntheticFilter("gs", process.env);
  return { params, where: `${timeFilter} ${locationFilter} ${tenantFilter} ${syntheticFilter}` };
}

/**
 * One game's ranked board. `dir` is "asc"/"desc" from the game's registry
 * entry — a sort direction can't be a bound parameter, so it is resolved from
 * the validated game key, never taken from the request.
 *
 * DISTINCT ON keeps each player's single best run (their personal record), so
 * one hot streak can't fill all ten slots; row_number() then ranks those bests.
 */
async function readBoard({ game, variant, locationId, unit, tenant: t, limit }) {
  const dir = sortDirection(game);
  const { params, where } = boardScope({ locationId, unit, tenant: t });
  params.push(game);
  const gameParam = `$${params.length}`;
  params.push(variant ?? "");
  const variantParam = `$${params.length}`;
  params.push(limit);
  const limitParam = `$${params.length}`;

  const sql = `
    with best as (
      select distinct on (gs.app_user_id)
        gs.app_user_id, gs.score, gs.detail, gs.created_at
      from game_score gs
      join location loc on loc.id = gs.location_id
      where gs.game = ${gameParam}
        and gs.variant = ${variantParam}
        ${where}
      order by gs.app_user_id, gs.score ${dir}, gs.created_at asc
    ),
    ranked as (
      select row_number() over (order by b.score ${dir}, b.created_at asc) as rank, b.*
      from best b
    )
    select r.rank::int          as rank,
           r.app_user_id        as "userId",
           u.display_name       as name,
           u.default_tag        as tag,
           r.score::bigint      as score,
           r.detail             as detail,
           r.created_at         as "createdAt"
    from ranked r
    join app_user u on u.id = r.app_user_id
    order by r.rank
    limit ${limitParam}
  `;
  const result = await pool.query(sql, params);
  return result.rows.map((row) => ({ ...row, score: Number(row.score) }));
}

/**
 * One player's standing on a board they may not be in the top N of — the
 * "you're #23" line under the board. Null when they have no score in scope.
 */
async function readStanding({ game, variant, locationId, unit, tenant: t, userId }) {
  const dir = sortDirection(game);
  const { params, where } = boardScope({ locationId, unit, tenant: t });
  params.push(game);
  const gameParam = `$${params.length}`;
  params.push(variant ?? "");
  const variantParam = `$${params.length}`;
  params.push(userId);
  const userParam = `$${params.length}`;

  const sql = `
    with best as (
      select distinct on (gs.app_user_id)
        gs.app_user_id, gs.score, gs.created_at
      from game_score gs
      join location loc on loc.id = gs.location_id
      where gs.game = ${gameParam}
        and gs.variant = ${variantParam}
        ${where}
      order by gs.app_user_id, gs.score ${dir}, gs.created_at asc
    ),
    ranked as (
      select row_number() over (order by b.score ${dir}, b.created_at asc) as rank, b.*
      from best b
    )
    select rank::int as rank, score::bigint as score, (select count(*) from best)::int as "outOf"
    from ranked where app_user_id = ${userParam}
  `;
  const result = await pool.query(sql, params);
  const row = result.rows[0];
  return row ? { rank: row.rank, score: Number(row.score), outOf: row.outOf } : null;
}

/** Shared query-param parsing for the two GET board routes. */
function parseBoardQuery(req, { requireGame }) {
  const period = typeof req.query.period === "string" ? req.query.period : "all";
  if (!(period in PERIOD_UNITS)) return { error: "period must be day|week|month|all" };

  const locationId =
    typeof req.query.locationId === "string" && req.query.locationId !== ""
      ? req.query.locationId
      : null;
  if (locationId !== null && !UUID_RE.test(locationId)) {
    return { error: "locationId must be a uuid" };
  }

  let limit = DEFAULT_LIMIT;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return { error: `limit must be 1..${MAX_LIMIT}` };
    }
  }

  let game = null;
  let variant = "";
  if (requireGame) {
    game = typeof req.query.game === "string" ? req.query.game : "";
    if (!isScoredGame(game)) return { error: "unknown game" };
    const v = normalizeVariant(game, req.query.variant);
    if (v.error) return { error: v.error };
    variant = v.variant;
  }

  return { period, unit: PERIOD_UNITS[period], locationId, limit, game, variant };
}

// --- Record a score ---------------------------------------------------------

router.post("/", tenant(), requireUser, async (req, res) => {
  const { locationId, game, score, detail, sessionId } = req.body ?? {};

  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  if (typeof game !== "string" || !isScoredGame(game)) {
    return res.status(400).json({ ok: false, error: "unknown game" });
  }
  // Which sub-board this run belongs on. Games without variants must send none;
  // games with them must name one, so an unrecognised track can't quietly open
  // a private board of one.
  const variantCheck = normalizeVariant(game, req.body?.variant);
  if (variantCheck.error) {
    return res.status(400).json({ ok: false, error: variantCheck.error });
  }
  const variant = variantCheck.variant;
  // Integer in the game's base unit (ms for time games). Negative scores are
  // real in at least one game — whack-a-mole's bombs can take you under zero —
  // so the floor is -MAX_SCORE, not 0.
  if (!Number.isInteger(score) || score < -MAX_SCORE || score > MAX_SCORE) {
    return res.status(400).json({ ok: false, error: `score must be an integer within ±${MAX_SCORE}` });
  }
  if (typeof sessionId !== "string" || sessionId.length < 8 || sessionId.length > 100) {
    return res.status(400).json({ ok: false, error: "sessionId is required (8..100 chars)" });
  }
  if (detail !== undefined && detail !== null) {
    if (typeof detail !== "object" || Array.isArray(detail)) {
      return res.status(400).json({ ok: false, error: "detail must be an object" });
    }
    if (JSON.stringify(detail).length > MAX_DETAIL_BYTES) {
      return res.status(400).json({ ok: false, error: "detail is too large" });
    }
  }

  const synth = resolveSynthetic(req.body?.synthetic, req.get("x-synthetic-key"), process.env);
  if (!synth.ok) return res.status(403).json({ ok: false, error: synth.error });

  try {
    // Tenant-scoped: a foreign venue's id 404s exactly like a nonexistent one,
    // so a guessed id can't write rows onto another client's board.
    const loc = await findTenantLocation(locationId, req.tenant, { cols: "id, pos, modules" });
    if (!loc) return res.status(404).json({ ok: false, error: "unknown location" });
    // The venue's plan has to include the arcade before we record arcade work
    // for it (lib/modules.js). The client route guard keeps players out of the
    // UI; this keeps a hand-rolled request out of the data.
    if (!moduleLive(loc, "arcade")) {
      return res.status(403).json({ ok: false, error: "the arcade is not enabled for this venue" });
    }

    // The player's best BEFORE this round decides the "personal best" banner —
    // read it first, because the insert below may itself become that best.
    const prior = await pool.query(
      `select score::bigint as score from game_score
        where app_user_id = $1 and game = $2 and variant = $3 and location_id = $4
        order by score ${sortDirection(game)}, created_at asc
        limit 1`,
      [req.user.id, game, variant, locationId]
    );
    const previousBest = prior.rows[0] ? Number(prior.rows[0].score) : null;

    // Idempotent on (game, sessionId): a re-mounted end screen or a retried
    // fetch must not stack duplicate rows, the same guarantee the ticket award
    // gives. DO NOTHING then re-select, so a replay returns the ORIGINAL row.
    await pool.query(
      `insert into game_score
         (location_id, game, variant, app_user_id, score, detail, session_id, synthetic)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       on conflict (game, session_id) do nothing`,
      [
        locationId,
        game,
        variant,
        req.user.id,
        score,
        JSON.stringify(detail ?? {}),
        sessionId,
        synth.synthetic,
      ]
    );
    const stored = await pool.query(
      `select id, score::bigint as score, created_at as "createdAt"
         from game_score where game = $1 and session_id = $2`,
      [game, sessionId]
    );
    const row = stored.rows[0];
    const recorded = row ? Number(row.score) : score;

    // Boards are all-time at the venue by default — the record that stands
    // until someone beats it. The client asks for a narrower period itself.
    const scope = { game, variant, locationId, unit: null, tenant: req.tenant };
    const [board, standing] = await Promise.all([
      readBoard({ ...scope, limit: DEFAULT_LIMIT }),
      readStanding({ ...scope, userId: req.user.id }),
    ]);

    return res.json({
      ok: true,
      // The registry entry rides along so the client formats and labels the
      // board from the SAME source that ranked it — no second, hand-maintained
      // copy of direction/unit to drift out of sync with the sort.
      meta: scoredGame(game),
      variant,
      scoreId: row?.id ?? null,
      score: recorded,
      previousBest,
      isPersonalBest: isBetter(game, recorded, previousBest),
      standing,
      board,
    });
  } catch (err) {
    console.error("[game-scores] record error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Read one game's board --------------------------------------------------

router.get("/board", tenant(), async (req, res) => {
  const parsed = parseBoardQuery(req, { requireGame: true });
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  try {
    const board = await readBoard({ ...parsed, tenant: req.tenant });
    // A signed-in reader also gets their own standing, so the board can show
    // "you're #23" without a second request.
    const standing = req.user
      ? await readStanding({ ...parsed, tenant: req.tenant, userId: req.user.id })
      : null;
    return res.json({
      ok: true,
      game: parsed.game,
      meta: scoredGame(parsed.game),
      variant: parsed.variant,
      period: parsed.period,
      board,
      standing,
    });
  } catch (err) {
    console.error("[game-scores] board error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Read every game's board in one call ------------------------------------
// The arcade-wide board screen shows every board at once; one request per board
// would be dozens of round trips on a phone in a loud room. Variant games
// contribute one entry PER sub-board (a go-kart board per track), because a
// merged lap-time board would rank the track choice, not the driving.

router.get("/boards", tenant(), async (req, res) => {
  const parsed = parseBoardQuery(req, { requireGame: false });
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  try {
    const boards = await Promise.all(
      allBoards().map(async (g) => ({
        game: g.key,
        label: g.label,
        variant: g.variant,
        variantLabel: g.variantLabel,
        direction: g.direction,
        unit: g.unit,
        noun: g.noun,
        board: await readBoard({
          ...parsed,
          game: g.key,
          variant: g.variant,
          tenant: req.tenant,
        }),
      }))
    );
    return res.json({ ok: true, period: parsed.period, boards });
  } catch (err) {
    console.error("[game-scores] boards error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- The registry itself ----------------------------------------------------
// So the client renders labels/units/directions from ONE source instead of a
// second hand-maintained copy that can drift out of sync with ranking.

router.get("/games", (_req, res) => {
  res.json({ ok: true, games: SCORED_GAMES });
});
