import { getCurrentLocationId } from '../location';
import { getLinkedPlayerId } from '../rewardsCard';
import { apiUrl } from '../../sync';
import { posFor, type PosCapabilities } from './index';

// Adoption bonus claim — the client half of the one-time install / sign-in
// ticket reward. Like game awards, everything vendor/venue-specific resolves
// here: the venue must have the ticket-reward add-on, and the device must have
// a linked arcade card for the tickets to land on. The claim goes through OUR
// server (POST /api/game-rewards/bonus), the trust boundary that decides the
// amount, enforces one-time-per-card, and credits the vendor. The number the
// server returns is what actually landed — render THAT.

export type BonusKind = 'install' | 'signin';

export type BonusPlan =
  | { skip: 'unavailable' } // venue hasn't got the ticket-reward add-on
  | { skip: 'no-card' } // has it, but this device has no linked card to credit
  | { request: { playerId: string; kind: BonusKind } };

/** Pure gating decision — unit-testable without the network or DOM. */
export function resolveBonusClaim(opts: {
  capabilities: Pick<PosCapabilities, 'gameRewards'>;
  playerId: string | null;
  kind: BonusKind;
}): BonusPlan {
  if (!opts.capabilities.gameRewards) return { skip: 'unavailable' };
  if (!opts.playerId) return { skip: 'no-card' };
  return { request: { playerId: opts.playerId, kind: opts.kind } };
}

export type BonusOutcome =
  | { status: 'unavailable' }
  | { status: 'no-card' } // prompt the player to link their card to collect
  | { status: 'disabled' } // venue set this milestone's amount to 0
  | { status: 'awarded'; tickets: number }
  | { status: 'error'; error: string };

export async function submitBonus(body: {
  locationId: string;
  playerId: string;
  kind: BonusKind;
}): Promise<BonusOutcome> {
  try {
    const res = await fetch(apiUrl('/api/game-rewards/bonus'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok !== true) {
      if (res.status === 403) return { status: 'unavailable' };
      return { status: 'error', error: data.error ?? `HTTP ${res.status}` };
    }
    if (data.status === 'disabled') return { status: 'disabled' };
    return { status: 'awarded', tickets: data.ticketsAwarded };
  } catch {
    return { status: 'error', error: 'network error' };
  }
}

/** Claim the one-time bonus for `kind` onto the linked card, if this venue
 *  offers it. Resolves the venue + card here; returns 'no-card' so the caller
 *  can prompt the player to link and collect. */
export async function claimAdoptionBonus(kind: BonusKind): Promise<BonusOutcome> {
  const locationId = getCurrentLocationId();
  const plan = resolveBonusClaim({
    capabilities: posFor(locationId),
    playerId: getLinkedPlayerId(),
    kind,
  });
  if ('skip' in plan) {
    return plan.skip === 'no-card' ? { status: 'no-card' } : { status: 'unavailable' };
  }
  return submitBonus({ locationId, ...plan.request });
}

// One-shot bookkeeping so we don't re-attempt / re-toast a milestone every
// launch (the server is idempotent per card, but the UX shouldn't repeat).
const HANDLED_KEY = (kind: BonusKind) => `ffc.bonusHandled.${kind}`;

export function isBonusHandled(kind: BonusKind): boolean {
  try {
    return localStorage.getItem(HANDLED_KEY(kind)) === '1';
  } catch {
    return false;
  }
}

export function markBonusHandled(kind: BonusKind): void {
  try {
    localStorage.setItem(HANDLED_KEY(kind), '1');
  } catch {
    /* private mode — we'll just re-attempt next launch (idempotent server-side) */
  }
}
