import { useCallback, useEffect, useState } from 'react';
import { api, type AdminBoothPhoto } from './api';
import { Button, Card, Banner, Spinner, fmtDateTime } from './ui';

// Photo-booth review — the operator side of the AI-free photo pipeline
// (player side: the app's Photo Booth). Unlike hunt photos, NOTHING screened
// these before they hit disk (no vision pass, no moderation verdict), so this
// page carries the whole safety load for a family venue: eyeball what guests
// are storing, and delete anything that doesn't belong — or any photo a guest
// asks to have removed. Removal deletes the photo for good (file and record;
// there's no gameplay credit to preserve). Photos also age out automatically
// after the retention window (PHOTO_BOOTH_RETENTION_DAYS, default 30 days) —
// this page is for human judgment inside that window.

// <img src> can't carry the admin auth header, so each thumbnail fetches its
// bytes into an object URL (revoked on unmount so removed photos don't leak).
function BoothPhotoThumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    api.fetchBoothPhotoImage(id).then(
      (blob) => {
        // Resolved after unmount: cleanup already ran, so revoke right here —
        // assigning objectUrl instead would leak the blob for the SPA's life.
        const u = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  if (failed) {
    return (
      <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs text-slate-400">
        unavailable
      </div>
    );
  }
  if (!url) return <div className="h-28 w-28 shrink-0 animate-pulse rounded-md bg-slate-100" />;
  return <img src={url} alt="Booth photo" className="h-28 w-28 shrink-0 rounded-md object-cover" />;
}

function BoothPhotoRow({ photo, onRemoved }: { photo: AdminBoothPhoto; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="flex items-center gap-4">
      <BoothPhotoThumb id={photo.id} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Photo booth</div>
        <div className="mt-1 text-xs text-slate-400">
          {photo.locationName ? `${photo.locationName} · ` : ''}taken {fmtDateTime(photo.createdAt)}
        </div>
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      </div>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm('Delete this photo from the server? This cannot be undone.')) {
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await api.removeBoothPhoto(photo.id);
            onRemoved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : 'Delete photo'}
      </Button>
    </Card>
  );
}

const PAGE_SIZE = 100;

export default function BoothPhotos() {
  // Paged by hand rather than useAsync: a full page signals more may exist,
  // and "Load more" appends the next page via the last row's createdAt cursor.
  const [photos, setPhotos] = useState<AdminBoothPhoto[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadPage = useCallback(async (existing: AdminBoothPhoto[]) => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.listBoothPhotos({
        before: existing.length > 0 ? existing[existing.length - 1].createdAt : undefined,
        limit: PAGE_SIZE,
      });
      setPhotos([...existing, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPhotos(null);
    void loadPage([]);
  }, [loadPage]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Booth photos</h1>
      <p className="text-sm text-slate-500">
        Every photo-booth picture currently stored on the server. Unlike hunt photos, these are
        NOT screened by AI before storage — this page is the moderation. Photos delete themselves
        after the retention window (default 30 days); guests can also delete their own in the
        app, and you can delete one here immediately — e.g. when a guest asks.
      </p>

      {error && <Banner kind="error">{error.message}</Banner>}
      {photos && (
        <div className="space-y-2">
          {photos.map((p) => (
            <BoothPhotoRow
              key={p.id}
              photo={p}
              onRemoved={() => setPhotos((cur) => cur?.filter((x) => x.id !== p.id) ?? null)}
            />
          ))}
          {photos.length === 0 && !loading && (
            <p className="py-4 text-center text-sm text-slate-400">No photos stored right now.</p>
          )}
        </div>
      )}
      {loading && <Spinner />}
      {photos && hasMore && !loading && (
        <div className="text-center">
          <Button variant="ghost" onClick={() => void loadPage(photos)}>
            Load older photos
          </Button>
        </div>
      )}
    </div>
  );
}
