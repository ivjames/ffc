import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LocationWizard from './LocationWizard';
import { api, type Org, type Location } from './api';

vi.mock('./api', () => ({
  api: {
    listOrgs: vi.fn(),
    saveLocation: vi.fn(),
  },
}));

const ORGS: Org[] = [
  { id: 'org-1', name: 'My Org', slug: 'my-org', status: 'active', sortOrder: 0, archivedAt: null, locationCount: 0 },
  { id: 'org-2', name: 'Other Org', slug: 'other-org', status: 'active', sortOrder: 0, archivedAt: null, locationCount: 0 },
];

const SAVED_LOCATION: Location = {
  id: 'loc-1',
  name: 'X',
  slug: 'x',
  lat: null,
  lng: null,
  geofenceKm: null,
  tz: null,
  tzLabel: null,
  menuUrl: null,
  orderingUrl: null,
  pos: null,
  modules: null,
  hours: null,
  hunt: {},
  sortOrder: 0,
  orgId: null,
  archivedAt: null,
};

beforeEach(() => {
  vi.mocked(api.listOrgs).mockReset().mockResolvedValue(ORGS);
  vi.mocked(api.saveLocation).mockReset();
});

function renderWizard(isSuperAdmin: boolean, ownOrgId: string | null) {
  return render(
    <MemoryRouter>
      <LocationWizard isSuperAdmin={isSuperAdmin} ownOrgId={ownOrgId} />
    </MemoryRouter>
  );
}

describe('LocationWizard — super_admin', () => {
  test('shows a full org picker listing every org, with no way to opt out', async () => {
    renderWizard(true, null);
    const select = await screen.findByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'My Org' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Other Org' })).toBeInTheDocument();
    // An org-less venue belongs to no tenant: no subdomain serves it, no org
    // page lists it, and no org admin can see it. The placeholder prompts for
    // a choice instead of offering that as one.
    expect(screen.queryByRole('option', { name: '— unassigned —' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '— pick an org —' })).toBeInTheDocument();
  });

  test('cannot submit until an org is picked', async () => {
    const user = userEvent.setup();
    renderWizard(true, null);
    await screen.findByRole('combobox');
    await user.type(screen.getByPlaceholderText('Riverside'), 'New Venue');
    const submit = screen.getByRole('button', { name: 'Create location' });
    expect(submit).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox'), 'org-2');
    expect(submit).toBeEnabled();
  });

  test('submitting sends whatever org was picked', async () => {
    vi.mocked(api.saveLocation).mockResolvedValue({ ok: true, location: SAVED_LOCATION });
    const user = userEvent.setup();
    renderWizard(true, null);
    const select = await screen.findByRole('combobox');
    await user.selectOptions(select, 'org-2');
    await user.type(screen.getByPlaceholderText('Riverside'), 'New Venue');
    await user.click(screen.getByRole('button', { name: 'Create location' }));
    await waitFor(() =>
      expect(api.saveLocation).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-2' }))
    );
  });
});

describe('LocationWizard — org_admin', () => {
  test('shows fixed text with their own org name, not a picker', async () => {
    renderWizard(false, 'org-1');
    expect(await screen.findByText('My Org')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  test('ignores any ?orgId= in the URL — submits their own org regardless', async () => {
    vi.mocked(api.saveLocation).mockResolvedValue({ ok: true, location: SAVED_LOCATION });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/locations/new?orgId=org-2']}>
        <LocationWizard isSuperAdmin={false} ownOrgId="org-1" />
      </MemoryRouter>
    );
    await screen.findByText('My Org');
    await user.type(screen.getByPlaceholderText('Riverside'), 'New Venue');
    await user.click(screen.getByRole('button', { name: 'Create location' }));
    await waitFor(() =>
      expect(api.saveLocation).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }))
    );
  });
});
