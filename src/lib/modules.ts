// À la carte module entitlements, client side.
//
// The server ships each venue's modules already RESOLVED (entitlement + vendor
// wiring + dependencies folded into one boolean per module — see
// server/lib/modules.js), so there is no policy to re-implement here. This file
// exists for one reason: a payload that predates the modules column, or a
// localStorage cache written by an older build, has no `modules` key at all —
// and that must read as the pre-modules behavior, never as "everything off".
// A venue silently losing its Food tab because of a stale cache would be a far
// worse failure than a venue briefly showing a module it hasn't bought.
import { locationById, useContentRevision } from '../data/courses';
import { useCurrentLocationId } from './location';
import type { PosConfig } from './pos/types';

export type ModuleKey = 'arcade' | 'hunt' | 'ordering' | 'rewards' | 'gameTickets';

export type Modules = Record<ModuleKey, boolean>;

/** What the app did before modules existed, derived from the venue's POS
 *  config. Mirrors legacyDefaults() in server/lib/modules.js — the fallback
 *  for payloads and caches written before the column existed. */
function fromPos(pos: PosConfig | null | undefined): Modules {
  return {
    arcade: true,
    hunt: true,
    ordering: pos?.ordering != null,
    rewards: pos?.loyalty != null,
    gameTickets: (pos?.loyalty?.gameRewards ?? false) && pos?.loyalty != null,
  };
}

/** The live module set for one venue. */
export function modulesFor(locationId: string): Modules {
  const loc = locationById(locationId);
  const resolved = loc?.modules;
  const fallback = fromPos(loc?.pos);
  if (!resolved) return fallback;
  // Per KEY fallback, not per payload: a server that gains a module this build
  // doesn't know about, or vice versa, must not blank out the rest.
  return {
    arcade: resolved.arcade ?? fallback.arcade,
    hunt: resolved.hunt ?? fallback.hunt,
    ordering: resolved.ordering ?? fallback.ordering,
    rewards: resolved.rewards ?? fallback.rewards,
    gameTickets: resolved.gameTickets ?? fallback.gameTickets,
  };
}

/** Reactive module set for the current venue — re-resolves on venue switch and
 *  when live content hydration swaps in updated config, so enabling a module in
 *  Master Control reaches players without a redeploy. */
export function useModules(): Modules {
  useContentRevision();
  return modulesFor(useCurrentLocationId());
}
