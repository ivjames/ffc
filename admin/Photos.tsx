import { useEffect, useState } from 'react';
import { api, type Photo, type PhotoFilter } from './api';
import { Button, Card, Banner, Spinner, Pill, useAsync, fmtDateTime } from './ui';

// Hunt photo moderation review. Every photo is auto-moderated by the vision
// pass at upload (unsafe shots never reach disk); this screen is the human
// layer — clear the review queue (legacy photos + flagged events), spot-check
// what the model approved, and Reject anything that shouldn't stay (which
// deletes the image file for good while keeping the find's gameplay credit).

const FILTERS: { key: PhotoFilter; label: string }[] = [
  { key: 'review', label: 'Needs review' },
  { key: 'people', label: 'People' },
  { key: 'minors', label: 'Minors' },
  { key: 'approved', label: 'Approved' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

// Authenticated <img>: the image endpoint requires the admin auth header, so
// fetch the bytes and object-URL them.
function AuthImg({ photoId, alt }: { photoId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;
    api.fetchPhotoBlob(photoId).then(
      (blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (alive) setUrl(objectUrl);
      },
      () => {
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);
  if (failed)
    return (
      <div className="flex h-28 w-28 items-center justify-center rounded bg-slate-100 text-xs text-slate-400">
        no image
      </div>
    );
  if (!url) return <div className="h-28 w-28 animate-pulse rounded bg-slate-100" />;
  return <img src={url} alt={alt} className="h-28 w-28 rounded object-cover" />;
}

function moderationPill(p: Photo) {
  switch (p.moderation) {
    case 'approved':
      return <Pill>Approved</Pill>;
    case 'flagged':
      return <Pill tone="amber">Flagged</Pill>;
    case 'rejected':
      return <Pill tone="amber">Rejected</Pill>;
    default:
      return <Pill tone="amber">Unreviewed</Pill>;
  }
}

function PhotoRow({ photo, onChanged }: { photo: Photo; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: (id: string) => Promise<unknown>) {
    setErr(null);
    setBusy(true);
    try {
      await fn(photo.id);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex items-start gap-4">
      {photo.hasPhoto ? (
        <AuthImg photoId={photo.id} alt={`${photo.itemName} by ${photo.playerTag}`} />
      ) : (
        <div className="flex h-28 w-28 items-center justify-center rounded bg-slate-100 text-center text-xs text-slate-400">
          blocked at
          <br />
          upload
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{photo.itemName}</span>
          {moderationPill(photo)}
          {photo.peoplePresent && <Pill>People</Pill>}
          {photo.minorsPresent && <Pill tone="amber">Minors</Pill>}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">
          {photo.playerTag} · {photo.courseName}
          {photo.locationName ? ` · ${photo.locationName}` : ''} · {fmtDateTime(photo.createdAt)}
        </div>
        {photo.moderationReason && (
          <div className="mt-1 text-xs text-amber-700">{photo.moderationReason}</div>
        )}
        {err && (
          <div className="mt-2">
            <Banner kind="error">{err}</Banner>
          </div>
        )}
      </div>
      {photo.hasPhoto && (
        <div className="flex shrink-0 flex-col gap-2">
          {photo.moderation !== 'approved' && (
            <Button disabled={busy} onClick={() => act(api.approvePhoto)}>
              Approve
            </Button>
          )}
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Reject this photo? The image file is deleted permanently.')) {
                void act(api.rejectPhoto);
              }
            }}
          >
            Reject
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function Photos() {
  const [filter, setFilter] = useState<PhotoFilter>('review');
  const { data, error, loading, reload } = useAsync(() => api.listPhotos(filter), [filter]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Photo moderation</h1>
      <Banner kind="info">
        Every hunt photo is auto-moderated at upload — unsafe shots are blocked before they touch
        disk. This queue is the human check: review legacy/flagged items and pull anything the
        model shouldn't have kept. Rejecting deletes the image permanently (the player keeps their
        find).
      </Banner>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              filter === f.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <Spinner />}
      {error && <Banner kind="error">{error.message}</Banner>}
      {data && (
        <div className="space-y-2">
          {data.map((p) => (
            <PhotoRow key={p.id} photo={p} onChanged={reload} />
          ))}
          {data.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">
              {filter === 'review' ? 'Nothing needs review. 🎉' : 'No photos under this filter.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
