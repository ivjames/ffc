// Admin: golf achievement rewards (punchlist #8 tier 1).
//   GET  /api/admin/rewards/summary?days=    reporting rollup (the live view)
//   GET  /api/admin/rewards?code=            look up one code (legacy counter flow)
//   GET  /api/admin/rewards?redeemed=&limit= recent grants (default: unredeemed)
//   POST /api/admin/rewards/:id/redeem       mark handed out (legacy counter flow)
//   POST /api/admin/rewards/:id/unredeem     undo a mistaken redemption
//
// Since #157 tickets are the only player-facing golf reward — the app surfaces
// no counter codes anywhere, so the code lookup + redeem endpoints below only
// service pre-#157 grants that still carry an unspent code. What Master Control
// reports on now is `/summary`: how many achievements each venue is minting and
// what they pay out to loyalty cards. Org-scoping rides the round -> course ->
// location -> org chain, like the overview rollup and the game-ticket usage
// rollup (gameRewards.js) this mirrors.
import { Router } from "express";
import { pool } from "../../db.js";
import { audit, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";
import { ACHIEVEMENTS } from "../../lib/rewards.js";

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

  // A grant is "claimed" when it was banked to a loyalty card (redeemed_via =
  // 'card'); anything else that carries a redeemed_at is a legacy counter
  // redemption. Tickets only accrue on card claims.
  const CARD = `g.redeemed_via = 'card'`;
  const COUNTER = `g.redeemed_at is not null and g.redeemed_via is distinct from 'card'`;
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
                count(*) filter (where ${COUNTER})               as counter_redemptions,
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
        counterRedemptions: Number(r.counter_redemptions),
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

const REWARD_COLS = `g.id, g.code, g.player_index as "playerIndex",
  g.player_tag as "playerTag", g.achievement,
  g.created_at as "createdAt", g.redeemed_at as "redeemedAt", g.redeemed_by as "redeemedBy",
  g.redeemed_via as "redeemedVia", g.tickets_awarded as "ticketsAwarded",
  c.name as "courseName", l.name as "locationName"`;

const REWARD_FROM = `from reward_grant g
  join round r on r.id = g.round_id
  join course c on c.id = r.course_id
  left join location l on l.id = c.location_id`;

// --- List / lookup ----------------------------------------------------------
router.get("/", async (req, res) => {
  const scope = orgScope(req);
  const code = typeof req.query.code === "string" ? req.query.code.trim().toUpperCase() : "";
  try {
    if (code) {
      const result = await pool.query(
        `select ${REWARD_COLS} ${REWARD_FROM}
          where upper(g.code) = $1 and ($2::uuid is null or l.org_id = $2)`,
        [code, scope]
      );
      return res.json(result.rows);
    }
    const redeemed = req.query.redeemed === "1" || req.query.redeemed === "true";
    let limit = 50;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({ ok: false, error: "limit must be 1..500" });
      }
    }
    const result = await pool.query(
      `select ${REWARD_COLS} ${REWARD_FROM}
        where (g.redeemed_at is not null) = $1
          and ($2::uuid is null or l.org_id = $2)
        order by g.created_at desc
        limit $3`,
      [redeemed, scope, limit]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[admin/rewards] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Redeem / unredeem ------------------------------------------------------
async function setRedeemed(req, res, redeemed) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  const scope = orgScope(req);
  try {
    // Scope check first (a 403 must not flip the row).
    const existing = await pool.query(
      `select l.org_id as "orgId", g.redeemed_at as "redeemedAt", g.redeemed_via as "redeemedVia"
         ${REWARD_FROM} where g.id = $1`,
      [id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    if (scope && existing.rows[0].orgId !== scope) {
      return res.status(403).json({ ok: false, error: "forbidden: not your org" });
    }
    // A card claim is a completed, credited payout — it is NOT undoable at the
    // counter (undoing it and then handing out the counter prize would double).
    if (!redeemed && existing.rows[0].redeemedVia === "card") {
      return res.status(409).json({ ok: false, error: "a card claim can't be undone" });
    }
    let db;
    if (redeemed) {
      // Counter-redeem ONLY an open grant, atomically — so a card claim that
      // commits between the read above and here can't be overwritten to
      // 'counter' after its tickets were already credited (both lanes paying).
      db = await pool.query(
        `update reward_grant g0
            set redeemed_at = now(), redeemed_by = $2, redeemed_via = 'counter'
          where g0.id = $1 and g0.redeemed_at is null
          returning g0.id`,
        [id, actorLabel(req)]
      );
      if (db.rowCount === 0) {
        // Lost the race (or already redeemed) — surface which lane won.
        const now = await pool.query(`select redeemed_via as v from reward_grant where id = $1`, [id]);
        return res.status(409).json({
          ok: false,
          error: now.rows[0]?.v === "card" ? "already claimed to a rewards card" : "already redeemed",
        });
      }
    } else {
      db = await pool.query(
        `update reward_grant g0 set redeemed_at = null, redeemed_by = null, redeemed_via = null
          where g0.id = $1
          returning g0.id`,
        [id]
      );
    }
    if (db.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    const full = await pool.query(`select ${REWARD_COLS} ${REWARD_FROM} where g.id = $1`, [id]);
    await audit({
      action: redeemed ? "reward.redeem" : "reward.unredeem",
      entity: "reward",
      entityId: id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, reward: full.rows[0] });
  } catch (err) {
    console.error("[admin/rewards] redeem error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
}
router.post("/:id/redeem", (req, res) => setRedeemed(req, res, true));
router.post("/:id/unredeem", (req, res) => setRedeemed(req, res, false));

// --- Catalog (labels for the admin UI) --------------------------------------
router.get("/achievements", (_req, res) => res.json(ACHIEVEMENTS));
