// Admin: golf achievement issuance (punchlist #8 tier 1).
//   GET  /api/admin/rewards/summary?days=    reporting rollup
//
// Achievements pay NOTHING (see lib/rewards.js) — no tickets, no card credit,
// no counter codes — so this reports purely on what each venue is minting:
// how many of each achievement players are earning, and where. There is no
// claimed/unclaimed distinction and no ticket column, because a grant carries
// no value to bank. Org-scoping rides the round -> course -> location -> org
// chain, like the overview rollup and the game-ticket usage rollup
// (gameRewards.js) this mirrors.
import { Router } from "express";
import { pool } from "../../db.js";
import { ACHIEVEMENTS } from "../../lib/rewards.js";
import { orgScope } from "../../lib/adminAuth.js";

const VENUE_TZ = process.env.VENUE_TZ || "America/Los_Angeles";

export const router = Router();

// --- Reporting rollup -------------------------------------------------------
// Achievements never touch game_ticket_award, so the game-ticket usage rollup
// doesn't see them; this is their reporting home. Per-achievement totals plus a
// per venue-local-day drilldown, windowed by when the achievement was earned
// (created_at) and clamped to [1, 90] days like the game-ticket rollup.
router.get("/summary", async (req, res) => {
  const scope = orgScope(req);
  let days = Number.parseInt(req.query.days, 10);
  if (!Number.isFinite(days)) days = 30;
  days = Math.max(1, Math.min(90, days));

  const WHERE = `g.created_at >= now() - $2::int * interval '1 day'
                 and ($1::uuid is null or l.org_id = $1)`;
  const FROM = `from reward_grant g
                join round r on r.id = g.round_id
                join course c on c.id = r.course_id
                left join location l on l.id = c.location_id`;

  try {
    const [byAch, rollup] = await Promise.all([
      pool.query(
        `select g.achievement, count(*) as granted
           ${FROM}
          where ${WHERE}
          group by g.achievement
          order by granted desc`,
        [scope, days]
      ),
      pool.query(
        `select (g.created_at at time zone coalesce(l.tz, $3))::date as day,
                l.id   as location_id,
                l.name as location_name,
                g.achievement,
                count(*) as granted
           ${FROM}
          where ${WHERE}
          group by 1, l.id, l.name, g.achievement
          order by 1 desc, l.name asc, granted desc`,
        [scope, days, VENUE_TZ]
      ),
    ]);

    return res.json({
      days,
      byAchievement: byAch.rows.map((r) => ({
        achievement: r.achievement,
        // Labelled here so Master Control renders a name, not a raw key — the
        // server is what decides which achievements exist, so it is what knows
        // their names.
        label: ACHIEVEMENTS[r.achievement] ?? r.achievement,
        granted: Number(r.granted),
      })),
      rows: rollup.rows.map((r) => ({
        day: r.day,
        locationId: r.location_id,
        locationName: r.location_name,
        achievement: r.achievement,
        label: ACHIEVEMENTS[r.achievement] ?? r.achievement,
        granted: Number(r.granted),
      })),
    });
  } catch (err) {
    console.error("[admin/rewards] summary error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
