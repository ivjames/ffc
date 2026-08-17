// The account -> loyalty-card binding (schema: user_card_link).
//
// A venue rewards card used to be a device-local value the browser held in
// localStorage, and every ticket write took the card id straight from the
// request body. That made the card number the only "credential": anyone could
// read a stranger's balances by typing their number, and credit tickets to any
// card they could name. The card is now bound to a signed-in app_user — linking
// proves possession once, and from then on every read and every write derives
// the card from the session instead of trusting the caller.
import { pool } from "../db.js";

/** The card this user has linked at this venue, or null. */
export async function linkedCardFor(appUserId, locationId) {
  const result = await pool.query(
    `select card_player_id as "cardPlayerId", created_at as "createdAt"
       from user_card_link
      where app_user_id = $1 and location_id = $2`,
    [appUserId, locationId]
  );
  return result.rows[0] ?? null;
}

/** Bind a verified card to this user at this venue (one card per venue). */
export async function linkCard(appUserId, locationId, cardPlayerId) {
  await pool.query(
    `insert into user_card_link (app_user_id, location_id, card_player_id)
       values ($1, $2, $3)
     on conflict (app_user_id, location_id)
       do update set card_player_id = excluded.card_player_id, created_at = now()`,
    [appUserId, locationId, cardPlayerId]
  );
}

export async function unlinkCard(appUserId, locationId) {
  await pool.query(`delete from user_card_link where app_user_id = $1 and location_id = $2`, [
    appUserId,
    locationId,
  ]);
}
