// GET /api/leaderboard?period=day|week|month|all&by=player|team
//
// Arcade high-score style: for each player TAG we compute the total strokes for
// each completed round on each course, then keep that player's BEST (lowest)
// total. Results are grouped by player_tag and sorted ascending by total.
//
// by=team (punchlist #4 tier 1) aggregates the SAME score rows by the round's
// optional group_tag instead: a team round's score is its average strokes per
// player (teams are 1..4 players, so a raw sum would just reward small teams),
// and each team keeps its best average per course.
//
// GET /api/leaderboard/courses?locationId=&period=&by=&limit= feeds the venue
// display wall (/tv/wall): one board per course (top-N each) instead of one
// mixed list, and every live course of the venue appears even with no scores
// yet — the wall's column grid must be stable.
import { Router } from "express";
import { pool } from "../db.js";
import { UUID_RE } from "../lib/validateLocation.js";

export const router = Router();

// Fallback timezone for the leaderboard's calendar windows, used only when a
// venue has no `location.tz` set. The real zone is per venue (venues can span
// regions), read from each round's location below — this is just the default.
const VENUE_TZ = process.env.VENUE_TZ || "America/Los_Angeles";

// Map period -> the date_trunc unit that defines its *calendar* window in venue
// time. "day" means today (since local midnight), not the most recent 24 hours;
// "week"/"month" are the current calendar week/month. "all" means no time filter.
const PERIOD_UNITS = {
  day: "day",
  week: "week",
  month: "month",
  all: null,
};

