import { apiUrl } from '../../sync';

// §Phase 3 — scavenger hunt client calls. All go through the Node API, which
// proxies the vision model so the key stays server-side.

export type HuntItem = {
  id: string;
  slug: string;
  name: string;
  hint: string | null;
};

// One row per verified find for a group (round), from GET /api/hunt/progress.
export type HuntFind = {
  itemId: string;
  itemSlug: string;
  playerTag: string;
  confidence: number | null;
  flagged: boolean;
  createdAt: string;
};

export type VerifyResult = {
  ok: true;
  verified: boolean;
  flagged?: boolean;
  confidence?: number;
  reason?: string;
  alreadyFound?: boolean;
};

export async function fetchHuntItems(): Promise<HuntItem[]> {
  const res = await fetch(apiUrl('/api/hunt/items'));
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
  playerTag: string;
  roundClientId: string | null;
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

/** Read a File as { base64, mediaType }, stripping the data: URL prefix. */
export function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the photo'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve({
        base64: comma >= 0 ? result.slice(comma + 1) : result,
        mediaType: file.type || 'image/jpeg',
      });
    };
    reader.readAsDataURL(file);
  });
}
