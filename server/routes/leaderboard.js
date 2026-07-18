// GET /api/leaderboard?period=day|week|month|all
//
// Arcade high-score style: for each player TAG we compute the total strokes for
// each completed round on each course, then keep that player's BEST (lowest)
// total. Results are grouped by player_tag and sorted ascending by total.
import { Router } from "express";
import { pool } from "../db.js";

export const router = Router();

// Venue-local timezone for the leaderboard's calendar windows. All venues are in
// Pacific time (Upland CA, Tukwila WA, Wilsonville OR), so a single zone covers
// them; override with VENUE_TZ if that ever changes.
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
  const unit = PERIOD_UNITS[period];

  // Calendar window in venue-local time. We truncate "now" to the start of the
  // current day/week/month *in the venue's zone*, then convert that local wall
  // clock back to an absolute instant to compare against completed_at (stored as
  // timestamptz). So a round played yesterday evening no longer counts as
  // "today" just because it's within 24 hours. Both the zone and the unit are
  // bound parameters — never string-concatenated.
  const params = [];
  let timeFilter = "";
  if (unit !== null) {
    params.push(VENUE_TZ, unit); // $1 = zone, $2 = unit (referenced below)
    timeFilter = `and r.completed_at >= timezone($1, date_trunc($2, timezone($1, now())))`;
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
    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("[leaderboard] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
