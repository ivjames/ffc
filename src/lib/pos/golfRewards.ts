import { getLinkedPlayerId } from '../rewardsCard';
import { posFor } from './index';
import { apiUrl } from '../../sync';
import type { GameAwardOutcome } from './gameRewards';

// Golf round achievements redeem to the linked card as tickets through the
// server's grant-backed claim endpoint (POST /api/rewards/claim). Golf is NOT a
// client-scored game: the server looks up the recorded `reward_grant`, derives
// the payout from its achievement, and marks the grant redeemed — the client
// can't set the amount. Tickets are the ONLY player-facing payout: a venue
// without the loyalty add-on simply doesn't reward golf here (no counter codes
// anywhere in the app). The app side just identifies (round, player,
// achievement) and renders the tickets the server says it paid.

/** Which players' achievements this device redeems to its linked card. A
 *  single-device (pass-and-play) round shares one device and one card, so it
 *  claims every player. A shared multi-device round claims only this device's
 *  own slot; every other player is on their own phone and card, and every phone
 *  fetches the same grant list (clientId `shared:<id>`), so claiming all of
 *  them would pay each reward onto every card. */
export function deviceOwnsSlot(opts: {
  deviceSlot: number;
  isShared: boolean;
  playerIndex: number;
}): boolean {
  return !opts.isShared || opts.playerIndex === opts.deviceSlot;
}

/** Redeem one achievement to the linked card, if the ROUND'S venue sells the
 *  gameRewards add-on and a card is linked. The server validates the grant and
 *  computes the payout; the outcome's ticket count is what actually landed. */
export async function awardGolfReward(opts: {
  locationId: string;
  achievement: string;
  clientId: string;
  playerIndex: number;
}): Promise<GameAwardOutcome> {
  // Gate on the round's own venue (not the mutable current location).
  if (!posFor(opts.locationId).gameRewards) return { status: 'unavailable' };
  const playerId = getLinkedPlayerId();
  if (!playerId) return { status: 'no-card' };
  try {
    const res = await fetch(apiUrl('/api/rewards/claim'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: opts.clientId,
        playerIndex: opts.playerIndex,
        achievement: opts.achievement,
        playerId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok !== true) {
      // Venue config changed under us — mirror the pre-flight gating.
      if (res.status === 403) return { status: 'unavailable' };
      return { status: 'error', error: data.error ?? `HTTP ${res.status}` };
    }
    return {
      status: 'awarded',
      tickets: data.ticketsAwarded,
      newTicketBalance: data.newTicketBalance ?? null,
    };
  } catch {
    return { status: 'error', error: 'network error' };
  }
}
