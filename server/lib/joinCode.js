// Shared-game join codes: 6 chars from a Crockford-style base-32 alphabet
// (no I, L, O, U — the letters people misread). ~10^9 combinations against a
// handful of open games at three venues, so guessing is hopeless at the join
// endpoint's rate limit. Codes are unique among OPEN games only (partial
// unique index); a finished game retires its code back into the pool.
import { randomInt } from "node:crypto";

export const JOIN_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const JOIN_CODE_LENGTH = 6;

export function generateJoinCode() {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[randomInt(0, JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Forgiving input normalization: trim, uppercase, and map the lookalikes the
 * alphabet excludes onto what the reader actually saw (O→0, I/L→1).
 * @returns {string|null} a valid-shaped code, or null.
 */
export function normalizeJoinCode(input) {
  if (typeof input !== "string") return null;
  const mapped = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (mapped.length !== JOIN_CODE_LENGTH) return null;
  for (const ch of mapped) {
    if (!JOIN_CODE_ALPHABET.includes(ch)) return null;
  }
  return mapped;
}
