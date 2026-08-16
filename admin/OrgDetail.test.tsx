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
    updateOrgBranding: vi.fn(),
  },
}));

const ORG = {
  id: 'org-1',
  name: 'Test Org',
  slug: 'test-org',
  status: 'active',
  sortOrder: 0,
  archivedAt: null,
  branding: {},
};
const DETAIL = { org: ORG, locations: [] };

beforeEach(() => {
  vi.mocked(api.getOrg).mockReset().mockResolvedValue(DETAIL);
  vi.mocked(api.archiveOrg).mockReset();
  vi.mocked(api.updateOrgBranding)
    .mockReset()
    .mockResolvedValue({ ok: true, org: ORG });
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

describe('OrgDetail — branding', () => {
  test('renders the branding form: stored values prefilled, platform defaults as placeholders', async () => {
    vi.mocked(api.getOrg).mockResolvedValue({
      org: { ...ORG, branding: { appName: 'Putt Palace', themeColor: '#112233' } },
      locations: [],
    });
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    expect(screen.getByRole('heading', { name: 'Branding' })).toBeInTheDocument();
    // Stored overrides prefill their fields (the swatch mirrors the text
    // input's value, so scope the color check to the text input).
    expect(screen.getByDisplayValue('Putt Palace')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('#15803d')).toHaveValue('#112233');
    // …while unset fields sit empty with the §2 defaults as placeholders.
    expect(screen.getByPlaceholderText('MiniGolf')).toHaveValue('');
    expect(screen.getByPlaceholderText('#052e16')).toHaveValue('');
    expect(screen.getByPlaceholderText('#38bdf8')).toHaveValue('');
    expect(screen.getByPlaceholderText('/brand/logo.png')).toHaveValue('');
    expect(screen.getByPlaceholderText('/icons/icon-512.png')).toHaveValue('');
    expect(screen.getByPlaceholderText("Bullwinkle's · come beat this score")).toHaveValue('');
  });

  test('save submits ONLY the non-empty fields as the full replacement object', async () => {
    const user = userEvent.setup();
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.type(screen.getByPlaceholderText('Mini Golf Scorecard'), 'Putt Palace');
    await user.type(screen.getByPlaceholderText('#15803d'), '#123abc');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() =>
      expect(api.updateOrgBranding).toHaveBeenCalledWith('org-1', {
        appName: 'Putt Palace',
        themeColor: '#123abc',
      })
    );
    // Success path refetches the org (toasts are provider-backed no-ops here).
    await waitFor(() => expect(api.getOrg).toHaveBeenCalledTimes(2));
  });

  test('clearing every field saves {} (all platform defaults)', async () => {
    vi.mocked(api.getOrg).mockResolvedValue({
      org: { ...ORG, branding: { appName: 'Putt Palace' } },
      locations: [],
    });
    const user = userEvent.setup();
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.clear(screen.getByDisplayValue('Putt Palace'));
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(api.updateOrgBranding).toHaveBeenCalledWith('org-1', {}));
  });

  test('a server validation error surfaces inline', async () => {
    vi.mocked(api.updateOrgBranding).mockRejectedValue(
      new Error('themeColor must be a #rrggbb color')
    );
    const user = userEvent.setup();
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.type(screen.getByPlaceholderText('#15803d'), 'not-a-color');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(await screen.findByText('themeColor must be a #rrggbb color')).toBeInTheDocument();
    // The save failed, so no reload happened (initial load only).
    expect(api.getOrg).toHaveBeenCalledTimes(1);
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
