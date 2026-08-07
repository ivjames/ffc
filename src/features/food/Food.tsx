import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { formatCents, orderTotals, type MenuItem } from '../../lib/centeredgeApi';
import { useCart, cartCount } from '../../lib/foodCart';
import { useMenu } from './useMenu';
import ItemSheet from './ItemSheet';

// /food — browse the venue menu and build a cart. This is the native ordering
// flow backed by the CenterEdge integration (mock-centeredge in dev); the
// Home-screen FoodDrinkCard's external deep links remain the venue fallback
// until this ships.

export default function Food() {
  const navigate = useNavigate();
  const { menu, error, retry } = useMenu();
  const cart = useCart();
  const [selected, setSelected] = useState<MenuItem | null>(null);

  const count = cartCount(cart);
  const subtotal = menu && cart.length > 0 ? orderTotals(menu, cart).subtotalCents : 0;

  return (
    <Screen>
      <TopBar title="Food & Drink" back="/" />
      <Content>
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
