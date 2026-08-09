// Admin: game ticket economy — mounted at /api/admin/game-rewards.
//
//   GET /meta            — the game registry + platform limits, so Master
//                          Control's caps editor renders from the same source
//                          of truth the award proxy enforces.
//   GET /usage?days=N    — app-issued ticket rollup from game_ticket_award
//                          (routes/gameRewards.js): per day+venue+game totals
//                          plus the window's top-earning cards, so an
//                          abnormal issuance pattern is visible in Master
//                          Control instead of discovered at the prize
//                          counter. hunt-usage precedent.
//
// Org-scoping: an org_admin sees only their own org's venues (same rule as
// huntUsage.js).
import { Router } from "express";
import { pool } from "../../db.js";
import { orgScope } from "../../lib/adminAuth.js";
import {
  GAME_REWARD_GAMES,
  OTHER_REWARD_SOURCES,
  HARD_MAX_PER_ROUND,
  DEFAULT_DAILY_PER_CARD,
  MAX_DAILY_PER_CARD,
} from "../../lib/gameRewards.js";

export const router = Router();

router.get("/meta", (_req, res) => {
  res.json({
    // Every ticket-issuing source the award proxy accepts — the mini-games plus
    // non-game sources (mini-golf) — so the caps editor can set a per-round cap
    // for each and the issuance rollup can label them (not raw keys).
    games: [...GAME_REWARD_GAMES, ...OTHER_REWARD_SOURCES],
    hardMaxPerRound: HARD_MAX_PER_ROUND,
    defaultDailyPerCard: DEFAULT_DAILY_PER_CARD,
    maxDailyPerCard: MAX_DAILY_PER_CARD,
  });
});

router.get("/usage", async (req, res) => {
  const scope = orgScope(req);

  // days — rollup window, default 30, clamped to [1, 90].
  let days = Number.parseInt(req.query.days, 10);
  if (!Number.isFinite(days)) days = 30;
  days = Math.max(1, Math.min(90, days));

  try {
    const [rollup, topCards] = await Promise.all([
      // Per venue-local day (the same day boundary the daily cap uses).
      pool.query(
        `
        select (a.created_at at time zone coalesce(l.tz, 'America/Los_Angeles'))::date as day,
               l.id   as location_id,
               l.name as location_name,
               a.game,
               count(*)                                        as rounds,
               count(*) filter (where a.status = 'daily_cap')  as capped_rounds,
               count(*) filter (where a.status = 'pending')    as pending_rounds,
               -- confirmed issuance only: 'pending' rows reserve daily-cap
               -- budget but their vendor credit never confirmed
               coalesce(sum(a.tickets_awarded)
                          filter (where a.status = 'awarded'), 0) as tickets,
               count(distinct a.player_id)                     as cards
          from game_ticket_award a
          join location l on l.id = a.location_id
         where a.created_at >= now() - $2::int * interval '1 day'
           and ($1::uuid is null or l.org_id = $1)
         group by 1, l.id, l.name, a.game
         order by 1 desc, l.name asc, tickets desc
      `,
        [scope, days]
      ),
      pool.query(
        `
        select l.id   as location_id,
               l.name as location_name,
               a.player_id,
               count(*)                            as rounds,
               coalesce(sum(a.tickets_awarded)
                          filter (where a.status = 'awarded'), 0) as tickets
          from game_ticket_award a
          join location l on l.id = a.location_id
         where a.created_at >= now() - $2::int * interval '1 day'
           and ($1::uuid is null or l.org_id = $1)
         group by l.id, l.name, a.player_id
         order by tickets desc
         limit 20
      `,
        [scope, days]
      ),
    ]);

    return res.json({
      days,
      rows: rollup.rows.map((r) => ({
        day: r.day,
        locationId: r.location_id,
        locationName: r.location_name,
        game: r.game,
        rounds: Number(r.rounds),
        cappedRounds: Number(r.capped_rounds),
        pendingRounds: Number(r.pending_rounds),
        tickets: Number(r.tickets),
        cards: Number(r.cards),
      })),
      topCards: topCards.rows.map((r) => ({
        locationId: r.location_id,
        locationName: r.location_name,
        playerId: r.player_id,
        rounds: Number(r.rounds),
        tickets: Number(r.tickets),
      })),
    });
  } catch (err) {
    console.error("[admin/game-rewards] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
