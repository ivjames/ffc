// CenterEdge (F&B ordering + player card / ticket rewards) API client.
//
// Today this talks to the local mock (`mock-centeredge/`, default port 8070) —
// we are pre-credential with CenterEdge, so the contract below is our best
// guess at Advantage Web Services and the mock is the reference
// implementation. When real credentials land, the swap is VITE_CENTEREDGE_API_BASE
// plus real auth in `authenticate()`; the shapes are designed to survive.
//
// Money is integer cents everywhere. The server is the price authority:
// POST /orders recomputes the total and rejects a mismatched payment amount,
// so keep client cart math in sync with `orderTotals()` below.

const BASE = (
  (import.meta.env.VITE_CENTEREDGE_API_BASE as string | undefined) ?? 'http://localhost:8070'
).replace(/\/$/, '');

// The mock's static dev token — works out of the box with `npm run mock:centeredge`.
// Real integration replaces this via authenticate().
let bearerToken = 'ce-mock-dev-token';

export type ModifierOption = { id: string; name: string; priceCents: number };
export type ModifierGroup = {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
};
export type MenuItem = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string | null;
  available: boolean;
  modifierGroups: ModifierGroup[];
};
export type MenuCategory = { id: string; name: string; sortOrder: number; items: MenuItem[] };
export type Menu = {
  menuId: string;
  name: string;
  currency: string;
  taxRatePct: number;
  categories: MenuCategory[];
};

export type CartLine = {
  menuItemId: string;
  quantity: number;
  modifierIds?: string[];
  notes?: string;
};

export type OrderStatus = 'received' | 'sent_to_kitchen' | 'preparing' | 'ready';
export type Order = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  items: Array<CartLine & { name: string; lineTotalCents: number }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  playerId: string | null;
  guestName: string | null;
  notes: string | null;
  createdAt: string;
};

export type PlayerBalances = { cashCents: number; gamePlayCredits: number; tickets: number };
export type Player = {
  id: string;
  cardNumber: string;
  displayName: string;
  email: string | null;
  memberSince: string;
  tier: string;
  balances: PlayerBalances;
};

export type PlayerTransaction = {
  id: string;
  type: 'food_order' | 'ticket_reward';
  createdAt: string;
  orderId?: string;
  amountCents?: number;
  tickets?: number;
  source?: string;
};

type Fail = { ok: false; error: string; status?: number };

/** 2422 → "$24.22". All CenterEdge money is integer cents (USD). */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T | Fail> {
  try {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
        ...init?.headers,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}`, status: res.status };
    return data as T;
  } catch {
    return { ok: false, error: 'network error' };
  }
}

/** Trade client credentials for a bearer token (stored module-side).
 *  Optional against the mock — the static dev token already works. */
export async function authenticate(clientId: string, clientSecret: string): Promise<boolean> {
  const res = await request<{ access_token: string }>('/auth/token', {
    method: 'POST',
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if ('error' in res) return false;
  bearerToken = res.access_token;
  return true;
}

export async function fetchMenu(): Promise<Menu | Fail> {
  return request<Menu>('/menu');
}

/** Client-side mirror of the server's pricing (find lines' unit+modifier
 *  prices, then tax) — the amount POST /orders expects in payment.amountCents. */
export function orderTotals(menu: Menu, lines: CartLine[]): {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
} {
  const items = new Map(menu.categories.flatMap((c) => c.items).map((i) => [i.id, i]));
  let subtotalCents = 0;
  for (const line of lines) {
    const item = items.get(line.menuItemId);
    if (!item) throw new Error(`unknown menuItemId: ${line.menuItemId}`);
    const mods = new Map(
      item.modifierGroups.flatMap((g) => g.options).map((o) => [o.id, o.priceCents]),
    );
    const modTotal = (line.modifierIds ?? []).reduce((sum, id) => sum + (mods.get(id) ?? 0), 0);
    subtotalCents += (item.priceCents + modTotal) * line.quantity;
  }
  const taxCents = Math.round((subtotalCents * menu.taxRatePct) / 100);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export type PlaceOrderResult =
  | { ok: true; order: Order; kitchen: { printed: boolean; station: string } }
  | Fail;

/** Submit a cart. `paymentToken` is the tokenized card from the payment SDK
 *  (mock: any string; "tok_declined" simulates a 402 decline). */
export async function placeOrder(opts: {
  items: CartLine[];
  paymentToken: string;
  amountCents: number;
  playerId?: string;
  guestName?: string;
  notes?: string;
}): Promise<PlaceOrderResult> {
  return request<{ ok: true; order: Order; kitchen: { printed: boolean; station: string } }>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      items: opts.items,
      payment: { token: opts.paymentToken, amountCents: opts.amountCents },
      playerId: opts.playerId,
      guestName: opts.guestName,
      notes: opts.notes,
    }),
  });
}

/** Poll an order for kitchen progress (received → sent_to_kitchen → preparing → ready). */
export async function fetchOrder(orderId: string): Promise<{ ok: true; order: Order } | Fail> {
  return request(`/orders/${encodeURIComponent(orderId)}`);
}

/** Look up a player by account id or physical card number. */
export async function fetchPlayer(idOrCard: string): Promise<{ ok: true; player: Player } | Fail> {
  return request(`/players/${encodeURIComponent(idOrCard)}`);
}

export async function fetchPlayerTransactions(
  idOrCard: string,
): Promise<{ ok: true; transactions: PlayerTransaction[] } | Fail> {
  return request(`/players/${encodeURIComponent(idOrCard)}/transactions`);
}

export type RewardResult =
  | {
      ok: true;
      transactionId: string;
      playerId: string;
      ticketsAwarded: number;
      newTicketBalance: number;
      duplicate: boolean;
    }
  | Fail;

/** Credit app-earned tickets (mini-games etc.) to a player's balance.
 *  ALWAYS pass a stable idempotencyKey per award event (e.g. the game
 *  session id) — retries then replay instead of double-crediting. */
export async function rewardTickets(opts: {
  playerId: string;
  tickets: number;
  source: string;
  idempotencyKey: string;
}): Promise<RewardResult> {
  return request(`/players/${encodeURIComponent(opts.playerId)}/tickets/reward`, {
    method: 'POST',
    body: JSON.stringify({
      tickets: opts.tickets,
      source: opts.source,
      idempotencyKey: opts.idempotencyKey,
    }),
  });
}
