// Server-side sessions for admin_user logins. Sessions are opaque random
// tokens looked up in admin_session (not JWTs — nothing is client-decodable),
// sent as an httpOnly cookie scoped to /api/admin so it's never exposed to
// page JS and never sent to unrelated routes.
import { randomBytes } from "node:crypto";
import { pool } from "../db.js";

export const SESSION_COOKIE_NAME = "ffc_admin_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Minimal Cookie-header parser — avoids adding the cookie-parser dependency
 * for what's a single name=value pair we care about. */
export function parseCookies(req) {
  const header = req.headers?.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function cookieAttrs({ secure, maxAgeSeconds }) {
  const attrs = [
    "Path=/api/admin",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs;
}

export function serializeSessionCookie(token, { secure }) {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    ...cookieAttrs({ secure, maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) }),
  ];
  return attrs.join("; ");
}

export function clearSessionCookieHeader({ secure }) {
  const attrs = [`${SESSION_COOKIE_NAME}=`, ...cookieAttrs({ secure, maxAgeSeconds: 0 })];
  return attrs.join("; ");
}

/** Create a session row for adminUserId; returns the opaque token to cookie. */
export async function createSession(adminUserId) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(`insert into admin_session (id, admin_user_id, expires_at) values ($1, $2, $3)`, [
    token,
    adminUserId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

/** Resolve a session token to its admin_user (or null if missing/expired). */
export async function getSessionUser(token) {
  if (!token) return null;
  const result = await pool.query(
    `select u.id, u.email, u.role, u.org_id as "orgId"
       from admin_session s
       join admin_user u on u.id = s.admin_user_id
      where s.id = $1 and s.expires_at > now()`,
    [token]
  );
  return result.rows[0] ?? null;
}

export async function deleteSession(token) {
  if (!token) return;
  await pool.query(`delete from admin_session where id = $1`, [token]);
}
