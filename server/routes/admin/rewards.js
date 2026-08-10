// Admin: golf achievement rewards (punchlist #8 tier 1).
//   GET  /api/admin/rewards/summary?days=    reporting rollup
//
// Since #157 tickets are the only player-facing golf reward — achievements pay
// straight to a loyalty card and the app surfaces no counter codes — so Master
// Control reports on issuance rather than redeeming it: how many achievements
// each venue is minting and what they pay out to loyalty cards. Org-scoping
// rides the round -> course -> location -> org chain, like the overview rollup
// and the game-ticket usage rollup (gameRewards.js) this mirrors.
import { Router } from "express";
import { pool } from "../../db.js";
import { orgScope } from "../../lib/adminAuth.js";

const VENUE_TZ = process.env.VENUE_TZ || "America/Los_Angeles";

export const router = Router();

// --- Reporting rollup -------------------------------------------------------
// Golf achievements ARE a ticket payout (reward_grant.tickets_awarded on a card
// claim), but they never touch game_ticket_award, so the game-ticket usage
// rollup misses them entirely. This is their reporting home: per-achievement
// totals (granted vs. banked to a card vs. still unclaimed, and tickets paid)
// plus a per venue-local-day drilldown. Window by when the achievement was
// earned (created_at), clamped to [1, 90] days like the game-ticket rollup.
router.get("/summary", async (req, res) => {
  const scope = orgScope(req);
  let days = Number.parseInt(req.query.days, 10);
  if (!Number.isFinite(days)) days = 30;
  days = Math.max(1, Math.min(90, days));

  // A grant is "claimed" when it was banked to a loyalty card, which is the
  // only way it pays out (redeemed_at is the consume point); anything still
  // unredeemed is outstanding. Tickets only accrue on claimed grants.
  const CARD = `g.redeemed_at is not null`;
  const WHERE = `g.created_at >= now() - $2::int * interval '1 day'
                 and ($1::uuid is null or l.org_id = $1)`;
  const FROM = `from reward_grant g
                join round r on r.id = g.round_id
                join course c on c.id = r.course_id
                left join location l on l.id = c.location_id`;

  try {
    const [byAch, rollup] = await Promise.all([
      pool.query(
        `select g.achievement,
                count(*)                                         as granted,
                count(*) filter (where ${CARD})                  as card_claims,
                count(*) filter (where g.redeemed_at is null)    as unclaimed,
                coalesce(sum(g.tickets_awarded) filter (where ${CARD}), 0) as tickets
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
                count(*)                          as granted,
                count(*) filter (where ${CARD})   as card_claims,
                coalesce(sum(g.tickets_awarded) filter (where ${CARD}), 0) as tickets
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
        granted: Number(r.granted),
        cardClaims: Number(r.card_claims),
        unclaimed: Number(r.unclaimed),
        tickets: Number(r.tickets),
      })),
      rows: rollup.rows.map((r) => ({
        day: r.day,
        locationId: r.location_id,
        locationName: r.location_name,
        achievement: r.achievement,
        granted: Number(r.granted),
        cardClaims: Number(r.card_claims),
        tickets: Number(r.tickets),
      })),
    });
  } catch (err) {
    console.error("[admin/rewards] summary error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
