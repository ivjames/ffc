// Per-order status-change alerts for the food-ordering flow. Three layers,
// each degrading independently so a missing capability never blocks the rest:
//
//  • Sound + haptic (lib/sound → lib/haptics) — fires on EVERY status change,
//    works cross-platform, and respects the app's single mute toggle and
//    prefers-reduced-motion. The buzz is a real vibration on Android and a
//    silent no-op on iOS, which has never shipped navigator.vibrate.
//  • A system Notification — surfaces "Order #1234 is ready!" even when the
//    tab is backgrounded or the phone is pocketed. It needs a user gesture to
//    request permission, so it's opt-in behind a button (see OrderStatus). A
//    per-order `tag` makes each update REPLACE that order's previous
//    notification instead of stacking a pile of them.
//
// This is NOT Web Push: the poll loop that drives it only runs while the page
// is alive, so a fully-closed app won't wake. True background delivery (phone
// locked, app killed) needs a push service + server — the same seam the poll
// loop is (real POS webhooks/SSE would replace both).

import type { Order, OrderStatus } from './pos/types';
import { playOrderReady, playOrderUpdate } from './sound';

/** Copy for a status-change notification, or null for statuses we don't
 *  announce (the initial `received` is the order landing, not a change worth
 *  buzzing about). Pure — the unit-tested core. */
export function orderStatusNotification(
  status: OrderStatus,
  orderNumber: number,
): { title: string; body: string } | null {
  switch (status) {
    case 'sent_to_kitchen':
      return { title: `Order #${orderNumber}`, body: 'Sent to the kitchen 📨' };
    case 'preparing':
      return { title: `Order #${orderNumber}`, body: 'Your order is being prepared 🍳' };
    case 'ready':
      return {
        title: `Order #${orderNumber} is ready! 🔔`,
        body: 'Head to the counter for pickup.',
      };
    case 'picked_up':
      return { title: `Order #${orderNumber}`, body: 'Picked up — enjoy! 🎉' };
    case 'received':
      return null;
  }
}

export type NotifyPermission = NotificationPermission | 'unsupported';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Current permission, or 'unsupported' where the API doesn't exist (desktop
 *  Safari is fine; iOS only exposes it inside an installed PWA on 16.4+). */
export function notificationPermission(): NotifyPermission {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** Ask for permission. MUST be called from a user gesture. Resolves to the
 *  resulting permission (or the current one if already decided). */
export async function enableOrderNotifications(): Promise<NotifyPermission> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function orderTag(order: Order): string {
  return `ffc-order-${order.id}`;
}

// Android Chrome forbids `new Notification()` and requires the notification be
// shown through the service worker registration; desktop + iOS installed PWAs
// allow the constructor. Try the SW path first, fall back to the constructor.
async function showViaServiceWorker(
  title: string,
  options: NotificationOptions,
): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, options);
    return true;
  } catch {
    return false;
  }
}

/** Fire feedback for a status change: sound + haptic always (the ready state
 *  gets the celebratory cue), plus a system notification when the user has
 *  granted permission. Safe to call on every transition — no-ops that don't
 *  apply just fall through. */
export function notifyOrderStatus(order: Order): void {
  if (order.status === 'ready') playOrderReady();
  else playOrderUpdate();

  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const copy = orderStatusNotification(order.status, order.orderNumber);
  if (!copy) return;

  // `renotify` needs `tag`: replace this order's prior notification, but still
  // alert (buzz/sound at the OS level) on the replacement. `renotify` is a
  // valid Notification option not yet in this TS lib's NotificationOptions.
  const options: NotificationOptions & { renotify?: boolean } = {
    body: copy.body,
    tag: orderTag(order),
    renotify: true,
  };
  void showViaServiceWorker(copy.title, options).then((shown) => {
    if (shown) return;
    try {
      new Notification(copy.title, options);
    } catch {
      /* both paths unavailable — the in-app sound + haptic already fired */
    }
  });
}
