import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type Course, type Location } from './api';
import { Button, Card, Field, Input, Banner, Spinner, Pill, useAsync, fmtDateTime } from './ui';

function ParsGrid({ pars, onChange }: { pars: number[]; onChange: (p: number[]) => void }) {
  return (
    <div className="grid grid-cols-9 gap-1">
      {pars.map((p, i) => (
        <div key={i} className="text-center">
          <div className="text-[10px] text-slate-400">{i + 1}</div>
          <input
            value={p}
            onChange={(e) => {
              const next = pars.slice();
              next[i] = Number(e.target.value) || 0;
              onChange(next);
            }}
            inputMode="numeric"
            className="w-full rounded border border-slate-300 py-1 text-center text-sm"
          />
        </div>
      ))}
    </div>
  );
}

function CourseCard({ course, onChanged }: { course: Course; onChanged: () => void }) {
  const [name, setName] = useState(course.name);
  const [theme, setTheme] = useState(course.theme);
  const [pars, setPars] = useState<number[]>(course.pars);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = pars.reduce((a, b) => a + b, 0);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.patchCourse(course.id, { name: name.trim(), theme: theme.trim(), pars });
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    await api.archiveCourse(course.id, true);
    onChanged();
  }

  return (
    <Card>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <Field label="Course name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Theme">
          <Input value={theme} onChange={(e) => setTheme(e.target.value)} />
        </Field>
      </div>
      <div className="mb-2">
        <div className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700">
          <span>Pars</span>
          <span className="text-xs text-slate-500">total {total}</span>
        </div>
        <ParsGrid pars={pars} onChange={setPars} />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save course'}
        </Button>
        <Button variant="danger" onClick={archive}>
          Archive
        </Button>
      </div>
    </Card>
  );
}

function AddCourse({ locationId, onAdded }: { locationId: string; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [theme, setTheme] = useState('blue');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.saveCourse({
        locationId,
        name: name.trim(),
        theme: theme.trim(),
        pars: Array(18).fill(3),
      });
      setName('');
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Add a course</h3>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        {err && <Banner kind="error">{err}</Banner>}
        <div className="flex-1">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Blue Course" />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Theme">
            <Input value={theme} onChange={(e) => setTheme(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" disabled={busy || !name.trim()}>
          Add (pars default 3)
        </Button>
      </form>
    </Card>
  );
}

function LocationForm({ location, onSaved }: { location: Location; onSaved: () => void }) {
  const [name, setName] = useState(location.name);
  const [slug, setSlug] = useState(location.slug);
  const [lat, setLat] = useState(location.lat?.toString() ?? '');
  const [lng, setLng] = useState(location.lng?.toString() ?? '');
  const [geofence, setGeofence] = useState(location.geofenceKm?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const hasLat = lat.trim() !== '';
    const hasLng = lng.trim() !== '';
    if (hasLat !== hasLng) {
      setErr('Latitude and longitude must be provided together.');
      return;
    }
    setBusy(true);
    try {
      await api.saveLocation({
        id: location.id,
        name: name.trim(),
        slug: slug.trim(),
        orgId: location.orgId,
        lat: hasLat ? Number(lat) : null,
        lng: hasLng ? Number(lng) : null,
        geofenceKm: geofence.trim() ? Number(geofence) : null,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Slug">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="Latitude">
          <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Longitude">
          <Input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Geofence (km)">
          <Input value={geofence} onChange={(e) => setGeofence(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Timezone (derived)">
          <div className="px-1 py-1.5 text-sm text-slate-600">{location.tzLabel ?? '—'}</div>
        </Field>
      </div>
      <div className="mt-2">
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save location'}
        </Button>
      </div>
    </Card>
  );
}

export default function LocationDetail() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useAsync(async () => {
    const [detail, allCourses] = await Promise.all([
      api.getLocation(id),
      api.listLocationCourses(id, true),
    ]);
    return {
      location: detail.location,
      courses: detail.courses,
      archivedCourses: allCourses.filter((c) => c.archivedAt),
    };
  }, [id]);

  if (loading) return <Spinner />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data) return null;
  const { location, courses, archivedCourses } = data;

  async function toggleArchive() {
    await api.archiveLocation(id, !location.archivedAt);
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{location.name}</h1>
        <span className="text-xs text-slate-400">/{location.slug}</span>
        {location.archivedAt && <Pill tone="amber">Archived</Pill>}
        <div className="ml-auto">
          <Button variant={location.archivedAt ? 'ghost' : 'danger'} onClick={toggleArchive}>
            {location.archivedAt ? 'Unarchive location' : 'Archive location'}
          </Button>
        </div>
      </div>

      <LocationForm location={location} onSaved={reload} />

      <h2 className="pt-2 text-sm font-semibold text-slate-700">Courses ({courses.length})</h2>
      <div className="space-y-3">
        {courses.map((c) => (
          <CourseCard key={c.id} course={c} onChanged={reload} />
        ))}
      </div>

      <AddCourse locationId={location.id} onAdded={reload} />

      {archivedCourses.length > 0 && (
        <div className="space-y-2">
          <h2 className="pt-2 text-sm font-semibold text-slate-700">
            Archived courses ({archivedCourses.length})
          </h2>
          {archivedCourses.map((c) => (
            <Card key={c.id} className="flex items-center gap-3">
              <span className="flex-1 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-slate-400">{c.theme}</span>
                {c.archivedAt && (
                  <span className="ml-2 text-xs text-slate-400">archived {fmtDateTime(c.archivedAt)}</span>
                )}
              </span>
              <Button
                variant="ghost"
                onClick={async () => {
                  await api.archiveCourse(c.id, false);
                  reload();
                }}
              >
                Unarchive
              </Button>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Course data (names, pars, themes) drives the leaderboard and hunt immediately in the DB, and reaches players on
        the next site rebuild. Per-course map art &amp; themed rules ship in the app bundle.
      </p>
    </div>
  );
}
