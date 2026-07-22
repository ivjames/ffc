import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Orgs from './Orgs';
import { api, type Org } from './api';

vi.mock('./api', () => ({
  api: {
    listOrgs: vi.fn(),
    saveOrg: vi.fn(),
  },
}));

const ORGS: Org[] = [
  { id: 'org-1', name: 'Test Org', slug: 'test-org', status: 'active', sortOrder: 0, archivedAt: null, locationCount: 2 },
];

beforeEach(() => {
  vi.mocked(api.listOrgs).mockReset().mockResolvedValue(ORGS);
  vi.mocked(api.saveOrg).mockReset();
});

function renderOrgs(isSuperAdmin: boolean) {
  return render(
    <MemoryRouter>
      <Orgs isSuperAdmin={isSuperAdmin} />
    </MemoryRouter>
  );
}

describe('Orgs — super_admin', () => {
  test('shows the "Create org" form', async () => {
    renderOrgs(true);
    expect(await screen.findByText('Test Org')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New org (owner / franchise)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create org' })).toBeInTheDocument();
  });

  test('submitting the form calls api.saveOrg with the entered name/slug', async () => {
    vi.mocked(api.saveOrg).mockResolvedValue({
      ok: true,
      org: { id: 'org-2', name: 'New Org', slug: 'new-org', status: 'active', sortOrder: 0, archivedAt: null },
    });
    const user = userEvent.setup();
    renderOrgs(true);
    await screen.findByText('Test Org');

    await user.type(screen.getByPlaceholderText("Bullwinkle's"), 'New Org');
    await user.click(screen.getByRole('button', { name: 'Create org' }));

    await waitFor(() =>
      expect(api.saveOrg).toHaveBeenCalledWith({ name: 'New Org', slug: 'new-org' })
    );
  });
});

describe('Orgs — org_admin', () => {
  test('hides the "Create org" form and shows a restriction note instead', async () => {
    renderOrgs(false);
    expect(await screen.findByText('Test Org')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'New org (owner / franchise)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create org' })).not.toBeInTheDocument();
    expect(screen.getByText('Only a super admin can create or rename orgs.')).toBeInTheDocument();
  });

  test('empty state message differs from the super_admin one (no "create one on the right")', async () => {
    vi.mocked(api.listOrgs).mockResolvedValue([]);
    renderOrgs(false);
    expect(await screen.findByText('No org yet.')).toBeInTheDocument();
  });
});
