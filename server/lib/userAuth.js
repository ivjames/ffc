// Player-account sessions — the adminSession.js pattern applied to app_user.
// Opaque random tokens looked up in user_session (nothing client-decodable),
// sent as an httpOnly cookie. Differences from the admin flavor, deliberately:
//   Path=/           the player app calls /api/auth, /api/teams, /api/games
//   30-day sliding   players sign in rarely; a monthly re-prompt would kill a
//                    walk-up product (the TTL refreshes on any use > 1 day old)
import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { parseCookies } from "./adminSession.js";

export const USER_COOKIE_NAME = "ffc_session";
export const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding

const USER_COLS = `u.id, u.email, u.phone, u.display_name as "displayName",
                   u.default_tag as "defaultTag", u.email_verified_at as "emailVerifiedAt"`;

function cookieAttrs({ secure, maxAgeSeconds }) {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (secure) attrs.push("Secure");
  return attrs;
}

export function serializeUserCookie(token, { secure }) {
  return [
    `${USER_COOKIE_NAME}=${encodeURIComponent(token)}`,
    ...cookieAttrs({ secure, maxAgeSeconds: Math.floor(USER_SESSION_TTL_MS / 1000) }),
  ].join("; ");
}

export function clearUserCookieHeader({ secure }) {
  return [`${USER_COOKIE_NAME}=`, ...cookieAttrs({ secure, maxAgeSeconds: 0 })].join("; ");
}

export function isProd() {
  return process.env.NODE_ENV === "production";
}

/** Create a session row for userId; returns the opaque token to cookie. */
export async function createUserSession(userId) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + USER_SESSION_TTL_MS);
  await pool.query(
    `insert into user_session (id, app_user_id, expires_at) values ($1, $2, $3)`,
    [token, userId, expiresAt]
  );
  return { token, expiresAt };
}

/**
 * Resolve a session token to its app_user, sliding the expiry forward when
 * the session is more than a day into its window — one cheap write a day per
 * active user, not one per request. `refreshed` tells the caller the DB
 * expiry moved, so it must re-send the cookie too: the browser's Max-Age was
 * stamped at sign-in and never moves on its own, and without the re-send an
 * active player would still be logged out 30 days after sign-in.
 * @returns {Promise<{user: object|null, refreshed: boolean}>}
 */
export async function getUserSession(token) {
  if (!token) return { user: null, refreshed: false };
  const result = await pool.query(
    `select ${USER_COLS}, s.id as "sessionId", s.expires_at as "expiresAt"
       from user_session s
       join app_user u on u.id = s.app_user_id
      where s.id = $1 and s.expires_at > now() and u.archived_at is null`,
    [token]
  );
  const row = result.rows[0];
  if (!row) return { user: null, refreshed: false };
  let refreshed = false;
  const remaining = new Date(row.expiresAt).getTime() - Date.now();
  if (remaining < USER_SESSION_TTL_MS - 24 * 60 * 60 * 1000) {
    await pool.query(`update user_session set expires_at = $2 where id = $1`, [
      token,
      new Date(Date.now() + USER_SESSION_TTL_MS),
    ]);
    refreshed = true;
  }
  const { sessionId, expiresAt, ...user } = row;
  return { user, refreshed };
}

export async function deleteUserSession(token) {
  if (!token) return;
  await pool.query(`delete from user_session where id = $1`, [token]);
}

/**
 * App-wide middleware: resolve the ffc_session cookie to req.user (or null).
 * Never rejects — anonymous requests flow through untouched, so the existing
 * public routes are unaffected. When the lookup slid the session's expiry,
 * the cookie is re-issued so the browser's Max-Age slides with it.
 */
export function attachUser(req, res, next) {
  const token = parseCookies(req)[USER_COOKIE_NAME];
  if (!token) {
    req.user = null;
    return next();
  }
  getUserSession(token)
    .then(({ user, refreshed }) => {
      req.user = user;
      if (user && refreshed) {
        res.set("Set-Cookie", serializeUserCookie(token, { secure: isProd() }));
      }
      next();
    })
    .catch((err) => {
      console.error("[userAuth] session lookup error:", err);
      req.user = null;
      next();
    });
}

/** Route guard for signed-in-only routers (teams, game creation). */
export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: "sign in required" });
  next();
}

/**
 * Find-or-create the app_user for a successfully verified email, marking it
 * verified and applying any profile fields stashed with the code (first-verify
 * registration payload). Existing profile values win over stashed ones — the
 * stash is only a convenience for the very first sign-in.
 */
export async function upsertVerifiedUser(email, profile) {
  const result = await pool.query(
    `insert into app_user (email, email_verified_at, phone, display_name, default_tag)
       values ($1, now(), $2, $3, $4)
     on conflict (email) do update
       set email_verified_at = coalesce(app_user.email_verified_at, now()),
           phone        = coalesce(app_user.phone, excluded.phone),
           display_name = coalesce(app_user.display_name, excluded.display_name),
           default_tag  = coalesce(app_user.default_tag, excluded.default_tag)
     returning id, email, phone, display_name as "displayName",
               default_tag as "defaultTag", email_verified_at as "emailVerifiedAt"`,
    [email, profile?.phone ?? null, profile?.displayName ?? null, profile?.defaultTag ?? null]
  );
  return result.rows[0];
}
