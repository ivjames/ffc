// Passwordless sign-in codes. Each /api/auth/request-code call mints one
// auth_code row carrying BOTH a 6-digit OTP (typed into the app — the primary
// path, since an iOS PWA and the mail app's browser are separate contexts) and
// a magic-link token (clicked from the email — the desktop convenience path).
// Only sha256 digests are stored: a leaked DB row reveals nothing typeable.
// Codes are single-use, expire after 10 minutes, and die after 5 wrong guesses.
import { randomBytes, randomInt, createHash, timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";

export const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_ATTEMPTS = 5;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digestsEqual(hexA, hexB) {
  const a = Buffer.from(hexA, "hex");
  const b = Buffer.from(hexB, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Mint a code row for `email` (lowercased by the caller). `profile` is the
 * pending registration payload, applied to app_user on first successful verify.
 * @returns {{ code: string, magicToken: string }} the SECRETS — emailed, never stored.
 */
export async function createAuthCode(email, profile) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const magicToken = randomBytes(32).toString("hex");
  await pool.query(
    `insert into auth_code (email, code_hash, magic_token_hash, profile, expires_at)
       values ($1, $2, $3, $4, now() + interval '10 minutes')`,
    [email, sha256(code), sha256(magicToken), profile ? JSON.stringify(profile) : null]
  );
  return { code, magicToken };
}

/**
 * Verify a typed 6-digit code for `email`. Counts an attempt against the most
 * recent live row; consumes it on success.
 * @returns {{ ok: true, profile: object|null } | { ok: false }}
 */
export async function verifyAuthCode(email, code) {
  if (typeof code !== "string" || !/^[0-9]{6}$/.test(code)) return { ok: false };
  // Most recent live row for this email — later requests supersede earlier ones.
  const result = await pool.query(
    `select id, code_hash as "codeHash", profile
       from auth_code
      where email = $1 and consumed_at is null and expires_at > now() and attempts < $2
      order by created_at desc limit 1`,
    [email, MAX_ATTEMPTS]
  );
  const row = result.rows[0];
  if (!row) return { ok: false };
  if (!digestsEqual(sha256(code), row.codeHash)) {
    await pool.query(`update auth_code set attempts = attempts + 1 where id = $1`, [row.id]);
    return { ok: false };
  }
  const consumed = await pool.query(
    `update auth_code set consumed_at = now() where id = $1 and consumed_at is null returning id`,
    [row.id]
  );
  if (consumed.rowCount === 0) return { ok: false }; // raced a concurrent verify
  return { ok: true, email, profile: row.profile };
}

/**
 * Verify a magic-link token (no email needed — the token alone identifies the
 * row). Same consumption semantics as the typed code.
 * @returns {{ ok: true, email: string, profile: object|null } | { ok: false }}
 */
export async function verifyMagicToken(token) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return { ok: false };
  const result = await pool.query(
    `update auth_code set consumed_at = now()
      where magic_token_hash = $1 and consumed_at is null and expires_at > now() and attempts < $2
      returning email, profile`,
    [sha256(token), MAX_ATTEMPTS]
  );
  const row = result.rows[0];
  if (!row) return { ok: false };
  return { ok: true, email: row.email, profile: row.profile };
}
