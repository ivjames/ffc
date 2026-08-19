// One org — the tenant page. An org IS the customer: its slug is their
// subdomain, its branding is their app, its venues are their parks, and its
// admin accounts are their logins. All four used to be either invisible here
// (the address, the accounts) or buried under a 350-line branding form, so
// this page is tabbed: identity and lifecycle stay in the header, and each
// concern gets a deep-linkable route of its own (/orgs/:id/venues, /branding,
// /team) instead of competing for the same scroll.
import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, type AdminUser, type Location, type Org } from './api';
import {
  BackLink,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Banner,
  PageHeader,
  Pill,
  Spinner,
  TabNav,
  fmtDateTime,
  useAsync,
  useToast,
} from './ui';
import BrandingCard from './OrgBranding';
import OrgTeam from './OrgTeam';
import { orgPlayerHost, orgPlayerUrl } from './platform';

const autoSlug = (v: string) =>
  v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** One labelled fact in the identity card. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{children}</dd>
    </div>
  );
}

/** A setup-checklist line: done, or what to do about it. */
function CheckRow({ done, label, children }: { done: boolean; label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 border-t border-slate-100 py-2 first:border-0">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          done ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}
      >
        {done ? '✓' : '!'}
      </span>
      <span className="min-w-0 text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className="ml-1.5 text-slate-500">{children}</span>
      </span>
    </li>
  );
}

/** Rename / re-slug / reorder. super_admin only, matching the server's gate on
 *  POST /orgs. The slug edit is deliberately grim about consequences: it is
 *  the org's subdomain, so changing it moves the player app to a new address
 *  and every QR code, bookmark and installed PWA pointing at the old one
 *  stops resolving to this tenant. */
