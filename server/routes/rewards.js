// GET /api/rewards?clientId= — the rewards earned by a round, for the final
// scorecard (punchlist #8 tier 1).
//
// Keyed by the round's client-generated UUID (the same unguessable id the
// sync path dedupes on), so only the device that played the round — or someone
// it shared the link with — can pull its rewards. No auth beyond that: the
// stakes are arcade tickets.
//
// The grant's `code` is DELIBERATELY not returned: tickets on the loyalty card
// are the only player-facing payout, and the player app must never surface a
// redemption code. The code stays server-side as the grant's staff-redemption
// identity in Master Control.
import { Router } from "express";
import { pool } from "../db.js";
import { achievementTickets } from "../lib/rewards.js";
import { effectiveCaps } from "../lib/gameRewards.js";
import { dailySpentTickets } from "../lib/dailyTickets.js";
import { rewardTickets } from "../lib/posLoyalty.js";
import { requireUser } from "../lib/userAuth.js";
import { linkedCardFor } from "../lib/cardLink.js";

const VENUE_TZ = process.env.VENUE_TZ || "America/Los_Angeles";

export const router = Router();

router.get("/", async (req, res) => {
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : "";
  if (clientId.length === 0 || clientId.length > 200) {
    return res.status(400).json({ ok: false, error: "clientId is required" });
  }
  try {
    const result = await pool.query(
      `select g.player_index as "playerIndex", g.player_tag as "playerTag",
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

// POST /api/rewards/claim — bank an earned achievement to a loyalty card as
// tickets. Unlike the game-rewards proxy, golf is NOT client-scored: the server
// looks up the stored `reward_grant`, derives the payout from its achievement,
// and refuses if no grant exists — so a request can't mint tickets without an
// achievement or over-pay one. `reward_grant.redeemed_at` is the single consume
// point, so a grant is banked exactly once and a re-opened summary settles from
// the row instead of crediting twice.
//
// The round's unguessable clientId still says WHICH grant is being claimed, but
// it is no longer the whole auth story: claiming credits a card, so the caller
// must be signed in and the card is the one bound to that account at the
// venue (lib/cardLink.js). A leaked clientId therefore can't redirect someone
// else's achievement onto an attacker's card.
router.post("/claim", requireUser, async (req, res) => {
  const { clientId, playerIndex, achievement } = req.body ?? {};
  if (typeof clientId !== "string" || clientId.length < 1 || clientId.length > 200) {
    return res.status(400).json({ ok: false, error: "clientId is required" });
  }
  if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex > 3) {
    return res.status(400).json({ ok: false, error: "playerIndex must be an integer 0..3" });
  }
  if (typeof achievement !== "string" || achievement.length < 1 || achievement.length > 64) {
    return res.status(400).json({ ok: false, error: "achievement is required" });
  }
  const tickets = achievementTickets(achievement);
  if (tickets < 1) return res.status(400).json({ ok: false, error: "unknown achievement" });

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Lock this grant so concurrent claims serialize on the same row.
    const gres = await client.query(
      `select g.id, g.redeemed_at, g.tickets_awarded, g.pos_transaction_id,
              g.card_player_id, l.pos as pos, l.id as location_id, l.tz as tz
         from reward_grant g
         join round r on r.id = g.round_id
         join course c on c.id = r.course_id
         left join location l on l.id = c.location_id
        where r.client_id = $1 and g.player_index = $2 and g.achievement = $3
        for update of g`,
      [clientId, playerIndex, achievement]
    );
    const grant = gres.rows[0];
    if (!grant) {
      await client.query("rollback");
      return res.status(404).json({ ok: false, error: "no such achievement grant" });
    }
    const loyalty = grant.pos?.loyalty ?? null;
    if (!loyalty?.gameRewards) {
      await client.query("rollback");
      return res.status(403).json({ ok: false, error: "card rewards not enabled for this venue" });
    }
    if (!grant.location_id) {
      await client.query("rollback");
      return res.status(409).json({ ok: false, error: "grant has no venue" });
    }
    // Whose card gets the tickets: the signed-in account's binding at this
    // venue, not a card id supplied by the caller.
    const link = await linkedCardFor(req.user.id, grant.location_id);
    if (!link) {
      await client.query("rollback");
      return res.status(409).json({ ok: false, error: "no rewards card linked" });
    }
    const playerId = link.cardPlayerId;

    if (grant.redeemed_at) {
      // Already banked to a card (redeemed_at is the single consume point).
      if (grant.pos_transaction_id) {
        // Already credited to a card; answer from the row (re-opened summary).
        await client.query("commit");
        return res.json({
          ok: true,
          status: "awarded",
          ticketsAwarded: grant.tickets_awarded,
          newTicketBalance: null,
          duplicate: true,
        });
      }
      // Card-claimed but the vendor credit never settled (a crash between the
      // two) — keep the claim and retry the credit below under the same key.
      await client.query("commit");
    } else {
      // First claim. Golf shares the SAME per-card daily cap as the mini-games
      // (one pool — lib/dailyTickets.js): serialize same-card awards on the
      // per-(venue, card) advisory lock, sum today's spend across both ledgers,
      // and clamp this achievement's payout to what's left of the budget.
      const dailyCap = effectiveCaps(grant.pos, achievement).dailyPerCard;
      const tz = grant.tz || VENUE_TZ;
      await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
        grant.location_id,
        playerId,
      ]);
      const spent = await dailySpentTickets(client, {
        locationId: grant.location_id,
        cardId: playerId,
        tz,
      });
      const award = Math.min(tickets, Math.max(0, dailyCap - spent));
      if (award <= 0) {
        // Card is already at its daily cap. Do NOT consume the grant — the
        // achievement stays claimable another day; nothing is credited now.
        await client.query("rollback");
        return res.json({ ok: true, status: "daily-cap", ticketsAwarded: 0, dailyCap });
      }
      await client.query(
        `update reward_grant
            set redeemed_at = now(), tickets_awarded = $2, card_player_id = $3
          where id = $1`,
        [grant.id, award, playerId]
      );
      await client.query("commit");
      // Reflect the reserved (clamped) amount in the row we credit from below.
      grant.tickets_awarded = award;
      grant.card_player_id = grant.card_player_id || playerId;
    }

    const payTickets = grant.tickets_awarded ?? tickets;
    // Always credit the card THIS claim reserved — on a retry that's the stored
    // card_player_id, not the current request's (the linked card may have
    // changed between attempts, but the reward belongs to the reserved card).
    const creditCard = grant.card_player_id || playerId;
    // The pre-proxy client wrote this exact vendor key directly; reuse it so a
    // summary credited before this deploy de-dupes vendor-side, not double-pays.
    const pos = await rewardTickets(loyalty, {
      playerId: creditCard,
      tickets: payTickets,
      source: `golf:${achievement}`,
      idempotencyKey: `golf:${clientId}:${playerIndex}:${achievement}`,
    });
    if (pos.ok !== true) {
      // The claim (consume) holds this reward for the card; a retry replays the
      // credit under the same idempotency key (the vendor de-dupes).
      console.error("[rewards/claim] POS credit failed (claim held):", pos.error);
      return res.status(502).json({ ok: false, error: pos.error });
    }
    await pool.query(`update reward_grant set pos_transaction_id = $2 where id = $1`, [
      grant.id,
      pos.transactionId ?? "credited",
    ]);
    return res.json({
      ok: true,
      status: "awarded",
      ticketsAwarded: payTickets,
      newTicketBalance: pos.newTicketBalance ?? null,
    });
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error("[rewards/claim] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});
