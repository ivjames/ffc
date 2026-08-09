// Admin: reward redemption (punchlist #8 tier 1).
//   GET  /api/admin/rewards?code=            look up one code (the counter flow)
//   GET  /api/admin/rewards?redeemed=&limit= recent grants (default: unredeemed)
//   POST /api/admin/rewards/:id/redeem       mark handed out
//   POST /api/admin/rewards/:id/unredeem     undo a mistaken redemption
//
// The counter flow: player shows a code from their final scorecard, staff type
// it here, see who/what/when, and mark it redeemed. Org-scoping rides the
// round -> course -> location -> org chain, like the overview rollup.
import { Router } from "express";
import { pool } from "../../db.js";
import { audit, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";
import { ACHIEVEMENTS } from "../../lib/rewards.js";

export const router = Router();

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
