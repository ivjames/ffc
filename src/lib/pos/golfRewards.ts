import { getLinkedPlayerId } from '../rewardsCard';
import { posFor } from './index';
import { submitAward, type GameAwardOutcome } from './gameRewards';

// Golf round achievements credit the linked card as tickets — the same lane as
// mini-game rewards, and through the same server award proxy (the browser never
// credits the POS directly): the server caps the payout, records the issuance,
// and holds the vendor credentials. The server still computes achievements
// (server/lib/rewards.js) and its counter codes remain the fallback for venues
// without the loyalty add-on. Achievement keys mirror server/lib/rewards.js.

// Every golf achievement reports under one server reward source (registered in
// server/lib/gameRewards.js OTHER_REWARD_SOURCES); per-achievement idempotency
// comes from the session id (golfRewardKey).
const GOLF_SOURCE = 'golf';

// Tickets per achievement, on the same payout scale as the games. Tunable.
export const GOLF_ACHIEVEMENT_TICKETS: Record<string, number> = {
  hole_in_one: 100,
  under_par: 50,
  hunt_master: 75,
};

/** Ticket value for a golf achievement (0 for an unknown/unpriced one). */
export function golfTicketsFor(achievement: string): number {
  return GOLF_ACHIEVEMENT_TICKETS[achievement] ?? 0;
}

/** Which players' achievements this device credits to its linked card. A
 *  single-device (pass-and-play) round shares one device and one card, so it
 *  credits every player — no counter codes. A shared multi-device round credits
 *  only this device's own slot; every other player is on their own phone and
 *  card, and every phone fetches the same grant list (clientId `shared:<id>`),
 *  so crediting all of them would pay each reward onto every card. */
export function deviceOwnsSlot(opts: {
  deviceSlot: number;
  isShared: boolean;
  playerIndex: number;
}): boolean {
  return !opts.isShared || opts.playerIndex === opts.deviceSlot;
}

/** Stable idempotency key per (round, player, achievement) — a re-viewed
 *  summary or a card linked after the fact replays instead of double-crediting.
 */
export function golfRewardKey(clientId: string, playerIndex: number, achievement: string): string {
  return `golf:${clientId}:${playerIndex}:${achievement}`;
}

/** Credit one round achievement to the linked card, if the ROUND'S venue sells
 *  the gameRewards add-on and a card is linked. Gates on the round's own
 *  `locationId` (not the mutable current location) and submits through the
 *  server award proxy, which caps + records + credits the vendor. */
export async function awardGolfReward(opts: {
  locationId: string;
  achievement: string;
  clientId: string;
  playerIndex: number;
}): Promise<GameAwardOutcome> {
  const capabilities = posFor(opts.locationId);
  if (!capabilities.gameRewards) return { status: 'unavailable' };
  const playerId = getLinkedPlayerId();
  if (!playerId) return { status: 'no-card' };
  const tickets = golfTicketsFor(opts.achievement);
  if (!Number.isInteger(tickets) || tickets < 1) return { status: 'unavailable' };
  return submitAward({
    locationId: opts.locationId,
    playerId,
    game: GOLF_SOURCE,
    tickets,
    sessionId: golfRewardKey(opts.clientId, opts.playerIndex, opts.achievement),
  });
}
