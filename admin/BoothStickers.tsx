import { useEffect, useRef, useState } from 'react';
import { api, type AdminVenueSticker, type Location } from './api';
import { Button, Card, Banner, Spinner, fmtDateTime } from './ui';

// Venue sticker management — the operator side of the photo booth's SVG
// stickers. Staff upload their own decorations per venue; players at that
// location get them in the booth's sticker sheet alongside the built-in emoji.
//
// SECURITY (mirrors the server): SVG is an XSS vector, so the server validates
// every upload (rejects scripts/handlers/foreignObject/external refs/DOCTYPE)
// and serves them inert. Here we only ever render a sticker as an <img> from
// the public serve endpoint — never inlined — so a preview can't execute
// anything even if something slipped through.

// Client-side guard mirroring the server cap, for a friendlier early error.
const MAX_SVG_BYTES = 512 * 1024;

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
        <div className="font-medium">{sticker.label || <span className="text-slate-400">(no label)</span>}</div>
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
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState('');
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
    if (file.size > MAX_SVG_BYTES) {
      setError('That SVG is too large (max 512 KB).');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const svg = await file.text();
      await api.uploadBoothSticker({ locationId, label: label.trim() || undefined, svg });
      setLabel('');
      reloadStickers();
    } catch (err) {
      // Server rejection (dangerous/malformed SVG) surfaces here verbatim.
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Booth stickers</h1>
      <p className="text-sm text-slate-500">
        Upload SVG decorations for a venue; players there get them in the photo booth alongside the
        built-in emoji. SVGs are validated on upload (scripts, event handlers, external references,
        and entity/XXE payloads are rejected) and always served and rendered as inert images.
      </p>

      {error && <Banner kind="error">{error}</Banner>}

      <Card className="space-y-3">
        <label className="block text-sm font-medium text-slate-600">
          Venue
          <select
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            {(locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 text-sm font-medium text-slate-600">
            Label (optional)
            <input
              type="text"
              value={label}
              maxLength={100}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. House logo"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".svg,image/svg+xml"
            className="hidden"
            onChange={(e) => void onFile(e)}
          />
          <Button disabled={uploading || !locationId} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Uploading…' : 'Upload SVG'}
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
            <p className="py-4 text-center text-sm text-slate-400">
              No stickers for this venue yet — upload one above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
