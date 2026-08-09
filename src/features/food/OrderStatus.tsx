import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { formatCents } from '../../lib/pos/pricing';
import type { Order, OrderStatus } from '../../lib/pos/types';
import { usePos } from '../../lib/pos';

// /food/order/:orderId — live kitchen progress. Polls until the order is
// ready (the mock advances received → sent_to_kitchen → preparing → ready on
// a time-derived schedule; the real API may offer webhooks/SSE instead, in
// which case this polling loop is the seam to replace).

const STEPS: Array<{ status: OrderStatus; label: string; emoji: string }> = [
  { status: 'received', label: 'Order received', emoji: '🧾' },
  { status: 'sent_to_kitchen', label: 'Sent to the kitchen', emoji: '📨' },
  { status: 'preparing', label: 'Being prepared', emoji: '🍳' },
  { status: 'ready', label: 'Ready for pickup!', emoji: '🔔' },
];

const POLL_MS = 4_000;

export default function OrderStatusScreen() {
  const navigate = useNavigate();
  const { ordering } = usePos();
  const { orderId } = useParams<{ orderId: string }>();
  // Loyalty tickets this purchase earned, handed over by Checkout right after
  // placing — absent when the screen is reached any other way.
  const { state } = useLocation() as { state: { earnedTickets?: number } | null };
  const earnedTickets = state?.earnedTickets ?? 0;
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId || !ordering) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      const res = await ordering!.fetchOrder(orderId!);
      if (cancelled) return;
      if ('error' in res) {
        setError(res.error);
        return; // A vanished order won't reappear — stop polling.
      }
      setError(null);
      setOrder(res.order);
      if (res.order.status !== 'ready') timer = setTimeout(() => void poll(), POLL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, ordering]);

  if (!ordering) return <Navigate to="/" replace />;
  const stepIndex = order ? STEPS.findIndex((s) => s.status === order.status) : -1;

  return (
    <Screen>
      <TopBar title="Order status" back="/food" />
      <Content>
        {!order && !error && <p className="text-fairway-100/70">Checking on your order…</p>}
        {error && (
          <p className="mb-4 text-sm text-red-400">
            Couldn't find that order — {error}. Ask at the counter if it was just placed.
          </p>
        )}

        {order && (
          <>
            <div className="mb-5 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-fairway-400">
                Order number
              </div>
              <div className="font-arcade text-5xl font-black text-fairway-50">
                #{order.orderNumber}
              </div>
            </div>

            {earnedTickets > 0 && (
              <div className="surface-1 mb-5 rounded-2xl border border-fairway-800/60 px-4 py-3 text-center text-sm font-bold text-fairway-50">
                🎟️ +{earnedTickets} tickets earned on your rewards card
              </div>
            )}

            <div className="mb-5 space-y-2">
              {STEPS.map((step, i) => {
                const done = i < stepIndex;
                const current = i === stepIndex;
                return (
                  <div
                    key={step.status}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                      current
                        ? 'surface-1 animate-glow-pulse border-fairway-500/40'
                        : 'surface-sunk border-fairway-800/60'
                    } ${!done && !current ? 'opacity-50' : ''}`}
                  >
                    <span className="text-xl" aria-hidden="true">
                      {done ? '✅' : step.emoji}
                    </span>
                    <span
                      className={`font-bold ${current ? 'text-fairway-50' : 'text-fairway-100/80'}`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="surface-sunk mb-5 rounded-2xl border border-fairway-800/60 px-4 py-3 text-sm">
              {order.items.map((line, i) => (
                <div key={i} className="flex justify-between py-0.5 text-fairway-100/80">
                  <span>
                    {line.quantity}× {line.name}
                  </span>
                  <span>{formatCents(line.lineTotalCents)}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between border-t border-fairway-800/60 pt-1.5 font-black text-fairway-50">
                <span>Total</span>
                <span>{formatCents(order.totalCents)}</span>
              </div>
            </div>

            <Button variant="ghost" onClick={() => navigate('/food')}>
              Order something else
            </Button>
          </>
        )}
      </Content>
    </Screen>
  );
}
