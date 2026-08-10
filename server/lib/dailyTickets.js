// The per-card daily ticket cap is ONE shared pool across every app-earned
// source. Both the mini-game proxy (routes/gameRewards.js, ledger
// game_ticket_award) and the golf achievement claim (routes/rewards.js, ledger
// reward_grant) count against the same budget, so a card maxed out on games
// can't then farm golf tickets and vice-versa. This is the single source of
// truth for "how many tickets has this card already earned at this venue today"
// — both endpoints sum through here, under their per-(venue, card) advisory
// xact lock, before deciding what's left to award.

/**
 * Tickets already awarded to one loyalty card at one venue, in the venue-local
 * day, across BOTH app-earned ledgers. Call inside the caller's transaction
 * while holding the per-(venue, card) advisory lock, so concurrent awards can't
 * both read a stale total.
 *
 * @param {import('pg').PoolClient} client - a client mid-transaction
 * @param {{ locationId: string, cardId: string, tz: string }} opts
 *   cardId is the vendor/loyalty card id (game_ticket_award.player_id ===
 *   reward_grant.card_player_id).
 * @returns {Promise<number>} total tickets_awarded today (>= 0)
 */
export async function dailySpentTickets(client, { locationId, cardId, tz }) {
  const r = await client.query(
    `select
       (select coalesce(sum(tickets_awarded), 0)::int
          from game_ticket_award
         where location_id = $1 and player_id = $2
           and (created_at at time zone $3)::date = (now() at time zone $3)::date)
     + (select coalesce(sum(g.tickets_awarded), 0)::int
          from reward_grant g
          join round r on r.id = g.round_id
          join course c on c.id = r.course_id
         where c.location_id = $1 and g.card_player_id = $2
           and (g.redeemed_at at time zone $3)::date = (now() at time zone $3)::date)
       as n`,
    [locationId, cardId, tz]
  );
  return r.rows[0].n;
}
