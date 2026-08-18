import { useState } from 'react';
import { getActiveRound, markActivity } from '../../db';
import type { LocalRound } from '../../types';
import { Navigate, useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { formatCents, orderTotals } from '../../lib/pos/pricing';
import type { Menu } from '../../lib/pos/types';
import { usePos } from '../../lib/pos';
import { useCart, setLineQuantity, clearCart, type StoredCartLine } from '../../lib/foodCart';
import { recordOrder } from '../../lib/foodOrders';
import { useCurrentLocationId } from '../../lib/location';
import { DEV_MODE } from '../../lib/flags';
import { playClick } from '../../lib/sound';
import { useMenu } from './useMenu';

// /food/checkout — review the cart, pay, hand the order to the kitchen.
//
// Payment is a placeholder. Working assumption (unconfirmed — asked in
// mock-centeredge/API-ACCESS-REQUEST.md): payment settles through CenterEdge
// Payments so orders reconcile in the POS, and their client-side SDK will
// tokenize the card and hand us the opaque reference we send as
// payment.token. Until credentials land we send a mock token. The DEV-only
// "simulate declined card" switch sends the mock's tok_declined to exercise
// the failure path.

function lineLabel(menu: Menu, line: StoredCartLine): { name: string; mods: string } {
  const item = menu.categories.flatMap((c) => c.items).find((i) => i.id === line.menuItemId);
  if (!item) return { name: 'Unknown item', mods: '' };
  const names = item.modifierGroups
    .flatMap((g) => g.options)
    .filter((o) => line.modifierIds?.includes(o.id))
    .map((o) => o.name);
  return { name: item.name, mods: names.join(', ') };
}

/**
 * Is this order genuinely being placed mid-round?
 *
 * An active round in IndexedDB is NOT enough on its own: that store is the
 * resume lookup, nothing deletes abandoned rounds, and a round walked away from
 * last month still sits there as 'active' — which would quietly turn every
 * later food order into a Turn Snack. So this asks for signs of a round in
 * play: at least one hole carded, and started recently enough to still be
 * happening. The window is an approximation, deliberately generous compared to
 * a round of mini-golf and far shorter than "some time last week".
 */
const MID_ROUND_WINDOW_MS = 6 * 60 * 60 * 1000;

function isMidRound(round: LocalRound | undefined): boolean {
  if (!round || round.completedAt != null) return false;
  if (Date.now() - round.createdAt > MID_ROUND_WINDOW_MS) return false;
  return Object.values(round.scores).some((card) => card?.some((s) => s != null));
}

export default function Checkout() {
  const navigate = useNavigate();
  const { ordering } = usePos();
  const { menu, error: menuError, retry } = useMenu();
  const cart = useCart();
  const locationId = useCurrentLocationId();
  const [guestName, setGuestName] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulateDecline, setSimulateDecline] = useState(false);
  if (!ordering) return <Navigate to="/" replace />;

  const totals = menu && cart.length > 0 ? orderTotals(menu, cart) : null;

  async function pay() {
    if (!totals || placing || !ordering) return;
    setPlacing(true);
    setError(null);
    const res = await ordering.placeOrder({
      items: cart.map(({ key, ...line }) => line),
      paymentToken: simulateDecline ? 'tok_declined' : 'tok_visa_mock',
      amountCents: totals.totalCents,
      guestName: guestName.trim() || undefined,
    });
    setPlacing(false);
    if ('error' in res) {
      setError(
        res.status === 402
          ? 'Card declined — try a different card at the counter.'
          : res.error,
      );
      return;
    }
    clearCart();
    // Achievements: an order placed, and whether it was placed mid-round —
    // ordering from the turn is its own small badge (lib/achievements).
    void markActivity('food', 'order');
    void getActiveRound().then((r) => {
      if (isMidRound(r)) void markActivity('food', 'mid-round');
    });
    // Remember the order on-device so Home and /food can link back to its
    // status screen after the user navigates away.
    recordOrder({
      id: res.order.id,
      orderNumber: res.order.orderNumber,
      totalCents: res.order.totalCents,
      locationId,
      createdAt: res.order.createdAt,
    });
    navigate(`/food/order/${res.order.id}`, { replace: true });
  }

  return (
    <Screen>
      <TopBar title="Your order" back="/food" />
      <Content>
        {cart.length === 0 && (
          <>
            <p className="mb-4 text-sm text-fairway-100/70">Your cart is empty.</p>
            <Button variant="ghost" onClick={() => navigate('/food')}>
              Browse the menu
            </Button>
          </>
        )}

        {cart.length > 0 && !menu && !menuError && (
          <p className="text-fairway-100/70">Loading…</p>
        )}
        {cart.length > 0 && menuError && (
          <>
            <p className="mb-3 text-sm text-fairway-100/70">
              Couldn't load prices — check your connection and try again.
            </p>
            <Button variant="ghost" onClick={retry}>
              Retry
            </Button>
          </>
        )}

        {menu && cart.length > 0 && totals && (
          <>
            <div className="mb-4 space-y-2">
              {cart.map((line) => {
                const { name, mods } = lineLabel(menu, line);
                return (
                  <div
                    key={line.key}
                    className="surface-1 flex items-center gap-3 rounded-2xl border border-fairway-800/60 px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-fairway-50">{name}</span>
                      {mods && (
                        <span className="block truncate text-sm text-fairway-100/70">{mods}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          playClick();
                          setLineQuantity(line.key, line.quantity - 1);
                        }}
                        aria-label="Fewer"
                        className="key flex h-9 w-9 items-center justify-center rounded-xl text-fairway-100"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-black text-fairway-50">
                        {line.quantity}
                      </span>
                      <button
                        onClick={() => {
                          playClick();
                          setLineQuantity(line.key, Math.min(20, line.quantity + 1));
                        }}
                        aria-label="More"
                        className="key flex h-9 w-9 items-center justify-center rounded-xl text-fairway-100"
                      >
                        +
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>

            <label className="mb-1.5 block text-sm font-semibold text-fairway-100/80">
              Name for the order (optional)
            </label>
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              maxLength={100}
              placeholder="Who's picking it up?"
              className="surface-sunk mb-4 w-full rounded-xl border border-fairway-800/60 px-4 py-2.5 text-base text-fairway-50 placeholder:text-fairway-100/40 focus:border-fairway-500 focus:outline-none"
            />

            <div className="surface-sunk mb-4 space-y-1 rounded-2xl border border-fairway-800/60 px-4 py-3 text-sm">
              <div className="flex justify-between text-fairway-100/80">
                <span>Subtotal</span>
                <span>{formatCents(totals.subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-fairway-100/80">
                <span>Tax</span>
                <span>{formatCents(totals.taxCents)}</span>
              </div>
              <div className="flex justify-between text-base font-black text-fairway-50">
                <span>Total</span>
                <span>{formatCents(totals.totalCents)}</span>
              </div>
            </div>

            {DEV_MODE && (
              <label className="mb-3 flex items-center gap-2 text-sm text-fairway-100/70">
                <input
                  type="checkbox"
                  checked={simulateDecline}
                  onChange={(e) => setSimulateDecline(e.target.checked)}
                />
                Simulate declined card (dev)
              </label>
            )}

            {error && <p className="mb-3 text-sm text-danger">{error}</p>}

            <Button onClick={() => void pay()} disabled={placing} sound="cup">
              {placing ? 'Placing order…' : `Pay ${formatCents(totals.totalCents)}`}
            </Button>
          </>
        )}
      </Content>
    </Screen>
  );
}
