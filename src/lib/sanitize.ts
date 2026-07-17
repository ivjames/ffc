// §6 Input validation — three-initial arcade tags.
// Tags render on a public TV leaderboard (P2), so treat them as public content.
// The Node API re-validates the SAME rules on write; this client check is a UX
// convenience and is fully bypassable by hitting the endpoint directly.

export const TAG_LENGTH = 3;
export const TAG_REGEX = /^[A-Z0-9]{3}$/;

// Small, fixed blocklist of offensive 3-char combos — the classic arcade
// problem. NOT an open-ended profanity library; a simple editable array.
// Keep this in sync with server/lib/sanitize.js.
export const TAG_BLOCKLIST: readonly string[] = [
  'ASS', 'FUK', 'FUC', 'SEX', 'CUM', 'FAG', 'TIT', 'DIK',
  'COK', 'NIG', 'JEW', 'GAY', 'POO', 'PEE', 'GOD', 'DAM',
];

const BLOCKSET = new Set(TAG_BLOCKLIST);

/** Strip to the allowed charset, uppercase, cap at 3 — for live input filtering. */
export function sanitizeTagInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, TAG_LENGTH);
}

export function isValidTag(tag: string): boolean {
  return TAG_REGEX.test(tag) && !BLOCKSET.has(tag);
}

/** Human-readable reason a tag is invalid, or null if it's fine. */
export function tagError(tag: string): string | null {
  if (tag.length < TAG_LENGTH) return 'Enter 3 characters';
  if (!TAG_REGEX.test(tag)) return 'Letters and numbers only';
  if (BLOCKSET.has(tag)) return 'Pick a different tag';
  return null;
}

/** Validate a full roster (1..4 players, each a valid tag, before a round starts). */
export function validateRoster(tags: string[]): { ok: boolean; error?: string } {
  if (tags.length < 1 || tags.length > 4) {
    return { ok: false, error: 'Need 1 to 4 players' };
  }
  for (let i = 0; i < tags.length; i++) {
    const err = tagError(tags[i]);
    if (err) return { ok: false, error: `Player ${i + 1}: ${err}` };
  }
  return { ok: true };
}
