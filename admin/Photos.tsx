import { useEffect, useState } from 'react';
import { api, type AdminPhoto } from './api';
import { Button, Card, Banner, Spinner, Pill, useAsync, fmtDateTime } from './ui';

// Hunt-photo review — the operator side of the scavenger-hunt photo pipeline.
// Every stored photo is listed here (auto-moderation already blocked unsafe
// shots before they touched disk), so staff can eyeball what's on the server
// and honor a "please delete that photo" request on the spot. Removal deletes
// the file for good; the find itself (who found what, when) keeps its credit.
// Photos also age out automatically after the server's retention window
// (HUNT_PHOTO_RETENTION_DAYS, default 30 days) — this page is for human
// judgment inside that window.

type Filter = 'all' | 'people' | 'minors';

// <img src> can't carry the admin auth header, so each thumbnail fetches its
// bytes into an object URL (revoked on unmount so removed photos don't leak).
function PhotoThumb({ id, alt }: { id: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    api.fetchPhotoImage(id).then(
      (blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
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
  return <img src={url} alt={alt} className="h-28 w-28 shrink-0 rounded-md object-cover" />;
}

function PhotoRow({ photo, onRemoved }: { photo: AdminPhoto; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="flex items-center gap-4">
      <PhotoThumb id={photo.id} alt={`${photo.itemName} found by ${photo.playerTag}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{photo.itemName}</span>
          <Pill>{photo.playerTag}</Pill>
          {photo.peoplePresent && <Pill>people</Pill>}
          {photo.minorsPresent && <Pill>minors</Pill>}
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {photo.courseName}
          {photo.locationName ? ` · ${photo.locationName}` : ''} · taken {fmtDateTime(photo.createdAt)}
        </div>
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      </div>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm('Delete this photo from the server? This cannot be undone (the find keeps its credit).')) {
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await api.removePhoto(photo.id);
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

export default function Photos() {
  const [filter, setFilter] = useState<Filter>('all');
  const photos = useAsync(
    () => api.listPhotos(filter === 'all' ? undefined : filter),
    [filter]
  );

  const filterBtn = (value: Filter, label: string) => (
    <button
      type="button"
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        filter === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'
      }`}
      onClick={() => setFilter(value)}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Hunt photos</h1>
      <p className="text-sm text-slate-500">
        Every scavenger-hunt photo currently stored on the server. Photos delete themselves after
        the retention window (default 30 days); delete one here to remove it immediately — e.g. when
        a guest asks. The player keeps the find either way.
      </p>

      <div className="flex gap-1">
        {filterBtn('all', 'All')}
        {filterBtn('people', 'With people')}
        {filterBtn('minors', 'With minors')}
      </div>

      {photos.loading && <Spinner />}
      {photos.error && <Banner kind="error">{photos.error.message}</Banner>}
      {photos.data && (
        <div className="space-y-2">
          {photos.data.map((p) => (
            <PhotoRow key={p.id} photo={p} onRemoved={photos.reload} />
          ))}
          {photos.data.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">
              {filter === 'all' ? 'No photos stored right now.' : 'No photos match this filter.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
