// Shared auth + audit for admin-surface routes (and the legacy /api/seed,
// /api/locations write guards, which used to inline this).
//
// v1 auth is a single shared token: header `x-app-token` must equal APP_TOKEN.
// Fail CLOSED: an UNSET/empty APP_TOKEN denies every request rather than
// silently opening the admin surface. Set APP_TOKEN (any dev box included) to
// use these routes. `warnIfNoToken()` additionally shouts about a missing
// token at startup.
//
// The Master Control surface (/api/admin/*) additionally accepts a logged-in
// admin_user session (see requireAdminAuth below) alongside APP_TOKEN — either
// grants access. seed.js and the public locations.js keep using
// requireAppToken/isAuthorized unchanged (APP_TOKEN only; no session concept
// applies to those dev/onboarding routes).
import { pool } from "../db.js";
import { parseCookies, SESSION_COOKIE_NAME, getSessionUser } from "./adminSession.js";

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
 * Master Control gate: a valid APP_TOKEN header OR a valid admin_user session
 * cookie. On success sets req.adminUser:
 *   - via APP_TOKEN: { id: null, email: null, role: "super_admin", orgId: null, viaToken: true }
 *   - via session:   { id, email, role, orgId, viaToken: false }
 * APP_TOKEN always resolves to unrestricted super_admin access — it remains
 * the bootstrap credential for creating the first real admin_user.
 */
export async function requireAdminAuth(req, res, next) {
  if (isAuthorized(req)) {
    req.adminUser = { id: null, email: null, role: "super_admin", orgId: null, viaToken: true };
    return next();
  }
  try {
    const token = parseCookies(req)[SESSION_COOKIE_NAME];
    const user = await getSessionUser(token);
    if (user) {
      req.adminUser = { ...user, viaToken: false };
      return next();
    }
  } catch (err) {
    console.error("[admin] session lookup failed:", err);
  }
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

/** True if the current request is authenticated as super_admin (APP_TOKEN always is). */
export function isSuperAdmin(req) {
  return req.adminUser?.role === "super_admin";
}

/**
 * The org an org_admin is confined to, or null for a super_admin (meaning "no
 * restriction" — callers treat null as "don't filter by org").
 */
export function orgScope(req) {
  return isSuperAdmin(req) ? null : req.adminUser?.orgId ?? null;
}

/** "who did this" for admin_audit — the session's email, or "app-token". */
export function actorLabel(req) {
  return req.adminUser && !req.adminUser.viaToken ? req.adminUser.email : "app-token";
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
