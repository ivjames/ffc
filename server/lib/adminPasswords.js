// Password hashing for admin_user, using Node's built-in scrypt (no bcrypt/
// argon2 dependency needed — this codebase stays deliberately dependency-light).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

/** Hash a plaintext password into the `scrypt salt:hash` form stored in
 * admin_user.password_hash. Never store or log the plaintext. */
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

// Precomputed once so a "user not found" login attempt still pays the same
// scrypt cost as a real one — otherwise the response-time difference leaks
// whether an email is registered.
const DUMMY_STORED = hashPassword(randomBytes(32).toString("hex"));

/** True if `password` matches `stored` (the `salt:hash` string from the DB). */
export function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hashHex] = stored.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Call on a failed lookup (no such user) to keep login timing uniform. */
export function verifyDummyPassword(password) {
  verifyPassword(password, DUMMY_STORED);
}
