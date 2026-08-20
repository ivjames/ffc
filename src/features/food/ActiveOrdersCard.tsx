import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePos } from '../../lib/pos';
import { useCurrentLocationId } from '../../lib/location';
import { usePlacedOrders, activeOrders, forgetOrder } from '../../lib/foodOrders';
import Icon from '../../ui/Icon';

// "Your order is in the kitchen" re-entry point — placed orders otherwise
// have their id only in the /food/order/:id URL, so navigating away would
// orphan them. Self-gating like GameAwards: renders nothing unless this
// venue has the ordering integration AND this device placed an order
// recently. Dropped onto Home and the Food screen.

export default function ActiveOrdersCard() {
  const navigate = useNavigate();
  const { ordering } = usePos();
  const locationId = useCurrentLocationId();
  const placed = usePlacedOrders();
  const active = ordering ? activeOrders(placed, locationId) : [];

  // Proactively verify each remembered order so a dead flag clears on its own,
  // without the player having to tap into it: after a redeploy wipes the
  // in-memory mock, GET /orders/:id 404s and we forget the order (same rule as
  // OrderStatus). A network error (no status) is transient — left alone. Keyed
  // on the id set so it runs when the shown orders change, not every render.
  const idsKey = active.map((o) => o.id).join(',');
  useEffect(() => {
    if (!ordering || active.length === 0) return;
    let cancelled = false;
    for (const order of active) {
      void ordering.fetchOrder(order.id).then((res) => {
        if (!cancelled && 'error' in res && res.status === 404) forgetOrder(order.id);
      });
    }
    return () => {
      cancelled = true;
    };
    // `active` is captured via idsKey; re-running only when the id set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, ordering]);

  if (!ordering || active.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {active.map((order) => (
        <button
          key={order.id}
          onClick={() => navigate(`/food/order/${order.id}`)}
          className="surface-1 flex w-full items-center justify-between gap-3 rounded-2xl border border-fairway-800/60 px-4 py-3 text-left transition-transform active:translate-y-px"
        >
          <span className="flex items-center gap-2 text-sm">
            <span aria-hidden="true"><Icon name="order.being-prepared" /></span>
            <span className="font-semibold text-fairway-50">
              Order #{order.orderNumber} is in the kitchen
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-fairway-400">Track</span>
        </button>
      ))}
    </div>
  );
}
