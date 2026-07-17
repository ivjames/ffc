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

/** Read a Blob as base64 (data: URL prefix stripped). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the photo'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode the photo'));
    };
    img.src = url;
  });
}

/**
 * Turn a camera File into an upload payload. Phone photos are several MB; we
 * downscale to at most `maxDim` on the long edge and re-encode as JPEG so the
 * request stays small (less mobile data, lower vision cost, no size limits).
 * Falls back to the raw file if canvas encoding isn't available.
 */
export async function fileToUpload(
  file: File,
  maxDim = 1600,
  quality = 0.82,
): Promise<{ base64: string; mediaType: string }> {
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/jpeg', quality),
    );
    if (!blob) throw new Error('encode failed');
    return { base64: await blobToBase64(blob), mediaType: 'image/jpeg' };
  } catch {
    // Fallback: send the original file as-is.
    return { base64: await blobToBase64(file), mediaType: file.type || 'image/jpeg' };
  }
}
