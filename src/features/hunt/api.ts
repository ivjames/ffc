import { apiUrl } from '../../sync';
import { shareImageBlob } from '../../lib/image';

// §Phase 3 — scavenger hunt client calls. All go through the Node API, which
// proxies the vision model so the key stays server-side.

// The canvas downscale/encode pipeline moved to the shared module when the
// photo booth arrived; re-exported so existing hunt imports keep working.
export { fileToUpload } from '../../lib/image';

export type HuntItem = {
  id: string;
  slug: string;
  name: string;
  hint: string | null;
  // "Find as many as you can" — every verified find counts, not just the first
  // (e.g. the Western horseshoes). Normal items are found once.
  countable: boolean;
};

// One row per verified find for a group (round), from GET /api/hunt/progress.
export type HuntFind = {
  id: string;
  itemId: string;
  itemSlug: string;
  playerTag: string;
  confidence: number | null;
  flagged: boolean;
  // The stored photo passed auto-moderation and can be fetched/shared by the
  // group (GET /api/hunt/photo/:id, keyed by the round clientId).
  sharable: boolean;
  createdAt: string;
};

export type VerifyResult = {
  ok: true;
  verified: boolean;
  flagged?: boolean;
  confidence?: number;
  reason?: string;
  alreadyFound?: boolean;
  // For countable items: how many this player has now found in this round.
  count?: number;
};

// Each course has its own themed list, so items are fetched by course.
export async function fetchHuntItems(courseId: string): Promise<HuntItem[]> {
  const res = await fetch(apiUrl(`/api/hunt/items?course=${encodeURIComponent(courseId)}`));
  if (!res.ok) throw new Error(`Hunt items failed: HTTP ${res.status}`);
  return res.json();
}

export async function fetchHuntProgress(roundClientId: string): Promise<HuntFind[]> {
  const res = await fetch(apiUrl(`/api/hunt/progress?round=${encodeURIComponent(roundClientId)}`));
  if (!res.ok) throw new Error(`Hunt progress failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Submit a photo for verification. `imageBase64` is the raw base64 (no data:
 * prefix); `mediaType` is the file's MIME type.
 */
export async function verifyFind(args: {
  itemId: string;
  courseId: string; // the round's course — the item must belong to it
  playerTag: string;
  roundClientId: string; // required — the hunt is tied to an in-progress round
  imageBase64: string;
  mediaType: string;
}): Promise<VerifyResult> {
  const res = await fetch(apiUrl('/api/hunt/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Verify failed: HTTP ${res.status}`);
  }
  return body as VerifyResult;
}

/**
 * Share a find's photo (punchlist #9 tier 2). Fetches the group's own stored
 * photo (auto-moderation approved — the server refuses anything else) and
 * hands it to the Web Share API, falling back to a download on browsers
 * without file sharing. Returns how it went out.
 */
export async function shareFindPhoto(
  find: HuntFind,
  roundClientId: string,
  itemName: string,
): Promise<'shared' | 'downloaded'> {
  const res = await fetch(
    apiUrl(`/api/hunt/photo/${find.id}?round=${encodeURIComponent(roundClientId)}`),
  );
  if (!res.ok) throw new Error(`Photo unavailable: HTTP ${res.status}`);
  const blob = await res.blob();
  const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  return shareImageBlob(blob, `hunt-${find.itemSlug}.${ext}`, {
    title: `Scavenger hunt: ${itemName}`,
    text: `${find.playerTag} found ${itemName} on the mini golf scavenger hunt! ⛳🔍`,
  });
}
