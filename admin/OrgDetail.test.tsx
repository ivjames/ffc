import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import OrgDetail from './OrgDetail';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    getOrg: vi.fn(),
    archiveOrg: vi.fn(),
  },
}));

const DETAIL = {
  org: { id: 'org-1', name: 'Test Org', slug: 'test-org', status: 'active', sortOrder: 0, archivedAt: null },
  locations: [],
};

beforeEach(() => {
  vi.mocked(api.getOrg).mockReset().mockResolvedValue(DETAIL);
  vi.mocked(api.archiveOrg).mockReset();
});

function renderOrgDetail(isSuperAdmin: boolean) {
  return render(
    <MemoryRouter initialEntries={['/orgs/org-1']}>
      <Routes>
        <Route path="/orgs/:id" element={<OrgDetail isSuperAdmin={isSuperAdmin} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OrgDetail — super_admin', () => {
  test('shows the Archive button, alongside + Location', async () => {
    renderOrgDetail(true);
    expect(await screen.findByRole('heading', { name: 'Test Org' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Location' })).toBeInTheDocument();
  });

  test('clicking Archive calls api.archiveOrg(id, true)', async () => {
    const user = userEvent.setup();
    renderOrgDetail(true);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.archiveOrg).toHaveBeenCalledWith('org-1', true));
  });

  test('an archived org shows Unarchive instead', async () => {
    vi.mocked(api.getOrg).mockResolvedValue({
      org: { ...DETAIL.org, archivedAt: '2026-01-01T00:00:00Z' },
      locations: [],
    });
    renderOrgDetail(true);
    expect(await screen.findByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
  });
});

describe('OrgDetail — org_admin', () => {
  test('hides the Archive button entirely, keeps + Location', async () => {
    renderOrgDetail(false);
    expect(await screen.findByRole('heading', { name: 'Test Org' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unarchive' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Location' })).toBeInTheDocument();
  });
});
