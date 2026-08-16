import { useEffect, useRef, useState } from 'react';
import {
  api,
  type AdminVenueSticker,
  type AdminStickerKind,
  type AdminStickerCorner,
  type Location,
} from './api';
import { Button, Card, Banner, EmptyState, Field, Input, PageHeader, Pill, Select, Spinner, fmtDateTime } from './ui';

const CORNER_LABEL: Record<AdminStickerCorner, string> = {
  tl: 'top-left',
  tr: 'top-right',
  bl: 'bottom-left',
  br: 'bottom-right',
};

// Venue sticker management — the operator side of the photo booth's SVG
// stickers. Staff upload their own decorations per venue; players at that
// location get them in the booth's sticker sheet alongside the built-in emoji.
//
// SECURITY (mirrors the server): SVG is an XSS vector, so the server validates
// every upload (rejects scripts/handlers/foreignObject/external refs/DOCTYPE)
// and serves them inert. Here we only ever render a sticker as an <img> from
// the public serve endpoint — never inlined — so a preview can't execute
// anything even if something slipped through.

// Client-side guards mirroring the server caps, for a friendlier early error.
const MAX_SVG_BYTES = 512 * 1024;
const MAX_PNG_BYTES = 4 * 1024 * 1024;
// Refuse to even decode something absurd (a huge PNG would pin the browser).
const MAX_PNG_INPUT_BYTES = 40 * 1024 * 1024;

