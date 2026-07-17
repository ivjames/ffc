// Server-side input validation. MUST match the client's rules exactly, because
// the client check is bypassable — anything reaching /api/rounds is re-validated here.

// Tag charset: exactly 3 chars, uppercase A-Z or 0-9.
const TAG_RE = /^[A-Z0-9]{3}$/;

// Blocklist of offensive 3-char combos. Kept as a simple exported array so it's
// easy to edit. Compared case-insensitively against the (already-uppercased) tag.
// Keep this in sync with the client's TAG_BLOCKLIST (src/lib/sanitize.ts).
export const BLOCKLIST = [
  "ASS", "FUK", "FUC", "SEX", "CUM", "FAG", "TIT", "DIK",
  "COK", "NIG", "JEW", "GAY", "POO", "PEE", "GOD", "DAM",
];

// A fast set for membership checks (values are uppercase).
const BLOCKSET = new Set(BLOCKLIST.map((w) => w.toUpperCase()));

/**
 * True if `tag` is exactly 3 chars [A-Z0-9] and not on the blocklist.
 * Does NOT uppercase for you — the client stores/sends uppercase tags, and we
 * validate the exact bytes we were given so a bypassed client can't sneak
 * lowercase past the blocklist.
 */
export function isValidTag(tag) {
  if (typeof tag !== "string") return false;
  if (!TAG_RE.test(tag)) return false;
  if (BLOCKSET.has(tag)) return false;
  return true;
}

/**
 * Validate an array of player tags.
 * Rules: must be an array of 1..4 entries, each a valid tag.
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateTags(tags) {
  if (!Array.isArray(tags)) {
    return { ok: false, error: "playerTags must be an array" };
  }
  if (tags.length < 1 || tags.length > 4) {
    return { ok: false, error: "playerTags must have 1..4 entries" };
  }
  for (const tag of tags) {
    if (!isValidTag(tag)) {
      return { ok: false, error: `invalid or blocked tag: ${JSON.stringify(tag)}` };
    }
  }
  return { ok: true };
}
