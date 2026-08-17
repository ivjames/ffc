// The per-card daily ticket cap. Every app-earned ticket now comes from ONE
// ledger — the mini-game proxy (routes/gameRewards.js, ledger
// game_ticket_award) — so this is a single sum rather than a union.
//
// It used to span two ledgers: golf achievements paid tickets too
// (reward_grant), and the shared pool stopped a card maxed out on games from
// then farming golf. Golf achievements no longer pay anything (see
// lib/rewards.js), so that half is gone. Kept as its own module because it
// remains the single source of truth for "how many tickets has this card
// already earned at this venue today", and because a second earning lane
// would slot back in here rather than in the award endpoint.
//
// The one-time adoption bonuses (lib/adoptionBonus.js) are deliberately NOT
// counted: they're a milestone economy, not a per-round one, and are excluded
// from this cap by design.

/**
 * Tickets already awarded to one loyalty card at one venue, in the venue-local
 * day. Call inside the caller's transaction while holding the per-(venue, card)
 * advisory lock, so concurrent awards can't both read a stale total.
 *
 * @param {import('pg').PoolClient} client - a client mid-transaction
 * @param {{ locationId: string, cardId: string, tz: string }} opts
 *   cardId is the vendor/loyalty card id (game_ticket_award.player_id).
 * @returns {Promise<number>} total tickets_awarded today (>= 0)
 */
export async function dailySpentTickets(client, { locationId, cardId, tz }) {
  const r = await client.query(
    `select coalesce(sum(tickets_awarded), 0)::int as n
       from game_ticket_award
      where location_id = $1 and player_id = $2
        and (created_at at time zone $3)::date = (now() at time zone $3)::date`,
    [locationId, cardId, tz]
  );
  return r.rows[0].n;
}
