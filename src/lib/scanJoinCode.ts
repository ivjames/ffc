// What a camera saw -> a join code to try, or null.
//
// The scanner points at whatever is in front of it, so most frames it decodes
// are NOT ours: a poster's URL, a WiFi credential card, a menu QR on the next
// table. Returning null for those is what lets the scanner keep looking
// instead of closing on the first barcode in the room.
//
// Deliberately NOT a validator. The server owns what a join code may contain
// (server/lib/joinCode.js: the alphabet, the O->0 / I->1 mapping, the length),
// and re-implementing that here would give the room two answers to disagree
// about. This only decides "is this plausibly a code for us", and hands the
// rest to the join call, whose refusal already reads clearly.

/** Codes are 6 chars today; accept a little either side so a length change on
 *  the server doesn't silently stop the scanner working. */
const MIN_CODE = 4;
const MAX_CODE = 8;

const BARE_CODE = /^[0-9A-Z]+$/;

/** Pull a join code out of a scanned string. Null when it isn't ours. */
export function joinCodeFromScan(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;

  // The QR the host lobby renders: a full join link. Read the code out of the
  // query rather than the path, so the link can move without breaking scans
  // already printed on a table tent.
  const fromUrl = codeFromUrl(trimmed);
  if (fromUrl) return fromUrl;

  // Someone's own QR generator, or a code typed into one — a bare code.
  const bare = trimmed.toUpperCase().replace(/[\s-]/g, '');
  if (bare.length >= MIN_CODE && bare.length <= MAX_CODE && BARE_CODE.test(bare)) return bare;

  return null;
}

function codeFromUrl(text: string): string | null {
  // Only bother when it looks like a URL at all — `new URL` on arbitrary text
  // throws, and this runs on every decoded frame.
  if (!/^https?:\/\//i.test(text)) return null;
  let code: string | null = null;
  try {
    code = new URL(text).searchParams.get('code');
  } catch {
    return null;
  }
  if (!code) return null;
  const cleaned = code.trim().toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length < MIN_CODE || cleaned.length > MAX_CODE) return null;
  return BARE_CODE.test(cleaned) ? cleaned : null;
}
