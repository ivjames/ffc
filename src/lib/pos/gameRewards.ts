import { getCurrentLocationId } from '../location';
import { getLinkedPlayerId } from '../rewardsCard';
import { apiUrl } from '../../sync';
import { posFor, type PosCapabilities } from './index';

// Game ticket awards — the one place mini-games touch the ticket economy.
// Games call awardGameTickets() from their end screen (via the GameTicketAward
// component in features/fun); everything vendor- and venue-specific is
// resolved here: the venue must have the gameRewards add-on (which requires
// a loyalty integration), the device must have a linked rewards card, and
// the award must be idempotent per game session so replays/re-mounts can
// never double-credit.
//
// The award goes through OUR API (POST /api/game-rewards/award), not the POS
// vendor directly: the browser's ticket math is a display convenience, and
// the server is the trust boundary — it validates the payout against the
// per-game ceilings, enforces the card's daily cap (both venue-tunable in
// Master Control), records the award, and only then credits the vendor with
// server-held credentials. The number the server returns is what actually
// landed, so always render THAT, not the requested count.

export type GameAwardPlan =
  | { skip: 'unavailable' } // venue hasn't bought gameRewards (or no loyalty)
  | { skip: 'no-card' } // venue has it, but this device has no linked card
  | { skip: 'nothing' } // zero tickets — nothing to award
  | {
      request: {
        playerId: string;
        tickets: number;
        game: string;
        sessionId: string;
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
      game: opts.game,
      sessionId: opts.sessionId,
    },
  };
}

export type GameAwardOutcome =
  | { status: 'unavailable' }
  | { status: 'no-card' }
  | { status: 'awarded'; tickets: number; newTicketBalance: number | null }
  | { status: 'daily-cap'; dailyCap: number }
  | { status: 'error'; error: string };

/** POST an award to OUR server proxy — the trust boundary that validates the
 *  payout against the per-game/per-card caps, records it in the issuance
 *  rollup, and credits the vendor with server-held credentials. Shared by the
 *  game and mini-golf award paths; render the returned count, not the request.
 *  `sessionId` is the idempotency key (stable per award event). */
export async function submitAward(body: {
  locationId: string;
  playerId: string;
  game: string;
  tickets: number;
  sessionId: string;
}): Promise<GameAwardOutcome> {
  try {
    const res = await fetch(apiUrl('/api/game-rewards/award'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok !== true) {
      // The venue config changed under us — mirror the pre-flight gating.
      if (res.status === 403) return { status: 'unavailable' };
      return { status: 'error', error: data.error ?? `HTTP ${res.status}` };
    }
    if (data.status === 'daily-cap') {
      return { status: 'daily-cap', dailyCap: data.dailyCap };
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

/** Credit a finished game's tickets to the linked card, if this venue sells
 *  that. `sessionId` must be stable for one played round (new id per
 *  restart) — it is the idempotency key. */
export async function awardGameTickets(opts: {
  game: string;
  tickets: number;
  sessionId: string;
}): Promise<GameAwardOutcome> {
  const locationId = getCurrentLocationId();
  const capabilities = posFor(locationId);
  const plan = resolveGameAward({
    capabilities,
    playerId: getLinkedPlayerId(),
    ...opts,
  });
  if ('skip' in plan) {
    return plan.skip === 'no-card' ? { status: 'no-card' } : { status: 'unavailable' };
  }
  return submitAward({ locationId, ...plan.request });
}
