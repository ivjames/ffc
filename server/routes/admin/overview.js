// Admin: read-only rollup for the Overview screen.
//   GET /api/admin/overview
// Totals (live rows only) + rounds in the last 7/30 days + a per-location
// breakdown. All counts exclude archived orgs/locations/courses.
import { Router } from "express";
import { pool } from "../../db.js";

export const router = Router();

router.get("/", async (_req, res) => {
  try {
    const [totals, perLocation] = await Promise.all([
      pool.query(`
        select
          (select count(*) from org      where archived_at is null) as orgs,
          (select count(*) from location where archived_at is null) as locations,
          (select count(*) from course   where archived_at is null) as courses,
          (select count(*) from round where completed_at is null) as rounds_active,
          (select count(*) from round where completed_at >= now() - interval '7 days')  as rounds_7d,
          (select count(*) from round where completed_at >= now() - interval '30 days') as rounds_30d,
          (select count(*) from hunt_find where verified) as hunt_finds
      `),
      pool.query(`
        select l.id, l.name, l.slug,
               count(distinct c.id) filter (where c.archived_at is null) as courses,
               count(distinct r.id) filter (where r.completed_at >= now() - interval '30 days') as rounds_30d
          from location l
          left join course c on c.location_id = l.id
          left join round  r on r.course_id  = c.id
         where l.archived_at is null
         group by l.id
         order by l.sort_order, l.name
      `),
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
