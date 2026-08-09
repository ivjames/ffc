// Vendor-neutral POS domain — the contract between the app's food/rewards
// features and whatever point-of-sale system a venue runs. Features import
// ONLY from src/lib/pos/*; vendor specifics live in adapters (centeredge.ts is
// the first). Onboarding another vendor (Embed, Intercard, Sacoa, …) means a
// new adapter file + a POS_VENDORS entry server-side — no feature changes.
//
// Money is integer cents everywhere.

/** Per-venue integration config, set in Master Control and shipped via the
 *  content export (location.pos). Mirrors server/lib/validateLocation.js
 *  normalizePos. The capabilities are DELIBERATELY decoupled — each names its
 *  own vendor, so a venue can run e.g. CenterEdge loyalty next to a different
 *  ordering system. gameRewards rides inside loyalty (app-earned tickets need
 *  a loyalty balance to land in). `apiBase` overrides that vendor's API
 *  endpoint per venue; vendor credentials are deliberately NOT part of this
 *  shape (they stay server-side). */
export type PosCapabilityConfig = { vendor: string; apiBase: string | null };
/** Venue economy guardrails for app-earned tickets, set in Master Control and
 *  ENFORCED SERVER-SIDE by the award proxy (server/routes/gameRewards.js) —
 *  present in the export only so the config round-trips; the client never
 *  applies them itself. */
export type GameRewardCaps = {
  dailyPerCard: number | null; // app tickets per card per venue-day; null = platform default
  perGame: Record<string, number>; // per-round ceiling overrides by game key
};
export type PosConfig = {
  ordering: PosCapabilityConfig | null;
  loyalty: (PosCapabilityConfig & { gameRewards: boolean; gameRewardCaps?: GameRewardCaps }) | null;
};

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

// The card carries no cash balance — it's a loyalty card (game credits +
// redemption tickets), not a stored-value/cash instrument, and food is paid by
// the payment flow, never from the card.
export type PlayerBalances = { gamePlayCredits: number; tickets: number };
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

export type Fail = { ok: false; error: string; status?: number };

export type PlaceOrderResult =
  | { ok: true; order: Order; kitchen: { printed: boolean; station: string } }
  | Fail;

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

/** F&B: menu → order → kitchen progress. */
export type OrderingApi = {
  fetchMenu(): Promise<Menu | Fail>;
  /** `paymentToken` is the tokenized payment from whatever payment flow the
   *  vendor supports — an opaque string at this layer. */
  placeOrder(opts: {
    items: CartLine[];
    paymentToken: string;
    amountCents: number;
    playerId?: string;
    guestName?: string;
    notes?: string;
  }): Promise<PlaceOrderResult>;
  fetchOrder(orderId: string): Promise<{ ok: true; order: Order } | Fail>;
};

/** Loyalty: player card lookup, balances, and crediting app-earned tickets. */
export type LoyaltyApi = {
  fetchPlayer(idOrCard: string): Promise<{ ok: true; player: Player } | Fail>;
  fetchPlayerTransactions(
    idOrCard: string,
  ): Promise<{ ok: true; transactions: PlayerTransaction[] } | Fail>;
  /** ALWAYS pass a stable idempotencyKey per award event (e.g. the game
   *  session id) — retries then replay instead of double-crediting. */
  rewardTickets(opts: {
    playerId: string;
    tickets: number;
    source: string;
    idempotencyKey: string;
  }): Promise<RewardResult>;
};

/** What a vendor adapter provides. A vendor implements whichever capabilities
 *  its system actually has (an ordering-only vendor ships no loyalty);
 *  capability gating — which of these a venue has PAID for, and from which
 *  vendor — happens in index.ts from PosConfig. */
export type PosAdapter = {
  vendor: string;
  ordering?: OrderingApi;
  loyalty?: LoyaltyApi;
};
