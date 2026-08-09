import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { formatCents, orderTotals } from '../../lib/pos/pricing';
import type { MenuItem } from '../../lib/pos/types';
import { usePos } from '../../lib/pos';
import { useCart, cartCount } from '../../lib/foodCart';
import { useMenu } from './useMenu';
import ItemSheet from './ItemSheet';
import ActiveOrdersCard from './ActiveOrdersCard';

// /food — browse the venue menu and build a cart. Native ordering is a
// POS-integration add-on: only venues whose Master Control config enables the
// `ordering` capability get this screen (everyone else keeps the Home-screen
// FoodDrinkCard's external deep links), so no-integration visitors redirect
// home.

export default function Food() {
  const navigate = useNavigate();
  const { ordering } = usePos();
  const { menu, error, retry } = useMenu();
  const cart = useCart();
  const [selected, setSelected] = useState<MenuItem | null>(null);
  // All hooks must run before this conditional return — otherwise a venue
  // switch that flips `ordering` (null ⇄ set) changes the hook count between
  // renders and React tears the screen down mid-mount (Rules of Hooks).
  if (!ordering) return <Navigate to="/" replace />;

  const count = cartCount(cart);
  const subtotal = menu && cart.length > 0 ? orderTotals(menu, cart).subtotalCents : 0;

  return (
    <Screen>
      <TopBar title="Food & Drink" back="/" />
      <Content>
        {/* An order still in the kitchen — link back to its status screen. */}
        <ActiveOrdersCard />

        {!menu && !error && <p className="text-fairway-100/70">Loading the menu…</p>}

        {error && (
          <>
            <p className="mb-3 text-sm text-fairway-100/70">
              Couldn't load the menu — check your connection and try again.
            </p>
            <Button variant="ghost" onClick={retry}>
              Retry
            </Button>
          </>
        )}

        {menu &&
          [...menu.categories]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((cat) => (
              <div key={cat.id} className="mb-5">
                <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-fairway-400">
                  {cat.name}
                </h2>
                <div className="space-y-2">
                  {cat.items.map((item) => (
                    <button
                      key={item.id}
                      disabled={!item.available}
                      onClick={() => setSelected(item)}
                      className="surface-1 flex w-full items-center justify-between gap-3 rounded-2xl border border-fairway-800/60 px-4 py-3 text-left transition-transform active:translate-y-px disabled:opacity-40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-fairway-50">
                          {item.name}
                        </span>
                        <span className="block truncate text-sm text-fairway-100/70">
                          {item.available ? item.description : 'Sold out today'}
                        </span>
                      </span>
                      <span className="shrink-0 font-bold text-fairway-50">
                        {formatCents(item.priceCents)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

        {/* Spacer so the last items aren't hidden behind the cart bar. */}
        {count > 0 && <div className="h-16" />}
      </Content>

      {count > 0 && (
        <div
          className="sticky bottom-0 z-20 px-4 pb-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <Button onClick={() => navigate('/food/checkout')} sound="cup">
            🛒 View cart · {count} {count === 1 ? 'item' : 'items'} · {formatCents(subtotal)}
          </Button>
        </div>
      )}

      {selected && <ItemSheet item={selected} onClose={() => setSelected(null)} />}
    </Screen>
  );
}
