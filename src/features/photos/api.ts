import { apiUrl } from '../../sync';
import { blobToBase64, shareImageBlob } from '../../lib/image';

// Photo booth client calls — the AI-free photo pipeline (server:
// routes/photos.js). Nothing here is verified, judged, or sent to a model;
// the phone flattens stickers into a JPEG and the server just stores bytes.
//
// Access model: the gallery is keyed by an unguessable per-device booth id
// (hunt-style capability key) minted here and kept in localStorage — no
// account, no round required, works for a whole visit and the next one.

const BOOTH_KEY = 'ffc:photoBoothId';

/** The device's booth id, minted on first use. */
export function getBoothId(): string {
  let id = localStorage.getItem(BOOTH_KEY);
  if (!id) {
    id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : // Ancient-browser fallback: still long + random enough to be a key.
          `booth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(BOOTH_KEY, id);
  }
  return id;
}

export type BoothPhoto = {
  id: string;
  createdAt: string;
};

// A venue-uploaded SVG asset for the booth. `kind` decides how it's applied:
//  - 'sticker'   a draggable decoration (the sticker sheet)
//  - 'frame'     a full-photo overlay, one at a time
//  - 'watermark' venue branding forced into `corner` of every photo
// width/height are the SVG's intrinsic box, for aspect sizing.
export type StickerKind = 'sticker' | 'frame' | 'watermark';
export type StickerCorner = 'tl' | 'tr' | 'bl' | 'br';
export type VenueSticker = {
  id: string;
  label: string | null;
  width: number;
  height: number;
  kind: StickerKind;
  corner: StickerCorner;
};

/** The current venue's sticker sheet. Public (branded decorations, not user
 *  content); empty array when the venue has none or is unknown. */
export async function fetchVenueStickers(locationId: string): Promise<VenueSticker[]> {
  const res = await fetch(apiUrl(`/api/photos/stickers?location=${encodeURIComponent(locationId)}`));
  if (!res.ok) throw new Error(`Stickers failed: HTTP ${res.status}`);
  return res.json();
}

/** <img src> URL for a venue sticker's SVG. Served inert (locked-down CSP) and
 *  only ever used as image data, never inlined into the DOM. */
export function venueStickerUrl(id: string): string {
  return apiUrl(`/api/photos/stickers/${id}/image`);
}

export async function fetchBoothPhotos(): Promise<BoothPhoto[]> {
  const res = await fetch(apiUrl(`/api/photos?booth=${encodeURIComponent(getBoothId())}`));
  if (!res.ok) throw new Error(`Photos failed: HTTP ${res.status}`);
  return res.json();
}

/** Direct <img src> URL for a stored photo — the booth key rides in the query,
 *  so no header juggling is needed. `version` busts the browser cache after an
 *  in-place replace (same id, but the bytes changed and the image response is
 *  cached max-age=300, so without this the pre-edit photo can linger). */
export function boothPhotoUrl(id: string, version?: number): string {
  const v = version ? `&v=${version}` : '';
  return apiUrl(`/api/photos/${id}/image?booth=${encodeURIComponent(getBoothId())}${v}`);
}

/**
 * Store a flattened (stickers already baked in) photo in the device's gallery.
 * `locationId` is the current venue if one is chosen — it scopes the
 * operator's review tool, nothing player-facing.
 */
export async function uploadBoothPhoto(args: {
  imageBase64: string;
  mediaType: string;
  locationId?: string;
}): Promise<BoothPhoto> {
  const res = await fetch(apiUrl('/api/photos'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boothId: getBoothId(), ...args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Save failed: HTTP ${res.status}`);
  }
  return body as BoothPhoto;
}

/**
 * Overwrite a saved photo's bytes in place (same id, same position in the
 * gallery) — used when re-saving an edited photo, so it doesn't jump to the
 * front the way a delete + re-upload would.
 */
export async function replaceBoothPhoto(
  id: string,
  args: { imageBase64: string; mediaType: string },
): Promise<void> {
  const res = await fetch(
    apiUrl(`/api/photos/${id}/replace?booth=${encodeURIComponent(getBoothId())}`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Save failed: HTTP ${res.status}`);
}

export async function deleteBoothPhoto(id: string): Promise<void> {
  const res = await fetch(
    apiUrl(`/api/photos/${id}/delete?booth=${encodeURIComponent(getBoothId())}`),
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
}

/** Share a stored photo via the Web Share API (download fallback). Pass the
 *  `version` bumped after an edit so an immediate share never grabs the cached
 *  pre-edit bytes. */
export async function shareBoothPhoto(
  id: string,
  version?: number,
): Promise<'shared' | 'downloaded'> {
  const res = await fetch(boothPhotoUrl(id, version));
  if (!res.ok) throw new Error(`Photo unavailable: HTTP ${res.status}`);
  const blob = await res.blob();
  const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  return shareImageBlob(blob, `photo-booth.${ext}`, {
    title: 'Photo booth',
    text: 'Snapped at mini golf! ⛳📸',
  });
}

/** Share a just-decorated photo straight from the editor — no upload needed,
 *  so it works offline too. */
export async function shareEditedPhoto(blob: Blob): Promise<'shared' | 'downloaded'> {
  return shareImageBlob(blob, 'photo-booth.jpg', {
    title: 'Photo booth',
    text: 'Snapped at mini golf! ⛳📸',
  });
}

export { blobToBase64 };

/** Booth-photo retention window, for the /privacy disclosure. Null = unknown
 *  (offline) — the caller words that case without promising a number. */
export async function fetchBoothRetentionDays(): Promise<number | null> {
  try {
    const res = await fetch(apiUrl('/api/photos/retention'));
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.days === 'number' ? data.days : null;
  } catch {
    return null;
  }
}
