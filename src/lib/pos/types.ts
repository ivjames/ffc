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

export type OrderStatus = 'received' | 'sent_to_kitchen' | 'preparing' | 'ready' | 'picked_up';
export type Order = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  items: Array<CartLine & { name: string; lineTotalCents: number; modifierNames?: string[] }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  playerId: string | null;
  guestName: string | null;
  notes: string | null;
  createdAt: string;
  /** Kitchen ETA (ISO) — once the order is ready/picked up, the time it was
   *  actually ready. Optional: a vendor may not expose one. */
  estimatedReadyAt?: string | null;
  /** Short code the guest shows at the counter; staff match it on the KDS to
   *  complete the hand-off. Optional: a vendor may not use pickup codes. */
  pickupCode?: string | null;
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
  | {
      ok: true;
      order: Order;
      kitchen: { printed: boolean; station: string; estimatedReadyAt?: string };
    }
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
  /** Guest-side pickup — complete the hand-off from the app once the order is
   *  ready (either side can complete it; staff can also do it from the KDS).
   *  Fails if the order isn't ready yet. */
  pickUpOrder(orderId: string): Promise<{ ok: true; order: Order } | Fail>;
};

// Loyalty has no client-side adapter, deliberately. The vendor is reachable
// only from the server (server/lib/posLoyalty.js), which holds the credentials
// and checks the caller owns the card it is asking about; the browser reads
// cards through /api/loyalty and credits tickets through /api/game-rewards.
// `Player`, `PlayerTransaction` and `RewardResult` above are the shapes those
// endpoints answer with.

/** What a vendor adapter provides. A vendor implements whichever capabilities
 *  its system actually has; capability gating — which of these a venue has PAID
 *  for, and from which vendor — happens in index.ts from PosConfig. */
export type PosAdapter = {
  vendor: string;
  ordering?: OrderingApi;
};