/** Read a Blob's bytes as base64 (data: prefix stripped) — for PNG uploads. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file'));
    r.onload = () => {
      const s = String(r.result);
      const c = s.indexOf(',');
      resolve(c >= 0 ? s.slice(c + 1) : s);
    };
    r.readAsDataURL(blob);
  });
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = src;
  });
}

/** Whether this browser can encode WebP from a canvas (needed to compress). */
function canEncodeWebp(): boolean {
  try {
    return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

/** Re-encode an image to WebP at its NATIVE dimensions and a given quality
 *  (lossy, alpha preserved). Null if canvas/WebP is unavailable. */
function encodeWebp(img: HTMLImageElement, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(img, 0, 0);
  return new Promise((res) => canvas.toBlob(res, 'image/webp', quality));
}

/** Prepare a raster (PNG) for upload. Under the cap -> upload the PNG as-is.
 *  Over the cap -> COMPRESS it (not resize): re-encode to WebP at the ORIGINAL
 *  dimensions, stepping quality down until it fits, so the resolution is
 *  unchanged and transparency is kept. */
async function prepareRaster(file: File): Promise<{ base64: string; mediaType: 'image/png' | 'image/webp'; compressed: boolean }> {
  if (file.size <= MAX_PNG_BYTES) {
    return { base64: await blobToBase64(file), mediaType: 'image/png', compressed: false };
  }
  if (!canEncodeWebp()) {
    throw new Error(
      'This image is over 4 MB and this browser can’t compress it — please compress the PNG first or use a newer browser.',
    );
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageEl(url);
    for (const q of [0.92, 0.85, 0.75, 0.65, 0.5]) {
      const blob = await encodeWebp(img, q);
      if (blob && blob.size <= MAX_PNG_BYTES) {
        return { base64: await blobToBase64(blob), mediaType: 'image/webp', compressed: true };
      }
    }
    throw new Error('Couldn’t compress that image under 4 MB — try a simpler graphic.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function StickerCard({ sticker, onRemoved }: { sticker: AdminVenueSticker; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="flex items-center gap-4">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-slate-100 p-2">
        {/* Public serve endpoint (no auth needed); inert image, never inlined. */}
        <img
          src={`/api/photos/stickers/${sticker.id}/image`}
          alt={sticker.label ?? 'sticker'}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {sticker.label || <span className="text-slate-400">(no label)</span>}
          </span>
          <Pill tone={sticker.kind === 'sticker' ? 'slate' : 'amber'}>
            {sticker.kind}
            {sticker.kind === 'watermark' ? ` · ${CORNER_LABEL[sticker.corner]}` : ''}
          </Pill>
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {sticker.width}×{sticker.height} · added {fmtDateTime(sticker.createdAt)}
        </div>
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      </div>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm('Remove this sticker from the venue? This cannot be undone.')) return;
          setBusy(true);
          setError(null);
          try {
            await api.removeBoothSticker(sticker.id);
            onRemoved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : 'Remove'}
      </Button>
    </Card>
  );
}

export default function BoothStickers() {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [locationId, setLocationId] = useState<string>('');
  const [stickers, setStickers] = useState<AdminVenueSticker[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<AdminStickerKind>('sticker');
  const [corner, setCorner] = useState<AdminStickerCorner>('tr');
  const [reloadKey, setReloadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listLocations().then(
      (locs) => {
        setLocations(locs);
        if (locs.length > 0) setLocationId((cur) => cur || locs[0].id);
      },
      (err) => setError((err as Error).message),
    );
  }, []);

  // Load the selected venue's stickers, ignoring a stale response if the
  // operator switches venues while a slower request is still in flight — else
  // an older list could overwrite the newer venue's (and a delete would target
  // the wrong venue). The effect's cleanup marks the in-flight request stale.
  useEffect(() => {
    if (!locationId) return;
    let active = true;
    setStickers(null);
    setLoading(true);
    setError(null);
    api.listBoothStickers(locationId).then(
      (list) => {
        if (!active) return;
        setStickers(list);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        setError((err as Error).message);
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [locationId, reloadKey]);

  // Bump to re-run the loader (after an upload/remove) without a venue change.
  function reloadStickers() {
    setReloadKey((k) => k + 1);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !locationId) return;

    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
    if (!isSvg && !isPng) {
      setError('Please choose an SVG or PNG file.');
      return;
    }
    // SVG can't be meaningfully compressed (it's vector text); a huge one is
    // pathological, so keep the hard cap. A big PNG is compressed below.
    if (isSvg && file.size > MAX_SVG_BYTES) {
      setError('That SVG is too large (max 512 KB).');
      return;
    }
    if (isPng && file.size > MAX_PNG_INPUT_BYTES) {
      setError('That PNG is too large to process — please export a smaller one.');
      return;
    }

    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const common = {
        locationId,
        label: label.trim() || undefined,
        kind,
        corner: kind === 'watermark' ? corner : undefined,
      };
      if (isPng) {
        // Over the cap -> compressed to WebP at the same resolution (not resized).
        const { base64, mediaType, compressed } = await prepareRaster(file);
        await api.uploadBoothSticker({ ...common, imageBase64: base64, mediaType });
        if (compressed) {
          setNotice('That PNG was over 4 MB, so it was compressed (same resolution) to fit.');
        }
      } else {
        await api.uploadBoothSticker({ ...common, svg: await file.text() });
      }
      setLabel('');
      reloadStickers();
    } catch (err) {
      // Server rejection (dangerous/malformed SVG, non-PNG, too large) shows here.
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Booth stickers"
        description={
          <>
            Upload <strong>SVG</strong> or transparent <strong>PNG</strong> art for a venue.{' '}
            <strong>Stickers</strong> are draggable decorations; <strong>frames</strong> overlay the
            whole photo (proscenium/border); a <strong>watermark</strong> is branding forced into a
            corner of every photo. Use a transparent background (SVG or PNG — not JPEG) so the photo
            shows through. SVGs are validated on upload (scripts, event handlers, external
            references, and entity/XXE payloads are rejected); everything is served and rendered as
            inert images.
          </>
        }
      />

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="info">{notice}</Banner>}

      <Card className="space-y-3">
        <Field label="Venue">
          <Select
            className="w-full"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            {(locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Role">
            <Select value={kind} onChange={(e) => setKind(e.target.value as AdminStickerKind)}>
              <option value="sticker">Sticker</option>
              <option value="frame">Frame</option>
              <option value="watermark">Watermark</option>
            </Select>
          </Field>
          {kind === 'watermark' && (
            <Field label="Corner">
              <Select value={corner} onChange={(e) => setCorner(e.target.value as AdminStickerCorner)}>
                <option value="tr">Top-right</option>
                <option value="tl">Top-left</option>
                <option value="br">Bottom-right</option>
                <option value="bl">Bottom-left</option>
              </Select>
            </Field>
          )}
          <div className="flex-1">
            <Field label="Label (optional)">
              <Input
                type="text"
                value={label}
                maxLength={100}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. House logo"
              />
            </Field>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".svg,image/svg+xml,.png,image/png"
            className="hidden"
            onChange={(e) => void onFile(e)}
          />
          <Button disabled={uploading || !locationId} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Uploading…' : 'Upload SVG / PNG'}
          </Button>
        </div>
      </Card>

      {loading && <Spinner />}
      {stickers && (
        <div className="space-y-2">
          {stickers.map((s) => (
            <StickerCard
              key={s.id}
              sticker={s}
              onRemoved={() => setStickers((cur) => cur?.filter((x) => x.id !== s.id) ?? null)}
            />
          ))}
          {stickers.length === 0 && !loading && (
            <EmptyState>No stickers for this venue yet — upload one above.</EmptyState>
          )}
        </div>
      )}
    </div>
  );
}
