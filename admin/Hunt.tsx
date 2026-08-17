import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type HuntItem } from './api';
import { BlobThumb, Button, Card, Banner, EmptyState, Field, Input, PageHeader, Pill, Spinner, useAsync } from './ui';

// Scavenger-hunt admin (Master Control → Hunt) — the section that owns hunt
// content: every item across every list with its thumbnail, prompt variables
// (name / hint / extra judge prompt), and vetting image set. Click through to
// an item for the detail editor (HuntItemDetail). The vision bench (image
// vetting bakeoff) lives under this section too, linked below for
// super_admins.
//
// There are two kinds of list and they're curated identically here: a COURSE
// list (played during a mini-golf round) and a VENUE list (the course-free
// hunt, for sites without mini golf). The only extra a venue list carries is
// its live/not-live state — the venue's own hunt toggle, shown as a pill so a
// staged list doesn't quietly sit dark.

// Authed thumbnail for a hunt-item image (shared BlobThumb underneath).
// Exported for reuse in HuntItemDetail.
export function ItemImageThumb({
  imageId,
  alt,
  className = 'h-20 w-20',
}: {
  imageId: string;
  alt: string;
  className?: string;
}) {
  return (
    <BlobThumb
      fetchBlob={() => api.fetchHuntItemImage(imageId)}
      refetchKey={imageId}
      alt={alt}
      className={className}
    />
  );
}

function ItemRow({ item }: { item: HuntItem }) {
  return (
    <Link
      to={`/hunt/items/${item.id}`}
      className="flex items-center gap-4 rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200 hover:ring-slate-400"
    >
      {item.thumbImageId ? (
        <ItemImageThumb imageId={item.thumbImageId} alt={item.name} />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-slate-100 text-center text-xs text-slate-400">
          no images
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-slate-400">{item.slug}</span>
          {!item.active && <Pill tone="amber">inactive</Pill>}
          {item.countable && <Pill>countable</Pill>}
          {item.extraPrompt && <Pill>extra prompt</Pill>}
        </div>
        {item.hint && <div className="mt-1 truncate text-xs text-slate-500">{item.hint}</div>}
        <div className="mt-1 text-xs text-slate-400">
          {item.imageCount === 1 ? '1 vetting image' : `${item.imageCount} vetting images`}
        </div>
      </div>
    </Link>
  );
}

// Inline "add item" per list: just slug + name to get the row created, then
// the operator lands on the detail editor for hint/prompt/images. `owner` says
// which list — a course's or a venue's — and goes to the API verbatim.
function AddItemForm({
  owner,
  onCreated,
}: {
  owner: { courseId: string } | { locationId: string };
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        + Add item
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          const { item } = await api.createHuntItem({
            ...owner,
            slug: slug.trim(),
            name: name.trim(),
          });
          onCreated(item.id);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Create failed');
          setBusy(false);
        }
      }}
    >
      <Field label="Name">
        <Input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            // Prefill the slug from the name until the operator edits it.
            setSlug(
              e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 40)
            );
          }}
          placeholder="A garden gnome"
        />
      </Field>
      <Field label="Slug">
        <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="gnome" />
      </Field>
      <Button type="submit" disabled={busy || !name.trim() || !slug.trim()}>
        {busy ? 'Creating…' : 'Create'}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && <div className="w-full text-xs text-red-600">{error}</div>}
    </form>
  );
}

export default function Hunt({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const navigate = useNavigate();
  const { data, error, loading } = useAsync(() => api.listHuntItems(), []);

  // One group per curatable list: every live venue's course-free list, plus
  // every live course's. Item-less lists still appear so "+ Add item" is
  // available everywhere, including a venue whose hunt hasn't been built yet.
  //
  // Venue lists lead — a venue's own list is the one an operator without mini
  // golf will be looking for, and at a venue with courses it reads as the
  // park-wide list the courses' lists sit under.
  type Group = {
    key: string;
    label: string;
    owner: { courseId: string } | { locationId: string };
    /** Venue lists only: whether players can actually see this hunt yet. */
    venueMode?: boolean;
    items: HuntItem[];
  };
  const items = data?.items ?? [];
  const venueGroups: Group[] = (data?.venues ?? []).map((venue) => ({
    key: `venue:${venue.id}`,
    label: `${venue.name} · venue-wide`,
    owner: { locationId: venue.id },
    venueMode: venue.venueMode,
    items: items.filter((item) => item.ownerLocationId === venue.id),
  }));
  const courseGroups: Group[] = (data?.courses ?? []).map((course) => ({
    key: `course:${course.id}`,
    label: `${course.locationName ? `${course.locationName} · ` : ''}${course.name}`,
    owner: { courseId: course.id },
    items: items.filter((item) => item.courseId === course.id),
  }));
  const groups = [...venueGroups, ...courseGroups];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Scavenger hunt"
        description="Every hunt item across every course. Each item carries the prompt variables the vision judge sees (name, hint, and extra judge prompt) plus a vetting image set — people-free sample photos used to test the judge before the item goes live. Click an item to edit it."
        actions={
          isSuperAdmin && (
            // Server-rendered vetting bench, not a SPA route (see
            // server/routes/admin/visionBakeoff.js). Same-tab navigation keeps
            // the sessionStorage admin token, so it auths seamlessly.
            <a href="/api/admin/vision-bakeoff/ui" className="text-sm font-medium text-slate-600 underline hover:text-slate-900">
              Vision bench (image vetting) →
            </a>
          )
        }
      />

      {error && <Banner kind="error">{error.message}</Banner>}
      {loading && <Spinner />}
      {data && groups.length === 0 && <EmptyState>No live venues or courses yet.</EmptyState>}
      {groups.map((group) => (
        <Card key={group.key}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
              {group.label}
              {/* A venue list that exists but isn't switched on is invisible to
                  players, which is easy to forget while curating one. Say so
                  here rather than let a finished list sit dark. */}
              {group.venueMode === false && group.items.length > 0 && (
                <Pill tone="amber">not live — turn on in the venue's settings</Pill>
              )}
              {group.venueMode === true && <Pill>live</Pill>}
            </h2>
            <AddItemForm owner={group.owner} onCreated={(id) => navigate(`/hunt/items/${id}`)} />
          </div>
          <div className="space-y-2">
            {group.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
            {group.items.length === 0 && (
              <EmptyState compact>
                {'locationId' in group.owner
                  ? 'No venue-wide items yet.'
                  : 'No items on this course yet.'}
              </EmptyState>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
