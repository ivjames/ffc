import { useState } from 'react';
import { api, type Announcement, type Location } from './api';
import { Button, Card, Field, Input, Banner, Spinner, Pill, useAsync, fmtDateTime } from './ui';

// Announcements / special updates (punchlist #1). Rows here go live to the
// player app and TV board IMMEDIATELY (the app polls /api/announcements) —
// unlike location/course content, there is no rebuild step.

// datetime-local wants "YYYY-MM-DDTHH:MM" in the operator's local clock; the
// API stores ISO. Convert both ways at the form boundary.
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function AnnouncementForm({
  initial,
  locations,
  isSuperAdmin,
  onDone,
}: {
  initial: Announcement | null;
  locations: Location[];
  isSuperAdmin: boolean;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [locationId, setLocationId] = useState(
    initial?.locationId ?? (isSuperAdmin ? '' : locations[0]?.id ?? '')
  );
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial?.endsAt ?? null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.saveAnnouncement({
        ...(initial ? { id: initial.id } : {}),
        title: title.trim(),
        body: body.trim() || null,
        locationId: locationId || null,
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
        sortOrder: initial?.sortOrder ?? 0,
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      {err && <Banner kind="error">{err}</Banner>}
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Taco Tuesday" />
      </Field>
      <Field label="Body" hint="Optional detail line shown under the title.">
        <Input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Half-price tacos at the snack bar all day"
        />
      </Field>
      <Field
        label="Location"
        hint={isSuperAdmin ? 'Every location, or pin it to one venue.' : 'Pinned to one of your venues.'}
      >
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          {isSuperAdmin && <option value="">All locations</option>}
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts" hint="Blank = immediately.">
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label="Ends" hint="Blank = until archived.">
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !title.trim()}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Publish announcement'}
        </Button>
        {initial && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

// Live now / scheduled / ended, from the row's window.
function windowState(a: Announcement): { label: string; tone: 'slate' | 'amber' } {
  const now = Date.now();
  if (a.startsAt && new Date(a.startsAt).getTime() > now) return { label: 'Scheduled', tone: 'slate' };
  if (a.endsAt && new Date(a.endsAt).getTime() <= now) return { label: 'Ended', tone: 'amber' };
  return { label: 'Live', tone: 'slate' };
}

export default function Announcements({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const { data, error, loading, reload } = useAsync(
    async () => {
      const [announcements, locations] = await Promise.all([
        api.listAnnouncements(showArchived),
        api.listLocations(),
      ]);
      return { announcements, locations };
    },
    [showArchived]
  );

  if (loading) return <Spinner />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data) return null;

  const rows = showArchived
    ? data.announcements.filter((a) => a.archivedAt)
    : data.announcements;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Announcements</h1>
        <button
          type="button"
          className="ml-auto text-xs text-slate-500 underline"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? 'Show live' : 'Show archived'}
        </button>
      </div>

      <Banner kind="info">
        Announcements go live to the app and TV board immediately — no rebuild needed.
      </Banner>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {editing ? 'Edit announcement' : 'New announcement'}
        </h2>
        <AnnouncementForm
          key={editing?.id ?? 'new'}
          initial={editing}
          locations={data.locations}
          isSuperAdmin={isSuperAdmin}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      </Card>

      <div className="space-y-2">
        {rows.map((a) => {
          const state = windowState(a);
          return (
            <Card key={a.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.title}</span>
                  <Pill tone={state.tone}>{a.archivedAt ? 'Archived' : state.label}</Pill>
                  <span className="text-xs text-slate-400">
                    {a.locationId ? a.locationName ?? 'One location' : 'All locations'}
                  </span>
                </div>
                {a.body && <div className="truncate text-sm text-slate-500">{a.body}</div>}
                <div className="text-xs text-slate-400">
                  {a.startsAt ? `from ${fmtDateTime(a.startsAt)}` : 'from now'}
                  {' · '}
                  {a.endsAt ? `until ${fmtDateTime(a.endsAt)}` : 'until archived'}
                </div>
              </div>
              {!a.archivedAt && (
                <Button variant="ghost" onClick={() => setEditing(a)}>
                  Edit
                </Button>
              )}
              <Button
                variant={a.archivedAt ? 'ghost' : 'danger'}
                onClick={async () => {
                  await api.archiveAnnouncement(a.id, !a.archivedAt);
                  reload();
                }}
              >
                {a.archivedAt ? 'Unarchive' : 'Archive'}
              </Button>
            </Card>
          );
        })}
        {rows.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-400">
            {showArchived ? 'No archived announcements.' : 'No announcements yet.'}
          </p>
        )}
      </div>
    </div>
  );
}
