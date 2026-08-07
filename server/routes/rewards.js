// GET /api/rewards?clientId= — the rewards earned by a round, for the final
// scorecard's "show this at the counter" screen (punchlist #8 tier 1).
//
// Keyed by the round's client-generated UUID (the same unguessable id the
// sync path dedupes on), so only the device that played the round — or someone
// it shared the link with — can pull its codes. No auth beyond that: the
// stakes are arcade tickets, and staff mark codes redeemed in Master Control,
// so a code only ever pays out once.
import { Router } from "express";
import { pool } from "../db.js";

export const router = Router();

router.get("/", async (req, res) => {
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : "";
  if (clientId.length === 0 || clientId.length > 200) {
    return res.status(400).json({ ok: false, error: "clientId is required" });
  }
  try {
    const result = await pool.query(
      `select g.code, g.player_index as "playerIndex", g.player_tag as "playerTag",
              g.achievement, g.redeemed_at as "redeemedAt", g.created_at as "createdAt"
         from reward_grant g
         join round r on r.id = g.round_id
        where r.client_id = $1
        order by g.player_index, g.achievement`,
      [clientId]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[rewards] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