function IdentityForm({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);
  const [sortOrder, setSortOrder] = useState(String(org.sortOrder));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const slugChanged = slug.trim() !== org.slug;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (
      slugChanged &&
      !window.confirm(
        `Move ${org.name} from ${orgPlayerHost(org.slug)} to ${orgPlayerHost(
          slug.trim()
        )}? Existing QR codes, bookmarks and installed apps pointing at the old address will stop reaching this org.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      // Branding is deliberately omitted: the upsert preserves the stored
      // object when the field is absent, so a rename can never clobber the
      // Branding tab's work.
      await api.saveOrg({
        id: org.id,
        name: name.trim(),
        slug: slug.trim(),
        sortOrder: Number(sortOrder) || 0,
      });
      toast('Org saved.');
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Rename / re-address</h2>
      <form onSubmit={save} className="space-y-3">
        {err && <Banner kind="error">{err}</Banner>}
        <Field label="Name" hint="Shown in Master Control. Safe to change at any time.">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Slug (subdomain)"
          hint="Lowercase, hyphenated. This is the org's address — treat it as permanent."
        >
          <Input value={slug} onChange={(e) => setSlug(autoSlug(e.target.value))} />
        </Field>
        {slugChanged && (
          <Banner kind="error">
            Changing the slug moves the player app to <strong>{orgPlayerHost(slug.trim())}</strong>.
            Anything pointing at {orgPlayerHost(org.slug)} — printed QR codes, bookmarks, installed
            home-screen apps — stops reaching this org.
          </Banner>
        )}
        <Field label="Sort order" hint="Lower sorts first in the Orgs list.">
          {/* Width on a wrapper around the Input, not on the Input (which
              hard-codes w-full) and not on the Field (which would squeeze the
              hint into a column two words wide). */}
          <div className="w-24">
            <Input
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              inputMode="numeric"
            />
          </div>
        </Field>
        <Button type="submit" disabled={busy || !name.trim() || !slug.trim()}>
          {busy ? 'Saving…' : 'Save org'}
        </Button>
      </form>
    </Card>
  );
}

function OverviewTab({
  org,
  locations,
  isSuperAdmin,
  users,
  usersLoading,
  onSaved,
}: {
  org: Org;
  locations: Location[];
  isSuperAdmin: boolean;
  users: AdminUser[] | null;
  usersLoading: boolean;
  onSaved: () => void;
}) {
  const url = orgPlayerUrl(org.slug);
  const branded = Object.keys(org.branding ?? {}).length;
  // Only super_admins can read /users at all, so the account check silently
  // drops off an org_admin's checklist rather than claiming an unknown.
  const admins = users?.filter((u) => u.orgId === org.id).length ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Site</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Address">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-sky-700 underline hover:text-sky-900"
              >
                {orgPlayerHost(org.slug)} ↗
              </a>
            ) : (
              <span className="text-slate-500">{orgPlayerHost(org.slug)}</span>
            )}
          </Fact>
          <Fact label="Status">
            {org.status === 'suspended' ? (
              <span className="text-red-700">Suspended — subdomain dark</span>
            ) : org.archivedAt ? (
              <span className="text-amber-700">Archived</span>
            ) : (
              <span className="text-green-700">Active</span>
            )}
          </Fact>
          <Fact label="Venues">{locations.length}</Fact>
          <Fact label="Created">{org.createdAt ? fmtDateTime(org.createdAt) : '—'}</Fact>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Setup</h2>
        <p className="mb-2 text-xs text-slate-500">
          What a finished tenant needs (MULTI-VENUE.md §8). Nothing here blocks the site from
          serving — an unfinished org just serves stock branding.
        </p>
        <ul>
          <CheckRow done={branded > 0} label="Branding">
            {branded > 0 ? (
              <>
                {branded} override{branded === 1 ? '' : 's'} set —{' '}
                <Link to="branding" className="underline">
                  edit
                </Link>
              </>
            ) : (
              <>
                still on the platform default look —{' '}
                <Link to="branding" className="underline">
                  set it up
                </Link>
              </>
            )}
          </CheckRow>
          <CheckRow done={locations.length > 0} label="Venues">
            {locations.length > 0 ? (
              <>
                {locations.length} live —{' '}
                <Link to="venues" className="underline">
                  manage
                </Link>
              </>
            ) : (
              <>
                none yet, so players see an empty catalog —{' '}
                <Link to="venues" className="underline">
                  add the first
                </Link>
              </>
            )}
          </CheckRow>
          {isSuperAdmin && !usersLoading && (
            <CheckRow done={admins > 0} label="Admin access">
              {admins > 0 ? (
                <>
                  {admins} account{admins === 1 ? '' : 's'} —{' '}
                  <Link to="team" className="underline">
                    manage
                  </Link>
                </>
              ) : (
                <>
                  nobody at this org can sign in —{' '}
                  <Link to="team" className="underline">
                    invite an admin
                  </Link>
                </>
              )}
            </CheckRow>
          )}
        </ul>
      </Card>

      {isSuperAdmin && <IdentityForm org={org} onSaved={onSaved} />}
    </div>
  );
}

function VenuesTab({ org, locations }: { org: Org; locations: Location[] }) {
  const nav = useNavigate();
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        {/* The tab label already carries the count. */}
        <h2 className="flex-1 text-sm font-semibold text-slate-700">Venues</h2>
        <Link to={`/locations/new?orgId=${org.id}`}>
          <Button>+ Location</Button>
        </Link>
      </div>
      {locations.length === 0 && (
        <EmptyState>
          No venues yet. Until one exists, {orgPlayerHost(org.slug)} serves an empty catalog.
        </EmptyState>
      )}
      <div className="space-y-2">
        {locations.map((l) => (
          <div
            key={l.id}
            className="flex items-center gap-3 border-t border-slate-100 py-2 first:border-0"
          >
            <button
              className="flex-1 text-left font-medium text-slate-900 hover:underline"
              onClick={() => nav(`/locations/${l.id}`)}
            >
              {l.name}
              <span className="ml-2 text-xs text-slate-400">/{l.slug}</span>
            </button>
            {!l.lat && <Pill tone="amber">No coordinates</Pill>}
            {l.tzLabel && <span className="text-xs text-slate-500">{l.tzLabel}</span>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Archived venues are hidden here — they live on the Archived page, with everything else that
        was soft-deleted.
      </p>
    </Card>
  );
}

export default function OrgDetail({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const params = useParams();
  const id = params.id ?? '';
  // The tab lives in the URL (route is /orgs/:id/*), so a tab is linkable and
  // survives a reload. An unknown segment falls back to the overview rather
  // than rendering a blank page.
  const tab = (params['*'] || '').split('/')[0];
  const toast = useToast();
  // Suspend/unsuspend failures (notably the server's refusal to suspend the
  // default org without ?force=1) need reading, so they land in an inline
  // banner — never silently retried with force.
  const [lifecycleErr, setLifecycleErr] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => api.getOrg(id), [id]);
  // Accounts are super_admin-only server-side; asking as an org_admin would
  // 403 on every org page load, so don't ask. Fetched here rather than in the
  // Team tab so the Overview checklist reads the same list.
  const usersReq = useAsync(
    () => (isSuperAdmin ? api.listUsers() : Promise.resolve([])),
    [isSuperAdmin]
  );

  if (loading) return <Spinner />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data) return null;
  const { org, locations } = data;
  const suspended = org.status === 'suspended';
  const url = orgPlayerUrl(org.slug);

  async function toggleArchive() {
    await api.archiveOrg(id, !org.archivedAt);
    toast(org.archivedAt ? 'Org unarchived.' : 'Org archived.');
    reload();
  }

  async function toggleSuspend() {
    setLifecycleErr(null);
    if (
      !suspended &&
      !window.confirm(
        `Suspend ${org.name}? Its subdomain goes dark for players immediately (all data is kept).`
      )
    ) {
      return;
    }
    try {
      await (suspended ? api.unsuspendOrg(id) : api.suspendOrg(id));
      toast(suspended ? 'Org unsuspended.' : 'Org suspended.');
      reload();
    } catch (e) {
      setLifecycleErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <BackLink to="/orgs">Orgs</BackLink>
      <PageHeader
        title={org.name}
        titleExtra={
          <>
            <span className="text-xs text-slate-400">{orgPlayerHost(org.slug)}</span>
            {org.archivedAt && <Pill tone="amber">Archived</Pill>}
            {suspended && <Pill tone="red">Suspended</Pill>}
          </>
        }
        actions={
          <>
            {url && (
              <a href={url} target="_blank" rel="noreferrer">
                <Button variant="ghost">View site ↗</Button>
              </a>
            )}
            {isSuperAdmin && (
              <Button variant={suspended ? 'ghost' : 'danger'} onClick={toggleSuspend}>
                {suspended ? 'Unsuspend' : 'Suspend'}
              </Button>
            )}
            {isSuperAdmin && (
              <Button variant={org.archivedAt ? 'ghost' : 'danger'} onClick={toggleArchive}>
                {org.archivedAt ? 'Unarchive' : 'Archive'}
              </Button>
            )}
          </>
        }
      />

      {lifecycleErr && <Banner kind="error">{lifecycleErr}</Banner>}

      <TabNav
        tabs={[
          { to: `/orgs/${org.id}`, label: 'Overview', end: true },
          { to: `/orgs/${org.id}/venues`, label: `Venues (${locations.length})` },
          { to: `/orgs/${org.id}/branding`, label: 'Branding' },
          ...(isSuperAdmin ? [{ to: `/orgs/${org.id}/team`, label: 'Team' }] : []),
        ]}
      />

      {tab === 'venues' ? (
        <VenuesTab org={org} locations={locations} />
      ) : tab === 'branding' ? (
        /* Branding is cosmetic, so unlike archive it's open to the org's own
           org_admin too (the server enforces scope either way). */
        <BrandingCard org={org} onSaved={reload} />
      ) : tab === 'team' && isSuperAdmin ? (
        <OrgTeam
          org={org}
          users={usersReq.data}
          loading={usersReq.loading}
          error={usersReq.error}
          reload={usersReq.reload}
        />
      ) : (
        <OverviewTab
          org={org}
          locations={locations}
          isSuperAdmin={isSuperAdmin}
          users={usersReq.data}
          usersLoading={usersReq.loading}
          onSaved={reload}
        />
      )}
    </div>
  );
}
