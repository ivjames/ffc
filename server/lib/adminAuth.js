// Shared auth + audit for admin-surface routes (and the legacy /api/seed,
// /api/locations write guards, which used to inline this).
//
// v1 auth is a single shared token: header `x-app-token` must equal APP_TOKEN.
// Fail CLOSED: an UNSET/empty APP_TOKEN denies every request rather than
// silently opening the admin surface. Set APP_TOKEN (any dev box included) to
// use these routes. `warnIfNoToken()` additionally shouts about a missing
// token at startup.
import { pool } from "../db.js";

/** True when a token is configured and the request carries the matching one. */
export function isAuthorized(req) {
  const expected = process.env.APP_TOKEN;
  if (!expected) return false; // fail closed: no token configured -> deny
  return req.get("x-app-token") === expected;
}

/** Express middleware: 401 unless authorized. */
export function requireAppToken(req, res, next) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  return next();
}

/**
 * Best-effort append to admin_audit. Never throws into the request path — an
 * audit failure must not fail the mutation it records. Pass a pg client to log
 * inside an existing transaction, else it uses the shared pool.
 */
export async function audit(
  { action, entity, entityId = null, detail = null, actor = "app-token" },
  client = pool
) {
  try {
    await client.query(
      `insert into admin_audit (actor, action, entity, entity_id, detail)
         values ($1, $2, $3, $4, $5)`,
      [actor, action, entity, entityId, detail == null ? null : JSON.stringify(detail)]
    );
  } catch (err) {
    console.error("[admin] audit write failed:", err);
  }
}

/** Log a loud warning if admin routes are mounted with no APP_TOKEN set. */
export function warnIfNoToken() {
  if (!process.env.APP_TOKEN) {
    console.warn(
      "[admin] APP_TOKEN is not set — admin, seed, and location-write routes " +
        "will reject every request (fail closed). Set APP_TOKEN in server/.env " +
        "to use them, including on a local dev box."
    );
  }
}
