// Fixed-window rate limiting, generalized from the original inline limiter in
// routes/rounds.js so every route shares one implementation. Counters live in
// process memory — good enough for the single-process pm2 app on the droplet.
// For multi-process / multi-host, swap in `express-rate-limit` with a shared
// store (e.g. Redis); every call site funnels through here, so that's one edit.

/**
 * Build an Express middleware limiting to `max` hits per `windowMs` per key.
 * `keyFn(req)` picks the bucket — defaults to the client IP. Returning a
 * falsy key skips limiting for that request (e.g. key by email only when the
 * body actually has one).
 */
export function makeRateLimit({ windowMs, max, keyFn, name = "rate limit" }) {
  const hits = new Map(); // key -> { count, resetAt }

  // Occasionally sweep expired entries so the Map doesn't grow unbounded.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now >= entry.resetAt) hits.delete(key);
    }
  }, windowMs);
  sweeper.unref?.();

  function middleware(req, res, next) {
    const key = keyFn ? keyFn(req) : req.ip || req.socket?.remoteAddress || "unknown";
    if (!key) return next();
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ ok: false, error: `${name} exceeded` });
    }
    next();
  }

  // Exposed for tests (and for emergencies via a REPL).
  middleware.reset = () => hits.clear();
  return middleware;
}
