import { useCallback, useEffect, useState } from 'react';
import { api, type AdminPhoto } from './api';
import { BlobThumb, Button, Card, Banner, EmptyState, PageHeader, Pill, Segmented, Spinner, fmtDateTime, useToast } from './ui';

// Hunt-photo review — the operator side of the scavenger-hunt photo pipeline.
// Every stored photo is listed here (auto-moderation already blocked unsafe
// shots before they touched disk), so staff can eyeball what's on the server
// and honor a "please delete that photo" request on the spot. Removal deletes
// the file for good; the find itself (who found what, when) keeps its credit.
// Photos also age out automatically after the server's retention window
// (HUNT_PHOTO_RETENTION_DAYS, default 30 days) — this page is for human
// judgment inside that window.

type Filter = 'all' | 'people' | 'minors';

function PhotoRow({ photo, onRemoved }: { photo: AdminPhoto; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  return (
    <Card className="flex items-center gap-4">
      <BlobThumb
        fetchBlob={() => api.fetchPhotoImage(photo.id)}
        refetchKey={photo.id}
        alt={`${photo.itemName} found by ${photo.playerTag}`}
      />
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
            toast('Photo deleted.');
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

export default function Photos() {
  const [filter, setFilter] = useState<Filter>('all');
  // Paged by hand rather than useAsync: a full page signals more may exist,
  // and "Load more" appends the next page via the last row's createdAt cursor
  // — an active venue can hold far more photos than one page.
  const [photos, setPhotos] = useState<AdminPhoto[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadPage = useCallback(
    async (existing: AdminPhoto[]) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.listPhotos({
          filter: filter === 'all' ? undefined : filter,
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
    },
    [filter]
  );

  useEffect(() => {
    setPhotos(null);
    void loadPage([]);
  }, [loadPage]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hunt photos"
        description="Every scavenger-hunt photo currently stored on the server. Photos delete themselves after the retention window (default 30 days); delete one here to remove it immediately — e.g. when a guest asks. The player keeps the find either way."
      />

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'people', label: 'With people' },
          { value: 'minors', label: 'With minors' },
        ]}
      />

      {error && <Banner kind="error">{error.message}</Banner>}
      {photos && (
        <div className="space-y-2">
          {photos.map((p) => (
            <PhotoRow
              key={p.id}
              photo={p}
              onRemoved={() => setPhotos((cur) => cur?.filter((x) => x.id !== p.id) ?? null)}
            />
          ))}
          {photos.length === 0 && !loading && (
            <EmptyState>
              {filter === 'all' ? 'No photos stored right now.' : 'No photos match this filter.'}
            </EmptyState>
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
