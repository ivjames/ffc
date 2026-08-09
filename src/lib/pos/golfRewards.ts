import { getLinkedPlayerId } from '../rewardsCard';
import { posFor } from './index';
import type { GameAwardOutcome } from './gameRewards';
import type { RewardResult } from './types';

// Golf round achievements credit the linked card as loyalty tickets — the same
// lane as mini-game rewards (loyalty.rewardTickets), instead of a counter code.
// This is the client side of the "one lane, on the card" model: the server
// still computes achievements (server/lib/rewards.js) and its codes remain the
// fallback for venues without the loyalty add-on, but where the card exists the
// app credits it directly. Achievement keys mirror server/lib/rewards.js.

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

/** Stable idempotency key per (round, player, achievement) — a re-viewed
 *  summary or a card linked after the fact replays instead of double-crediting.
 */
export function golfRewardKey(clientId: string, playerIndex: number, achievement: string): string {
  return `golf:${clientId}:${playerIndex}:${achievement}`;
}

/** Credit one round achievement to the linked card, if the ROUND'S venue sells
 *  the gameRewards add-on and a card is linked. Mirrors awardGameTickets: same
 *  gating, same idempotent injection endpoint. Resolves the POS from the round's
 *  own `locationId` (not the mutable current location), so switching venues
 *  after a round doesn't route its reward through the wrong integration. */
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
  // gameRewards implies loyalty is resolvable (posFor guarantees it).
  const res: RewardResult = await capabilities.loyalty!.rewardTickets({
    playerId,
    tickets,
    source: `golf:${opts.achievement}`,
    idempotencyKey: golfRewardKey(opts.clientId, opts.playerIndex, opts.achievement),
  });
  if ('error' in res) return { status: 'error', error: res.error };
  return {
    status: 'awarded',
    tickets: res.ticketsAwarded,
    newTicketBalance: res.newTicketBalance,
  };
}
