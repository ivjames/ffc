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

export const router = Router();

router.get("/", async (req, res) => {
  const scope = orgScope(req);
  try {
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
            where r.completed_at is null and ($1::uuid is null or l.org_id = $1)) as rounds_active,
          (select count(*) from round r
             join course c on c.id = r.course_id
             join location l on l.id = c.location_id
            where r.completed_at >= now() - interval '7 days'
              and ($1::uuid is null or l.org_id = $1)) as rounds_7d,
          (select count(*) from round r
             join course c on c.id = r.course_id
             join location l on l.id = c.location_id
            where r.completed_at >= now() - interval '30 days'
              and ($1::uuid is null or l.org_id = $1)) as rounds_30d,
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
