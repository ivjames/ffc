import { locationById, useContentRevision } from '../../data/courses';
import { useCurrentLocationId } from '../location';
import { DEV_MODE } from '../flags';
import { createCenterEdgeAdapter } from './centeredge';
import type { OrderingApi, PosAdapter, PosCapabilityConfig, PosConfig } from './types';

// POS integration resolution — which vendor adapter serves each PAID
// capability for the current venue. The config comes from the venue's Master
// Control record (location.pos via the content export); no config means no
// integration, and the food/rewards surfaces don't render. Capabilities are
// decoupled: ordering and loyalty each name their own vendor, so a venue can
// mix systems. This is the add-on model: one codebase, features switched on
// per venue by configuration — never by client-specific code.

// Dev fallback: with no venue configured (the common local state, since the
// committed content export has pos: null everywhere), DEV_MODE turns
// everything on against the CenterEdge mock so the surfaces are developable.
// Production builds set VITE_DEV_MODE=false, so real venues stay gated on
// their actual config.
const DEV_FALLBACK: PosConfig = {
  ordering: { vendor: 'centeredge', apiBase: null },
  loyalty: { vendor: 'centeredge', apiBase: null, gameRewards: true },
};

/** The venue's POS config, or null when the venue has no integration. */
export function posConfigFor(locationId: string): PosConfig | null {
  const configured = locationById(locationId)?.pos ?? null;
  if (configured) return configured;
  return DEV_MODE ? DEV_FALLBACK : null;
}

// One adapter instance per distinct (vendor, apiBase), so capability blocks
// that name the same backend share fetch state instead of rebuilding
// closures every render.
const adapters = new Map<string, PosAdapter | null>();

function adapterFor(block: PosCapabilityConfig): PosAdapter | null {
  const key = `${block.vendor}|${block.apiBase ?? ''}`;
  if (adapters.has(key)) return adapters.get(key)!;
  let adapter: PosAdapter | null;
  switch (block.vendor) {
    case 'centeredge':
      adapter = createCenterEdgeAdapter(block);
      break;
    default:
      // A vendor this build has no adapter for (config newer than the app):
      // fail closed — that capability just looks un-integrated.
      adapter = null;
  }
  adapters.set(key, adapter);
  return adapter;
}

/** What the current venue's integration offers the UI. Each capability is
 *  null unless the venue's config names a vendor for it AND that vendor's
 *  adapter implements it. */
export type PosCapabilities = {
  ordering: OrderingApi | null;
  /** The venue sells rewards cards. A capability FLAG, not an API: the browser
   *  no longer talks to the loyalty vendor at all — reads and writes both go
   *  through our own /api/loyalty and /api/game-rewards, which hold the vendor
   *  credentials and bind every card to the signed-in account. */
  loyalty: boolean;
  /** Mini-games may credit tickets (requires loyalty; separately sold). */
  gameRewards: boolean;
};

export function posFor(locationId: string): PosCapabilities {
  const config = posConfigFor(locationId);
  const ordering = config?.ordering ? (adapterFor(config.ordering)?.ordering ?? null) : null;
  // Loyalty needs no client adapter — only whether the venue named a vendor.
  const loyalty = config?.loyalty != null;
  return {
    ordering,
    loyalty,
    gameRewards: (config?.loyalty?.gameRewards ?? false) && loyalty,
  };
}

/** Reactive capabilities for the current venue — re-resolves on venue switch
 *  AND when live content hydration swaps in updated POS config (so enabling a
 *  capability in Master Control reaches players without a redeploy). */
export function usePos(): PosCapabilities {
  useContentRevision(); // re-render when the live catalog (POS config) updates
  return posFor(useCurrentLocationId());
}
