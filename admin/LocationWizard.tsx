// Add a venue to an org. Reached from the org's Venues tab (which passes
// ?orgId=), never from the top-level nav any more: a location's whole identity
// is "a park belonging to a tenant", and the wizard's old "— unassigned —"
// default minted venues with org_id null — rows no subdomain resolves to, that
// no org page lists, and that no org admin can see or fix. An org is required
// here now, matching what the record actually means.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Location } from './api';
import { BackLink, Button, Card, Field, Input, Banner, PageHeader, Select, Spinner, useAsync } from './ui';

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
    // An org-less venue belongs to no tenant: no subdomain serves it and no
    // org page lists it, so it is invisible the moment it is created.
    if (!orgId) {
      setErr('Pick the org this venue belongs to.');
      return;
    }
    setBusy(true);
    try {
      const body: Partial<Location> = {
        name: name.trim(),
        slug: slug || autoSlug(name),
        orgId,
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

  const orgName = orgs.data?.find((o) => o.id === orgId)?.name ?? null;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <BackLink to={orgId ? `/orgs/${orgId}/venues` : '/orgs'}>
        {orgName ? `${orgName} venues` : 'Orgs'}
      </BackLink>
      <PageHeader
        title="Add a venue"
        description="Creates the venue record under its org; add courses from its detail page afterwards."
      />

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
          </Link>{' '}
          <Link className="underline" to={`/orgs/${orgId}/venues`}>
            Back to the org →
          </Link>
        </Banner>
      )}

      <Card>
        <form onSubmit={submit} className="space-y-3">
          {err && <Banner kind="error">{err}</Banner>}

          <Field
            label="Org (owner / franchise)"
            hint="Required — the venue is served on this org's subdomain and is only visible to its admins."
          >
            {!isSuperAdmin ? (
              <div className="px-1 py-1.5 text-sm text-slate-600">
                {orgs.data?.find((o) => o.id === ownOrgId)?.name ?? 'Your org'}
              </div>
            ) : orgs.loading ? (
              <Spinner label="Loading orgs…" />
            ) : (
              <Select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="w-full">
                <option value="">— pick an org —</option>
                {orgs.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
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

          <Button type="submit" disabled={busy || !name.trim() || !orgId}>
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
