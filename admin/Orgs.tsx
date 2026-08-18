// The tenant list. An org is a customer, so each row answers the questions an
// operator actually has: what does their app look like, what address does it
// serve on, is it live, and is the onboarding finished? The old row showed
// name + "/slug" + a count — and "/slug" reads like a URL path when it is in
// fact the org's subdomain label (MULTI-VENUE.md §1).
//
// Creating is one path only: Provision site (org + branding + first venue +
// courses + the org admin's invite, in one transaction). The bare name+slug
// form that used to live here made step 1 of a 6-step checklist and left a
// tenant with no branding, no venue and nobody able to sign in — an org that
// resolves to an empty catalog and looks broken to whoever opens it.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Org } from './api';
import { Banner, Button, Card, EmptyState, PageHeader, Pill, Spinner, useAsync } from './ui';
import { orgPlayerHost, orgPlayerUrl } from './platform';

/** The org's mark as the player app shows it, or its initial on the org's own
 *  theme color. A tenant is recognisable by its look long before its name is
 *  read, and this is also the fastest honest answer to "is branding set up?". */
function OrgAvatar({ org }: { org: Org }) {
  // A stored mark can be a path that only resolves on the PLAYER origin (or a
  // dead URL); rather than parade a broken-image glyph down the list, fall
  // back to the initial — same treatment the branding form's preview uses.
  const [broken, setBroken] = useState(false);
  const b = org.branding ?? {};
  const mark = b.logoBadgeUrl ?? b.logoUrl;
  if (mark && !broken) {
    return (
      <img
        src={mark}
        alt=""
        onError={() => setBroken(true)}
        className="h-10 w-10 shrink-0 rounded-md bg-white object-contain ring-1 ring-slate-200"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white ring-1 ring-black/10"
      style={{ backgroundColor: b.themeColor ?? '#64748b' }}
    >
      {org.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** What is still missing before this tenant is finished. Only rendered when
 *  something IS missing — a complete org stays quiet. adminCount is undefined
 *  on any response that predates it; treat unknown as "don't claim". */
function SetupGaps({ org }: { org: Org }) {
  const gaps: string[] = [];
  if (Object.keys(org.branding ?? {}).length === 0) gaps.push('no branding');
  if ((org.locationCount ?? 0) === 0) gaps.push('no venue');
  if (org.adminCount === 0) gaps.push('no admin account');
  if (gaps.length === 0) return null;
  return <Pill tone="amber">Setup: {gaps.join(', ')}</Pill>;
}

function OrgRow({ org }: { org: Org }) {
  const url = orgPlayerUrl(org.slug);
  return (
    <Card className="flex items-center gap-3">
      <OrgAvatar org={org} />
      <div className="min-w-0 flex-1">
        <Link to={`/orgs/${org.id}`} className="font-medium text-slate-900 hover:underline">
          {org.name}
        </Link>
        <div className="truncate text-xs text-slate-500">
          {url ? (
            // The address is a real link: opening a tenant's app is the single
            // most common thing an operator does from this list.
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="hover:text-sky-700 hover:underline"
            >
              {orgPlayerHost(org.slug)} ↗
            </a>
          ) : (
            orgPlayerHost(org.slug)
          )}
        </div>
      </div>
      <SetupGaps org={org} />
      {org.status === 'suspended' && <Pill tone="red">Suspended</Pill>}
      <Pill>
        {org.locationCount ?? 0} {org.locationCount === 1 ? 'venue' : 'venues'}
      </Pill>
    </Card>
  );
}

export default function Orgs({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { data, error, loading } = useAsync(() => api.listOrgs(), []);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Orgs"
        description="Owners and franchises — one org per customer. Each org owns its venues, its branding and its subdomain; org admins only ever see their own."
        actions={
          isSuperAdmin && (
            <Link to="/provision">
              <Button>+ New site</Button>
            </Link>
          )
        }
      />
      <div className="space-y-3">
        {loading && <Spinner />}
        {error && <Banner kind="error">{error.message}</Banner>}
        {data && data.length === 0 && (
          <EmptyState>
            {isSuperAdmin ? 'No orgs yet — "+ New site" stands one up.' : 'No org yet.'}
          </EmptyState>
        )}
        {data?.map((o) => (
          <OrgRow key={o.id} org={o} />
        ))}
      </div>
      {isSuperAdmin && (
        <p className="text-xs text-slate-500">
          "+ New site" runs the provisioning wizard: org, branding, first venue, courses and the
          org admin's invite in one transaction, live on its subdomain immediately.
        </p>
      )}
    </div>
  );
}