router.get("/", async (req, res) => {
  const period = typeof req.query.period === "string" ? req.query.period : "all";
  if (!(period in PERIOD_UNITS)) {
    return res.status(400).json({ ok: false, error: "period must be day|week|month|all" });
  }
  const by = typeof req.query.by === "string" ? req.query.by : "player";
  if (by !== "player" && by !== "team") {
    return res.status(400).json({ ok: false, error: "by must be player|team" });
  }
  const unit = PERIOD_UNITS[period];

  // Calendar window in each venue's local time. Per round we resolve the zone as
  // coalesce(location.tz, VENUE_TZ), truncate "now" to the start of the current
  // day/week/month *in that zone*, then convert that local wall clock back to an
  // absolute instant to compare against completed_at (stored as timestamptz). So
  // a round played yesterday evening no longer counts as "today" just because
  // it's within 24 hours — and a venue in another region uses its OWN calendar
  // day, not a single global zone. Zone and unit are bound parameters — never
  // string-concatenated. `loc.tz` (joined below) supplies the per-venue zone.
  const params = [];
  let timeFilter = "";
  if (unit !== null) {
    params.push(VENUE_TZ, unit); // $1 = fallback zone, $2 = unit (referenced below)
    const zone = `coalesce(loc.tz, $1)`;
    timeFilter = `and r.completed_at >= timezone(${zone}, date_trunc($2, timezone(${zone}, now())))`;
  }

  // Query walkthrough:
  //  1. round_totals: one row per (round, player) with that player's total strokes.
  //     A player's tag lives positionally in round.player_tags, so we unnest the
  //     tags array WITH ORDINALITY to pair each tag with a 1-based ordinal, then
  //     join score on player_index = ord - 1 (player_index is 0-based). Only
  //     completed rounds within the window count.
  //  2. best_per_tag_course: DISTINCT ON (tag, course_id) ordered by total keeps
  //     each player's lowest total per course (their personal best on that course).
  //  3. final SELECT sorts the board ascending by total.
  // Team board: one row per (team, course) with the team's best round, a round
  // scored as average strokes per rostered player (1 decimal). Same structure
  // as the player query below — per-round totals, then DISTINCT ON keeps the
  // best, then sort ascending.
  const teamSql = `
    with team_totals as (
      select
        r.group_tag    as tag,
        r.course_id    as course_id,
        c.name         as course_name,
        r.completed_at as completed_at,
        sum(s.strokes)::numeric / cardinality(r.player_tags) as avg_total
      from round r
      join course c on c.id = r.course_id
      left join location loc on loc.id = c.location_id
      join score s on s.round_id = r.id
      where r.completed_at is not null
        and r.group_tag is not null
        ${timeFilter}
      group by r.id, r.group_tag, r.course_id, c.name, r.completed_at
    ),
    best_per_team_course as (
      select distinct on (tag, course_id)
        tag, course_id, course_name, avg_total, completed_at
      from team_totals
      order by tag, course_id, avg_total asc, completed_at asc
    )
    select
      tag,
      course_id    as "courseId",
      course_name  as "courseName",
      round(avg_total, 1)::float as total,
      completed_at as "completedAt"
    from best_per_team_course
    order by total asc, completed_at asc
  `;

  const sql = `
    with round_totals as (
      select
        pt.tag         as tag,
        r.course_id    as course_id,
        c.name         as course_name,
        r.completed_at as completed_at,
        sum(s.strokes) as total
      from round r
      join course c on c.id = r.course_id
      left join location loc on loc.id = c.location_id
      cross join lateral unnest(r.player_tags) with ordinality as pt(tag, ord)
      join score s
        on s.round_id = r.id
       and s.player_index = pt.ord - 1
      where r.completed_at is not null
        ${timeFilter}
      group by pt.tag, r.course_id, c.name, r.completed_at, r.id
    ),
    best_per_tag_course as (
      select distinct on (tag, course_id)
        tag, course_id, course_name, total, completed_at
      from round_totals
      order by tag, course_id, total asc, completed_at asc
    )
    select
      tag,
      course_id    as "courseId",
      course_name  as "courseName",
      total,
      completed_at as "completedAt"
    from best_per_tag_course
    order by total asc, completed_at asc
  `;

  try {
    const result = await pool.query(by === "team" ? teamSql : sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("[leaderboard] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Per-course boards for the venue display wall ---------------------------
// GET /api/leaderboard/courses?locationId=<uuid>&period=&by=&limit=
// One board per live course (top `limit` rows each), every course included
// even when empty. Same scoring semantics as the main board; the time window
// is made conditional in SQL ($2 null = no filter) so one statement serves
// every period.
router.get("/courses", async (req, res) => {
  const period = typeof req.query.period === "string" ? req.query.period : "day";
  if (!(period in PERIOD_UNITS)) {
    return res.status(400).json({ ok: false, error: "period must be day|week|month|all" });
  }
  const by = typeof req.query.by === "string" ? req.query.by : "player";
  if (by !== "player" && by !== "team") {
    return res.status(400).json({ ok: false, error: "by must be player|team" });
  }
  const locationId = typeof req.query.locationId === "string" && req.query.locationId !== ""
    ? req.query.locationId
    : null;
  if (locationId !== null && !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  let limit = 10;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return res.status(400).json({ ok: false, error: "limit must be 1..50" });
    }
  }
  const unit = PERIOD_UNITS[period]; // null for "all"

  // Shared window/venue filter: $1 tz fallback, $2 unit (null = all time),
  // $3 location (null = every venue).
  const zone = `coalesce(loc.tz, $1)`;
  const where = `
      where r.completed_at is not null
        and ($2::text is null
             or r.completed_at >= timezone(${zone}, date_trunc($2, timezone(${zone}, now()))))
        and ($3::uuid is null or c.location_id = $3)`;

  const playerRowsSql = `
    with round_totals as (
      select pt.tag, r.course_id, r.completed_at, sum(s.strokes)::int as total
      from round r
      join course c on c.id = r.course_id
      left join location loc on loc.id = c.location_id
      cross join lateral unnest(r.player_tags) with ordinality as pt(tag, ord)
      join score s on s.round_id = r.id and s.player_index = pt.ord - 1
      ${where}
      group by pt.tag, r.course_id, r.completed_at, r.id
    ),
    best as (
      select distinct on (tag, course_id) tag, course_id, total, completed_at
      from round_totals
      order by tag, course_id, total asc, completed_at asc
    ),
    ranked as (
      select *, row_number() over (partition by course_id order by total asc, completed_at asc) as rn
      from best
    )
    select course_id as "courseId", tag, total, completed_at as "completedAt", rn
      from ranked where rn <= $4 order by course_id, rn`;

  const teamRowsSql = `
    with team_totals as (
      select r.group_tag as tag, r.course_id, r.completed_at,
             sum(s.strokes)::numeric / cardinality(r.player_tags) as total
      from round r
      join course c on c.id = r.course_id
      left join location loc on loc.id = c.location_id
      join score s on s.round_id = r.id
      ${where}
        and r.group_tag is not null
      group by r.id, r.group_tag, r.course_id, r.completed_at
    ),
    best as (
      select distinct on (tag, course_id) tag, course_id, total, completed_at
      from team_totals
      order by tag, course_id, total asc, completed_at asc
    ),
    ranked as (
      select *, row_number() over (partition by course_id order by total asc, completed_at asc) as rn
      from best
    )
    select course_id as "courseId", tag, round(total, 1)::float as total,
           completed_at as "completedAt", rn
      from ranked where rn <= $4 order by course_id, rn`;

  try {
    const [courses, rows] = await Promise.all([
      pool.query(
        `select c.id, c.name, c.theme, c.sort_order as "sortOrder",
                c.location_id as "locationId", l.name as "locationName"
           from course c
           left join location l on l.id = c.location_id
          where c.archived_at is null
            and (l.id is null or l.archived_at is null)
            and ($1::uuid is null or c.location_id = $1)
          order by c.sort_order, c.name`,
        [locationId]
      ),
      pool.query(by === "team" ? teamRowsSql : playerRowsSql, [VENUE_TZ, unit, locationId, limit]),
    ]);

    const rowsByCourse = new Map();
    for (const r of rows.rows) {
      const list = rowsByCourse.get(r.courseId) ?? [];
      list.push({ rank: Number(r.rn), tag: r.tag, total: r.total, completedAt: r.completedAt });
      rowsByCourse.set(r.courseId, list);
    }
    return res.json({
      period,
      by,
      courses: courses.rows.map((c) => ({
        courseId: c.id,
        courseName: c.name,
        theme: c.theme,
        locationId: c.locationId,
        locationName: c.locationName,
        rows: rowsByCourse.get(c.id) ?? [],
      })),
    });
  } catch (err) {
    console.error("[leaderboard] courses error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
