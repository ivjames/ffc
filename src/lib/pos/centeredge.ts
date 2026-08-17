// CenterEdge adapter — the platform's first POS integration.
//
// Today this talks to the local mock (`mock-centeredge/`, default port 8070) —
// we are pre-credential with CenterEdge, so the wire contract is our best
// guess at Advantage Web Services and the mock is the reference
// implementation. When real credentials land, this file is the entire blast
// radius: base URL (per-venue via PosConfig.apiBase), the auth flow in
// `authenticate()`, and any field-name reconciliation between the neutral
// types and their real payloads.
import type {
  Fail,
  Menu,
  Order,
  PlaceOrderResult,
  PosAdapter,
  PosCapabilityConfig,
} from './types';

// Dev default when the venue config carries no apiBase override.
const DEFAULT_BASE =
  (import.meta.env.VITE_CENTEREDGE_API_BASE as string | undefined) ?? 'http://localhost:8070';

// The mock's static dev token — works out of the box with `npm run
// mock:centeredge`. Real integration replaces this via authenticate(), and the
// long-term shape is a server-side proxy holding per-venue credentials (the
// lib/vision.js pattern) so no token ships in the bundle at all.
let bearerToken = 'ce-mock-dev-token';

/** Trade client credentials for a bearer token (stored module-side).
 *  Optional against the mock — the static dev token already works. */
export async function authenticate(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { access_token: string };
    bearerToken = data.access_token;
    return true;
  } catch {
    return false;
  }
}

// CenterEdge implements both capabilities; a venue's config decides which of
// them it actually buys (and may point each capability at a different vendor).
export function createCenterEdgeAdapter(config: PosCapabilityConfig): PosAdapter {
  const base = (config.apiBase ?? DEFAULT_BASE).replace(/\/$/, '');

  async function request<T>(path: string, init?: RequestInit): Promise<T | Fail> {
    try {
      const res = await fetch(`${base}/api/v1${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearerToken}`,
          ...init?.headers,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error ?? `HTTP ${res.status}`, status: res.status };
      }
      return data as T;
    } catch {
      return { ok: false, error: 'network error' };
    }
  }

  return {
    vendor: 'centeredge',

    ordering: {
      fetchMenu: () => request<Menu>('/menu'),

      placeOrder: (opts) =>
        request<PlaceOrderResult & { ok: true }>('/orders', {
          method: 'POST',
          body: JSON.stringify({
            items: opts.items,
            payment: { token: opts.paymentToken, amountCents: opts.amountCents },
            playerId: opts.playerId,
            guestName: opts.guestName,
            notes: opts.notes,
          }),
        }),

      fetchOrder: (orderId) =>
        request<{ ok: true; order: Order }>(`/orders/${encodeURIComponent(orderId)}`),

      pickUpOrder: (orderId) =>
        request<{ ok: true; order: Order }>(`/orders/${encodeURIComponent(orderId)}/pickup`, {
          method: 'POST',
        }),
    },

    // No loyalty block: cards are account-bound and never touched from the
    // browser. Reads go through /api/loyalty and ticket writes through
    // /api/game-rewards, both of which require a player session and derive the
    // card from it — see server/routes/loyalty.js. Calling the vendor from here
    // is what let anyone read a stranger's card by typing its number.
  };
}
