import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Archived from './Archived';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    listOrgs: vi.fn(),
    listLocations: vi.fn(),
    archiveOrg: vi.fn(),
    archiveLocation: vi.fn(),
  },
}));

const ARCHIVED_ORG = {
  id: 'org-1',
  name: 'Archived Org',
  slug: 'archived-org',
  status: 'active',
  sortOrder: 0,
  archivedAt: '2026-01-01T00:00:00Z',
};
const ARCHIVED_LOCATION = {
  id: 'loc-1',
  name: 'Archived Location',
  slug: 'archived-location',
  lat: null,
  lng: null,
  geofenceKm: null,
  tz: null,
  tzLabel: null,
  sortOrder: 0,
  orgId: 'org-1',
  archivedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.mocked(api.listOrgs).mockReset().mockResolvedValue([ARCHIVED_ORG]);
  vi.mocked(api.listLocations).mockReset().mockResolvedValue([ARCHIVED_LOCATION]);
  vi.mocked(api.archiveOrg).mockReset();
  vi.mocked(api.archiveLocation).mockReset();
});

describe('Archived — super_admin', () => {
  test('shows Unarchive for both the archived org and the archived location', async () => {
    render(<Archived isSuperAdmin={true} />);
    await screen.findByText('Archived Org');
    const buttons = screen.getAllByRole('button', { name: 'Unarchive' });
    expect(buttons).toHaveLength(2);
  });

  test('clicking the org Unarchive calls api.archiveOrg(id, false)', async () => {
    const user = userEvent.setup();
    render(<Archived isSuperAdmin={true} />);
    await screen.findByText('Archived Org');
    await user.click(screen.getAllByRole('button', { name: 'Unarchive' })[0]);
    await waitFor(() => expect(api.archiveOrg).toHaveBeenCalledWith('org-1', false));
  });
});

describe('Archived — org_admin', () => {
  test('hides the org Unarchive button but keeps the location one', async () => {
    render(<Archived isSuperAdmin={false} />);
    await screen.findByText('Archived Org');
    await screen.findByText('Archived Location');
    const buttons = screen.getAllByRole('button', { name: 'Unarchive' });
    expect(buttons).toHaveLength(1); // only the location's
  });

  test('clicking the remaining Unarchive still calls api.archiveLocation, not api.archiveOrg', async () => {
    const user = userEvent.setup();
    render(<Archived isSuperAdmin={false} />);
    await screen.findByText('Archived Location');
    await user.click(screen.getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => expect(api.archiveLocation).toHaveBeenCalledWith('loc-1', false));
    expect(api.archiveOrg).not.toHaveBeenCalled();
  });
});
