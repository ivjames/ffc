import { apiUrl } from '../sync';
import { getDeviceId } from './deviceId';
import { detectPlatform } from './pwaInstall';
import { getCurrentLocationId } from './location';

// First-party funnel analytics (adoption + sign-in). We record a few aggregate
// product-usage events so we can measure the two funnels we're growing —
// "install prompt shown -> installed" and "sign-in started -> completed" — and
// see where players drop off. It is deliberately privacy-clean: identity is the
// anonymous device install id (same one the announcement beacon uses), no PII,
// no third parties, and the server constrains the event vocabulary to an
// allowlist. See routes/events.js and the Privacy page.
//
// Same offline-first contract as the announcement-view beacon: events queue in
// localStorage and flush best-effort, so one banked on the 18th green with no
// signal isn't lost. The pure queue helpers are exported for unit tests.

/** The event vocabulary — mirrors ALLOWED_EVENTS in server/routes/events.js.
 *  Keeping it a union here means call sites can't invent a name the server
 *  would silently drop. */
export type FunnelEvent =
  | 'install_prompt_shown'
  | 'install_accepted'
  | 'install_dismissed'
  | 'app_installed'
  | 'app_launch_standalone'
  | 'signin_started'
  | 'signin_completed'
  | 'signin_failed';

export type QueuedEvent = {
  name: FunnelEvent;
  meta?: Record<string, unknown>;
  locationId?: string | null;
};

const QUEUE_KEY = 'ffc_funnel_queue';
// Bound the durable queue so a device that's offline for a very long time can't
// grow localStorage without limit — drop the OLDEST, since recent funnel steps
// matter most.
export const QUEUE_CAP = 200;
// Keep <= the server's MAX_EVENTS (routes/events.js): it processes only its
// first that-many, so we send no more than it accepts and clear only what we
// sent.
const FLUSH_BATCH = 50;

// ---- pure queue helpers (unit-tested) -------------------------------------

/** Append an event, dropping the oldest overflow past QUEUE_CAP. */
export function withEvent(queue: QueuedEvent[], event: QueuedEvent): QueuedEvent[] {
  const next = [...queue, event];
  return next.length > QUEUE_CAP ? next.slice(next.length - QUEUE_CAP) : next;
}

/** The next server-sized batch to send. */
export function nextBatch(queue: QueuedEvent[], size = FLUSH_BATCH): QueuedEvent[] {
  return queue.slice(0, size);
}

// ---- durable queue ---------------------------------------------------------

function readQueue(): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedEvent[]): void {
  try {
    if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* quota / disabled storage — the queue is best-effort */
  }
}

let flushing = false;

/** Push queued events to the beacon, one server-sized batch per call. Safe to
 *  call repeatedly; a no-op when offline, empty, or already in flight. Only the
 *  events actually sent are cleared on success, so anything queued mid-flush —
 *  or beyond this batch — survives to the next flush. */
export async function flushEvents(): Promise<void> {
  if (flushing || typeof navigator === 'undefined' || !navigator.onLine) return;
  flushing = true;
  let drained = false;
  try {
    const batch = nextBatch(readQueue());
    if (batch.length === 0) return;
    const res = await fetch(apiUrl('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        deviceId: getDeviceId(),
        platform: detectPlatform(),
        events: batch,
      }),
    });
    if (res.ok) {
      writeQueue(readQueue().slice(batch.length));
      drained = true;
    }
  } catch {
    /* offline / server down — leave the queue for the next flush */
  } finally {
    flushing = false;
  }
  // More was queued than one batch — keep draining now that this one cleared.
  if (drained && navigator.onLine && readQueue().length > 0) void flushEvents();
}

/** Record a funnel event. Durably queues, then tries to flush — fire-and-forget
 *  and never throws, so a call site can drop it inline without a care. */
export function track(name: FunnelEvent, meta?: Record<string, unknown>): void {
  const locationId = getCurrentLocationId() || null;
  writeQueue(withEvent(readQueue(), { name, meta, locationId }));
  void flushEvents();
}

/** Wire background flushing: drain on load, when connectivity returns, and as
 *  the page is hidden/unloaded (so the last step of a funnel isn't lost when
 *  the user leaves). Records a one-shot launch event for installed PWAs. Call
 *  once at app boot. No-ops outside a browser. */
export function initAnalytics(): void {
  if (typeof window === 'undefined') return;
  void flushEvents();
  window.addEventListener('online', () => void flushEvents());
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushEvents();
  });
  window.addEventListener('pagehide', () => void flushEvents());
  // Observed here (not in pwaInstall) so the install module stays free of an
  // analytics import — keeps the dependency one-way.
  window.addEventListener('appinstalled', () => track('app_installed'));

  const standalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches);
  if (standalone) track('app_launch_standalone');
}
