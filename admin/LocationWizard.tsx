import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Location } from './api';
import { Button, Card, Field, Input, Banner, Spinner, useAsync } from './ui';

const autoSlug = (v: string) =>
  v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export default function LocationWizard({
  isSuperAdmin,
  ownOrgId,
}: {
  isSuperAdmin: boolean;
  ownOrgId: string | null;
}) {
  const [params] = useSearchParams();
  const orgs = useAsync(() => api.listOrgs(), []);

  // An org_admin's org is fixed to their own, regardless of any ?orgId= in
  // the URL — the server would silently force this anyway (it never trusts a
  // submitted orgId from an org_admin), so the field mirrors that truth
  // instead of showing a picker that doesn't actually do what it implies.
  const [orgId, setOrgId] = useState(isSuperAdmin ? params.get('orgId') ?? '' : ownOrgId ?? '');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [geofence, setGeofence] = useState('2');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Location | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaved(null);
    // Coordinates are optional, but if one is filled both must be.
    const hasLat = lat.trim() !== '';
    const hasLng = lng.trim() !== '';
    if (hasLat !== hasLng) {
      setErr('Latitude and longitude must be provided together.');
      return;
    }
    setBusy(true);
    try {
      const body: Partial<Location> = {
        name: name.trim(),
        slug: slug || autoSlug(name),
        orgId: orgId || null,
        geofenceKm: geofence.trim() ? Number(geofence) : null,
      };
      if (hasLat && hasLng) {
        body.lat = Number(lat);
        body.lng = Number(lng);
      }
      const res = await api.saveLocation(body);
      setSaved(res.location);
      setName('');
      setSlug('');
      setLat('');
      setLng('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-lg font-semibold">Onboard a location</h1>

      {saved && (
        <Banner kind="success">
          Saved <strong>{saved.name}</strong>.{' '}
          {saved.tzLabel ? (
            <>
              Timezone derived: <strong>{saved.tzLabel}</strong>.
            </>
          ) : (
            <>No coordinates given, so no timezone was derived.</>
          )}{' '}
          <Link className="underline" to={`/locations/${saved.id}`}>
            Add courses →
          </Link>
        </Banner>
      )}

      <Card>
        <form onSubmit={submit} className="space-y-3">
          {err && <Banner kind="error">{err}</Banner>}

          <Field label="Org (owner / franchise)">
            {!isSuperAdmin ? (
              <div className="px-1 py-1.5 text-sm text-slate-600">
                {orgs.data?.find((o) => o.id === ownOrgId)?.name ?? 'Your org'}
              </div>
            ) : orgs.loading ? (
              <Spinner label="Loading orgs…" />
            ) : (
              <select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="">— unassigned —</option>
                {orgs.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Riverside" />
          </Field>
          <Field label="Slug" hint="Auto-filled from the name if left blank.">
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={autoSlug(name) || 'riverside'} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" hint="WGS84, −90..90">
              <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="34.08867" inputMode="decimal" />
            </Field>
            <Field label="Longitude" hint="−180..180">
              <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-117.67946" inputMode="decimal" />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            The venue timezone is derived from the coordinates automatically (never typed) and shown after saving.
          </p>

          <Field label="Geofence (km)" hint='"You are here" radius; blank uses the app default.'>
            <Input value={geofence} onChange={(e) => setGeofence(e.target.value)} inputMode="decimal" />
          </Field>

          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Create location'}
          </Button>
        </form>
      </Card>

      <p className="text-xs text-slate-500">
        Note: a location goes live to players on the next site rebuild (content is exported from the DB at build time).
      </p>
    </div>
  );
}
