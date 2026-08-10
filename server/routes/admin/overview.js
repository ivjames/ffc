// Admin: read-only rollup for the Overview screen.
//   GET /api/admin/overview
// Totals (live rows only) + rounds in the last 7/30 days + a per-location
// breakdown. All counts exclude archived orgs/locations/courses.
//
// Org-scoping: an org_admin sees only their own org's numbers — every count
// here is filtered through location.org_id (courses/rounds/hunt_finds all
// reach it via course.location_id). A super_admin (orgScope null) is
// unrestricted, same as today.
import { Router } from "express";
import { pool } from "../../db.js";
import { orgScope } from "../../lib/adminAuth.js";
import { boardSyntheticFilter } from "../../lib/syntheticConfig.js";

export const router = Router();

// The console reads in one HQ/operator zone (admin/ui.tsx's ADMIN_TZ), so the
// series' calendar days are bucketed in that zone too — matching what the
// operator sees everywhere else in Master Control.
const ADMIN_TZ = process.env.ADMIN_TZ || "America/Los_Angeles";

// --- Daily trend series (office reporting, punchlist #2) --------------------
// GET /api/admin/overview/series?days=30 → oldest-first daily buckets of
// completed rounds, distinct player tags, and verified hunt finds. Days are
// calendar days in ADMIN_TZ. Org-scoped like the rollup.
router.get("/series", async (req, res) => {
  let days = 30;
  if (req.query.days !== undefined) {
    days = Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return res.status(400).json({ ok: false, error: "days must be 1..90" });
    }
  }
  const scope = orgScope(req);
  try {
    // Three grouped passes (rounds, players, finds) merged in JS — simpler
    // than one correlated query per bucket. The window bound is generous
    // (days+1 in absolute time) and the per-day filter is exact in ADMIN_TZ.
    const since = `now() - ($2::int + 1) * interval '1 day'`;
    // Synthetic (bot) rounds count by default; excluded when
    // SYNTHETIC_COUNT_ON_BOARD=false, so admin rollups match the boards.
    const synFilter = boardSyntheticFilter("r", process.env);
    const [rounds, players, finds] = await Promise.all([
      pool.query(
        `select timezone($1, r.completed_at)::date as day,
                count(*) as rounds
           from round r
           join course c on c.id = r.course_id
           join location l on l.id = c.location_id
          where r.completed_at >= ${since}
            and ($3::uuid is null or l.org_id = $3)
            ${synFilter}
          group by day`,
        [ADMIN_TZ, days, scope]
      ),
      pool.query(
        `select timezone($1, r.completed_at)::date as day,
                count(distinct pt.tag) as players
           from round r
           join course c on c.id = r.course_id
           join location l on l.id = c.location_id
           cross join lateral unnest(r.player_tags) as pt(tag)
          where r.completed_at >= ${since}
            and ($3::uuid is null or l.org_id = $3)
            ${synFilter}
          group by day`,
        [ADMIN_TZ, days, scope]
      ),
      pool.query(
        `select timezone($1, f.created_at)::date as day,
                count(*) as finds
           from hunt_find f
           join hunt_item i on i.id = f.item_id
           join course c on c.id = i.course_id
           join location l on l.id = c.location_id
          where f.verified and f.created_at >= ${since}
            and ($3::uuid is null or l.org_id = $3)
          group by day`,
        [ADMIN_TZ, days, scope]
      ),
    ]);

    const key = (d) => {
      // pg returns ::date as a JS Date at local midnight — format as the plain
      // YYYY-MM-DD it already is in SQL, without re-zoning.
      const dt = d instanceof Date ? d : new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    };
    const byDay = new Map();
    for (const r of rounds.rows) byDay.set(key(r.day), { rounds: Number(r.rounds) });
    for (const r of players.rows) {
      byDay.set(key(r.day), { ...byDay.get(key(r.day)), players: Number(r.players) });
    }
    for (const r of finds.rows) {
      byDay.set(key(r.day), { ...byDay.get(key(r.day)), huntFinds: Number(r.finds) });
    }

    // Emit exactly `days` buckets ending today (ADMIN_TZ), zero-filled.
    const todayRes = await pool.query(`select timezone($1, now())::date as today`, [ADMIN_TZ]);
    const today = todayRes.rows[0].today;
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = key(d);
      const bucket = byDay.get(k) ?? {};
      series.push({
        date: k,
        rounds: bucket.rounds ?? 0,
        players: bucket.players ?? 0,
        huntFinds: bucket.huntFinds ?? 0,
      });
    }
    return res.json({ days, tz: ADMIN_TZ, series });
  } catch (err) {
    console.error("[admin/overview] series error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.get("/", async (req, res) => {
  const scope = orgScope(req);
  try {
    // Synthetic rounds count by default; excluded when SYNTHETIC_COUNT_ON_BOARD
    // =false so the dashboard round counts track the boards.
    const synFilter = boardSyntheticFilter("r", process.env);
    const [totals, perLocation] = await Promise.all([
      pool.query(
        `
        select
          (select count(*) from org
            where archived_at is null and ($1::uuid is null or id = $1)) as orgs,
          (select count(*) from location
            where archived_at is null and ($1::uuid is null or org_id = $1)) as locations,
          (select count(*) from course c
             join location l on l.id = c.location_id
            where c.archived_at is null and ($1::uuid is null or l.org_id = $1)) as courses,
          (select count(*) from round r
             join course c on c.id = r.course_id
             join location l on l.id = c.location_id
            where r.completed_at is null and ($1::uuid is null or l.org_id = $1)
              ${synFilter}) as rounds_active,
          (select count(*) from round r
             join course c on c.id = r.course_id
             join location l on l.id = c.location_id
            where r.completed_at >= now() - interval '7 days'
              and ($1::uuid is null or l.org_id = $1)
              ${synFilter}) as rounds_7d,
          (select count(*) from round r
             join course c on c.id = r.course_id
             join location l on l.id = c.location_id
            where r.completed_at >= now() - interval '30 days'
              and ($1::uuid is null or l.org_id = $1)
              ${synFilter}) as rounds_30d,
          (select count(*) from hunt_find f
             join hunt_item i on i.id = f.item_id
             join course c on c.id = i.course_id
             join location l on l.id = c.location_id
            where f.verified and ($1::uuid is null or l.org_id = $1)) as hunt_finds
      `,
        [scope]
      ),
      pool.query(
        `
        select l.id, l.name, l.slug,
               count(distinct c.id) filter (where c.archived_at is null) as courses,
               count(distinct r.id) filter (where r.completed_at >= now() - interval '30 days') as rounds_30d
          from location l
          left join course c on c.location_id = l.id
          left join round  r on r.course_id  = c.id
         where l.archived_at is null
           and ($1::uuid is null or l.org_id = $1)
         group by l.id
         order by l.sort_order, l.name
      `,
        [scope]
      ),
    ]);

    const t = totals.rows[0];
    return res.json({
      totals: {
        orgs: Number(t.orgs),
        locations: Number(t.locations),
        courses: Number(t.courses),
        roundsActive: Number(t.rounds_active),
        rounds7d: Number(t.rounds_7d),
        rounds30d: Number(t.rounds_30d),
        huntFinds: Number(t.hunt_finds),
      },
      perLocation: perLocation.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        courses: Number(r.courses),
        rounds30d: Number(r.rounds_30d),
      })),
    });
  } catch (err) {
    console.error("[admin/overview] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
