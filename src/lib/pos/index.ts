import { locationById } from '../../data/courses';
import { useCurrentLocationId } from '../location';
import { DEV_MODE } from '../flags';
import { createCenterEdgeAdapter } from './centeredge';
import type { LoyaltyApi, OrderingApi, PosAdapter, PosConfig } from './types';

// POS integration resolution — which vendor adapter and which PAID
// capabilities the current venue has. The config comes from the venue's
// Master Control record (location.pos via the content export); no config
// means no integration, and the food/rewards surfaces don't render. This is
// the add-on model: one codebase, features switched on per venue by
// configuration — never by client-specific code.

// Dev fallback: with no venue configured (the common local state, since the
// committed content export has pos: null everywhere), DEV_MODE turns
// everything on against the CenterEdge mock so the surfaces are developable.
// Production builds set VITE_DEV_MODE=false, so real venues stay gated on
// their actual config.
const DEV_FALLBACK: PosConfig = {
  vendor: 'centeredge',
  ordering: true,
  loyalty: true,
  gameRewards: true,
  apiBase: null,
};

/** The venue's POS config, or null when the venue has no integration. */
export function posConfigFor(locationId: string): PosConfig | null {
  const configured = locationById(locationId)?.pos ?? null;
  if (configured) return configured;
  return DEV_MODE ? DEV_FALLBACK : null;
}

// One adapter instance per distinct config (vendor + apiBase), so screens
// share fetch state instead of rebuilding closures every render.
const adapters = new Map<string, PosAdapter>();

function adapterFor(config: PosConfig): PosAdapter | null {
  const key = `${config.vendor}|${config.apiBase ?? ''}`;
  const cached = adapters.get(key);
  if (cached) return cached;
  let adapter: PosAdapter | null = null;
  switch (config.vendor) {
    case 'centeredge':
      adapter = createCenterEdgeAdapter(config);
      break;
    default:
      // A vendor this build has no adapter for (config newer than the app):
      // fail closed — the venue just looks un-integrated.
      return null;
  }
  adapters.set(key, adapter);
  return adapter;
}

/** What the current venue's integration offers the UI. Each capability is
 *  null unless the venue's config enables it AND an adapter exists. */
export type PosCapabilities = {
  ordering: OrderingApi | null;
  loyalty: LoyaltyApi | null;
  /** Mini-games may credit tickets (requires loyalty; separately sold). */
  gameRewards: boolean;
};

const NONE: PosCapabilities = { ordering: null, loyalty: null, gameRewards: false };

export function posFor(locationId: string): PosCapabilities {
  const config = posConfigFor(locationId);
  if (!config) return NONE;
  const adapter = adapterFor(config);
  if (!adapter) return NONE;
  return {
    ordering: config.ordering ? adapter.ordering : null,
    loyalty: config.loyalty ? adapter.loyalty : null,
    gameRewards: config.gameRewards && config.loyalty,
  };
}

/** Reactive capabilities for the current venue — re-resolves on venue switch. */
export function usePos(): PosCapabilities {
  return posFor(useCurrentLocationId());
}
