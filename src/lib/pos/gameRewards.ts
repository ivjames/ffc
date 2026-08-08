import { getCurrentLocationId } from '../location';
import { getLinkedPlayerId } from '../rewardsCard';
import { posFor, type PosCapabilities } from './index';
import type { RewardResult } from './types';

// Game ticket awards — the one place mini-games touch the POS layer. Games
// call awardGameTickets() from their end screen (via the GameTicketAward
// component in features/fun); everything vendor- and venue-specific is
// resolved here: the venue must have the gameRewards add-on (which requires
// a loyalty integration), the device must have a linked rewards card, and
// the award must be idempotent per game session so replays/re-mounts can
// never double-credit.

export type GameAwardPlan =
  | { skip: 'unavailable' } // venue hasn't bought gameRewards (or no loyalty)
  | { skip: 'no-card' } // venue has it, but this device has no linked card
  | { skip: 'nothing' } // zero tickets — nothing to award
  | {
      request: {
        playerId: string;
        tickets: number;
        source: string;
        idempotencyKey: string;
      };
    };

/** Pure gating decision — unit-testable without the network or DOM. */
export function resolveGameAward(opts: {
  capabilities: Pick<PosCapabilities, 'gameRewards'>;
  playerId: string | null;
  game: string;
  tickets: number;
  sessionId: string;
}): GameAwardPlan {
  if (!opts.capabilities.gameRewards) return { skip: 'unavailable' };
  if (!opts.playerId) return { skip: 'no-card' };
  if (!Number.isInteger(opts.tickets) || opts.tickets < 1) return { skip: 'nothing' };
  return {
    request: {
      playerId: opts.playerId,
      tickets: opts.tickets,
      source: `game:${opts.game}`,
      // One award per (game, session): a re-mounted end screen or retried
      // request replays server-side instead of crediting twice.
      idempotencyKey: `game:${opts.game}:${opts.sessionId}`,
    },
  };
}

export type GameAwardOutcome =
  | { status: 'unavailable' }
  | { status: 'no-card' }
  | { status: 'awarded'; tickets: number; newTicketBalance: number }
  | { status: 'error'; error: string };

/** Credit a finished game's tickets to the linked card, if this venue sells
 *  that. `sessionId` must be stable for one played round (new id per
 *  restart) — it is the idempotency key. */
export async function awardGameTickets(opts: {
  game: string;
  tickets: number;
  sessionId: string;
}): Promise<GameAwardOutcome> {
  const capabilities = posFor(getCurrentLocationId());
  const plan = resolveGameAward({
    capabilities,
    playerId: getLinkedPlayerId(),
    ...opts,
  });
  if ('skip' in plan) {
    return plan.skip === 'no-card' ? { status: 'no-card' } : { status: 'unavailable' };
  }
  // gameRewards implies loyalty is resolvable (posFor guarantees it).
  const res: RewardResult = await capabilities.loyalty!.rewardTickets(plan.request);
  if ('error' in res) return { status: 'error', error: res.error };
  return {
    status: 'awarded',
    tickets: res.ticketsAwarded,
    newTicketBalance: res.newTicketBalance,
  };
}
