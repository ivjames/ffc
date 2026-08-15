import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { formatCents } from '../../lib/pos/pricing';
import type { Order, OrderStatus } from '../../lib/pos/types';
import { usePos } from '../../lib/pos';
import { forgetOrder } from '../../lib/foodOrders';
import { playClick } from '../../lib/sound';
import {
  enableOrderNotifications,
  notificationPermission,
  notifyOrderStatus,
  type NotifyPermission,
} from '../../lib/orderNotifications';

// /food/order/:orderId — live kitchen progress. Polls until the order is
// picked up (the mock's fake kitchen services tickets through received →
// sent_to_kitchen → preparing → ready → picked_up, with load-aware ETAs and
// staff bumps from its KDS; unbumped orders auto-complete, so this loop
// always terminates. The real API may offer webhooks/SSE instead, in which
// case this polling loop is the seam to replace).

const STEPS: Array<{ status: OrderStatus; label: string; emoji: string }> = [
  { status: 'received', label: 'Order received', emoji: '🧾' },
  { status: 'sent_to_kitchen', label: 'Sent to the kitchen', emoji: '📨' },
  { status: 'preparing', label: 'Being prepared', emoji: '🍳' },
  { status: 'ready', label: 'Ready for pickup!', emoji: '🔔' },
  { status: 'picked_up', label: 'Picked up — enjoy!', emoji: '🎉' },
];

const POLL_MS = 4_000;

/** "~2 min" / "under a minute" from the kitchen's ETA; null once it's moot. */
function etaLabel(order: Order, now: number): string | null {
  if (order.status === 'ready' || order.status === 'picked_up' || !order.estimatedReadyAt) {
    return null;
  }
  const leftMs = Date.parse(order.estimatedReadyAt) - now;
  if (!Number.isFinite(leftMs)) return null;
  if (leftMs < 60_000) return 'under a minute';
  return `~${Math.round(leftMs / 60_000)} min`;
}

export default function OrderStatusScreen() {
  const navigate = useNavigate();
  const { ordering } = usePos();
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 1s ticker so the ETA counts down between polls.
  const [now, setNow] = useState(() => Date.now());
  const [notifyPerm, setNotifyPerm] = useState<NotifyPermission>(() => notificationPermission());
  const [pickingUp, setPickingUp] = useState(false);
  const [pickupError, setPickupError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId || !ordering) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      const res = await ordering!.fetchOrder(orderId!);
      if (cancelled) return;
      if ('error' in res) {
        // A genuine 404 means the order no longer exists server-side (e.g. the
        // in-memory mock was redeployed and lost it). Forget it so the
        // on-device "in the kitchen" flag clears instead of lingering for the
        // full active window. A network error (no status) is transient — keep
        // the order remembered and just stop polling.
        if (res.status === 404) forgetOrder(orderId!);
        setError(res.error);
        return; // A vanished order won't reappear — stop polling.
      }
      setError(null);
      setOrder(res.order);
      if (res.order.status !== 'picked_up') timer = setTimeout(() => void poll(), POLL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, ordering]);

  const counting = !!order && order.status !== 'ready' && order.status !== 'picked_up';
  useEffect(() => {
    if (!counting) return;
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, [counting]);

  // Alert on each status CHANGE (not the initial load): sound + haptic always,
  // a system notification too if the user opted in. Keyed on the status string
  // so it fires once per transition; the ref hands the effect the live order
  // without widening its deps to every poll.
  const orderRef = useRef<Order | null>(null);
  orderRef.current = order;
  const lastNotifiedRef = useRef<OrderStatus | null>(null);
  const status = order?.status;
  useEffect(() => {
    if (!status) return;
    const prev = lastNotifiedRef.current;
    lastNotifiedRef.current = status;
    if (prev !== null && prev !== status && orderRef.current) {
      notifyOrderStatus(orderRef.current);
    }
  }, [status]);

  async function enableNotifications() {
    playClick();
    setNotifyPerm(await enableOrderNotifications());
  }

  // Guest-side hand-off: either the player taps this or staff complete it on
  // the KDS, whichever happens first. The poll loop stops once it reads
  // picked_up; setting the returned order here flips the screen immediately.
  async function pickUp() {
    if (!orderId || !ordering || pickingUp) return;
    playClick();
    setPickingUp(true);
    setPickupError(null);
    const res = await ordering.pickUpOrder(orderId);
    setPickingUp(false);
    if ('error' in res) {
      setPickupError(res.error);
      return;
    }
    setOrder(res.order);
  }

  if (!ordering) return <Navigate to="/" replace />;
  const stepIndex = order ? STEPS.findIndex((s) => s.status === order.status) : -1;
  const eta = order ? etaLabel(order, now) : null;

  return (
    <Screen>
      <TopBar title="Order status" back="/food" />
      <Content>
        {!order && !error && <p className="text-fairway-100/70">Checking on your order…</p>}
        {error && (
          <p className="mb-4 text-sm text-danger">
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
              {eta && (
                <div className="mt-1 text-sm font-semibold text-fairway-300">
                  Estimated ready in {eta}
                </div>
              )}
            </div>

            {order.status === 'ready' && (
              <div className="surface-1 animate-glow-pulse mb-5 rounded-2xl border border-fairway-500/40 px-4 py-4 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-fairway-400">
                  Show this at the counter
                </div>
                {order.pickupCode && (
                  <div className="mt-1 font-arcade text-4xl font-black tracking-[0.3em] text-fairway-50">
                    {order.pickupCode}
                  </div>
                )}
                <p className="mt-1 text-sm text-fairway-100/70">
                  Your order is ready — grab it at the counter.
                </p>
                <div className="mt-3">
                  <Button onClick={pickUp} disabled={pickingUp}>
                    {pickingUp ? 'Confirming…' : "I've picked it up"}
                  </Button>
                </div>
                {pickupError && <p className="mt-2 text-xs text-danger">{pickupError}</p>}
              </div>
            )}

            {order.status !== 'picked_up' && order.status !== 'ready' && (
              <div className="mb-5">
                {notifyPerm === 'default' && (
                  <Button variant="ghost" onClick={enableNotifications}>
                    🔔 Notify me when it's ready
                  </Button>
                )}
                {notifyPerm === 'granted' && (
                  <p className="text-center text-xs text-fairway-100/80">
                    🔔 Notifications on — we'll alert you when it's ready.
                  </p>
                )}
                {notifyPerm === 'denied' && (
                  <p className="text-center text-xs text-fairway-100/80">
                    Notifications are blocked in your browser — we'll still chime and buzz here.
                  </p>
                )}
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
                <div key={i} className="py-0.5">
                  <div className="flex justify-between text-fairway-100/80">
                    <span>
                      {line.quantity}× {line.name}
                    </span>
                    <span>{formatCents(line.lineTotalCents)}</span>
                  </div>
                  {!!line.modifierNames?.length && (
                    <div className="pl-4 text-xs text-fairway-100/80">
                      {line.modifierNames.join(', ')}
                    </div>
                  )}
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
