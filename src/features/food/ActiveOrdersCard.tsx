import { useNavigate } from 'react-router-dom';
import { usePos } from '../../lib/pos';
import { usePlacedOrders, activeOrders } from '../../lib/foodOrders';

// "Your order is in the kitchen" re-entry point — placed orders otherwise
// have their id only in the /food/order/:id URL, so navigating away would
// orphan them. Self-gating like GameTicketAward: renders nothing unless this
// venue has the ordering integration AND this device placed an order
// recently. Dropped onto Home and the Food screen.

export default function ActiveOrdersCard() {
  const navigate = useNavigate();
  const { ordering } = usePos();
  const placed = usePlacedOrders();
  if (!ordering) return null;
  const active = activeOrders(placed);
  if (active.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {active.map((order) => (
        <button
          key={order.id}
          onClick={() => navigate(`/food/order/${order.id}`)}
          className="surface-1 flex w-full items-center justify-between gap-3 rounded-2xl border border-fairway-800/60 px-4 py-3 text-left transition-transform active:translate-y-px"
        >
          <span className="flex items-center gap-2 text-sm">
            <span aria-hidden="true">🍳</span>
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
