import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Orgs from './Orgs';
import { api, type Org } from './api';

vi.mock('./api', () => ({
  api: {
    listOrgs: vi.fn(),
  },
}));

const ORGS: Org[] = [
  {
    id: 'org-1',
    name: 'Test Org',
    slug: 'test-org',
    status: 'active',
    sortOrder: 0,
    archivedAt: null,
    locationCount: 2,
    adminCount: 1,
    branding: { themeColor: '#112233' },
  },
];

beforeEach(() => {
  vi.mocked(api.listOrgs).mockReset().mockResolvedValue(ORGS);
});

function renderOrgs(isSuperAdmin: boolean) {
  return render(
    <MemoryRouter>
      <Orgs isSuperAdmin={isSuperAdmin} />
    </MemoryRouter>
  );
}

describe('Orgs — creating', () => {
  // The bare name+slug form is gone: it made step 1 of a 6-step checklist and
  // left a tenant nobody could sign in to, on an empty catalog.
  test('super_admin gets one create path, and it is the provisioning wizard', async () => {
    renderOrgs(true);
    await screen.findByText('Test Org');
    const create = screen.getByRole('link', { name: '+ New site' });
    expect(create).toHaveAttribute('href', '/provision');
    expect(screen.queryByRole('button', { name: 'Create org' })).not.toBeInTheDocument();
  });

  test('org_admin gets no create control at all', async () => {
    renderOrgs(false);
    await screen.findByText('Test Org');
    expect(screen.queryByRole('link', { name: '+ New site' })).not.toBeInTheDocument();
  });

  test('the empty state points at the same one path', async () => {
    vi.mocked(api.listOrgs).mockResolvedValue([]);
    renderOrgs(true);
    expect(await screen.findByText(/No orgs yet/)).toBeInTheDocument();
  });
});

describe('Orgs — what a row says', () => {
  test("shows the org's subdomain, not a slash-prefixed pseudo-path", async () => {
    renderOrgs(true);
    await screen.findByText('Test Org');
    // jsdom has no admin.<domain> hostname, so the domain isn't derivable and
    // the row says so rather than inventing one.
    expect(screen.getByText(/test-org\.<platform domain>/)).toBeInTheDocument();
    expect(screen.queryByText('/test-org')).not.toBeInTheDocument();
  });

  test('venue count is pluralised off the real count', async () => {
    vi.mocked(api.listOrgs).mockResolvedValue([
      { ...ORGS[0], locationCount: 1 },
      { ...ORGS[0], id: 'org-2', name: 'Two', slug: 'two', locationCount: 2 },
    ]);
    renderOrgs(true);
    expect(await screen.findByText('1 venue')).toBeInTheDocument();
    expect(screen.getByText('2 venues')).toBeInTheDocument();
  });

  test('a suspended org shows the Suspended pill; active orgs do not', async () => {
    vi.mocked(api.listOrgs).mockResolvedValue([
      ...ORGS,
      {
        id: 'org-2',
        name: 'Dark Org',
        slug: 'dark-org',
        status: 'suspended',
        sortOrder: 1,
        archivedAt: null,
        locationCount: 1,
        adminCount: 1,
        branding: {},
      },
    ]);
    renderOrgs(true);
    await screen.findByText('Dark Org');
    expect(screen.getAllByText('Suspended')).toHaveLength(1);
  });
});

// Half-finished onboarding is the failure mode this list exists to catch: an
// org with no branding/venue/admin serves an empty stock-looking site that
// nobody can administer, and nothing used to say so.
describe('Orgs — setup gaps', () => {
  test('a fully set-up org stays quiet', async () => {
    renderOrgs(true);
    await screen.findByText('Test Org');
    expect(screen.queryByText(/^Setup:/)).not.toBeInTheDocument();
  });

  test('names every missing piece', async () => {
    vi.mocked(api.listOrgs).mockResolvedValue([
      { ...ORGS[0], branding: {}, locationCount: 0, adminCount: 0 },
    ]);
    renderOrgs(true);
    expect(
      await screen.findByText('Setup: no branding, no venue, no admin account')
    ).toBeInTheDocument();
  });

  test('an unknown admin count (older response) is never reported as zero', async () => {
    vi.mocked(api.listOrgs).mockResolvedValue([
      { ...ORGS[0], branding: {}, locationCount: 1, adminCount: undefined },
    ]);
    renderOrgs(true);
    expect(await screen.findByText('Setup: no branding')).toBeInTheDocument();
  });
});
