// In-process SSE fan-out for shared games: Map<gameId, Set<res>>. The same
// single-process caveat as the in-memory rate limiter applies — multi-process
// needs a shared channel (Redis pub/sub or pg LISTEN/NOTIFY), and this module
// is the one place to swap it.
const channels = new Map(); // gameId -> Set<res>

// One heartbeat comment per connection every 25s defeats proxy idle timeouts
// (and lets EventSource notice a dead TCP path and auto-reconnect).
const HEARTBEAT_MS = 25_000;
const heartbeat = setInterval(() => {
  for (const subscribers of channels.values()) {
    for (const res of subscribers) {
      try {
        res.write(":hb\n\n");
      } catch {
        // write errors surface via 'close' — nothing to do here
      }
    }
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

/** Format + write one SSE event. */
export function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Register an open SSE response for a game; returns an unsubscribe fn. */
export function subscribe(gameId, res) {
  let subscribers = channels.get(gameId);
  if (!subscribers) {
    subscribers = new Set();
    channels.set(gameId, subscribers);
  }
  subscribers.add(res);
  return () => {
    subscribers.delete(res);
    if (subscribers.size === 0) channels.delete(gameId);
  };
}

/** Push an event to every device subscribed to a game. */
export function publish(gameId, event, data) {
  const subscribers = channels.get(gameId);
  if (!subscribers) return;
  for (const res of subscribers) {
    try {
      sseSend(res, event, data);
    } catch {
      // dead connection — its 'close' handler unsubscribes it
    }
  }
}

/** Test hook: how many devices are listening on a game right now. */
export function subscriberCount(gameId) {
  return channels.get(gameId)?.size ?? 0;
}
