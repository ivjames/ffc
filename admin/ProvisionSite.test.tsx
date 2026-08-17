import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProvisionSite from './ProvisionSite';
import { api, type ProvisionPayload, type ProvisionResult } from './api';

vi.mock('./api', () => ({
  api: {
    provisionSite: vi.fn(),
  },
  HOURS_DAY_KEYS: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
}));

const SITE: ProvisionResult['site'] = {
  org: {
    id: 'org-1',
    name: 'Putt Palace',
    slug: 'putt-palace',
    status: 'active',
    sortOrder: 0,
    archivedAt: null,
  },
  location: {
    id: 'loc-1',
    name: 'Putt Palace',
    slug: 'putt-palace',
    lat: null,
    lng: null,
    geofenceKm: 2,
    tz: null,
    tzLabel: null,
    sortOrder: 0,
    menuUrl: null,
    orderingUrl: null,
    pos: null,
    hours: null,
    orgId: 'org-1',
    archivedAt: null,
  },
  courses: [
    {
      id: 'course-1',
      name: 'Putt Palace Course',
      theme: 'classic',
      holeCount: 18,
      pars: [],
      locationId: 'loc-1',
      sortOrder: 0,
      archivedAt: null,
    },
  ],
  adminUser: null,
  playerUrl: 'https://putt-palace.ffc.example',
};

beforeEach(() => {
  vi.mocked(api.provisionSite).mockReset().mockResolvedValue({ ok: true, site: SITE });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ProvisionSite />
    </MemoryRouter>
  );
}

/** Type an org name and submit — everything else stays at its defaults. */
async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("Bullwinkle's"), 'Putt Palace');
  await user.click(screen.getByRole('button', { name: 'Provision site' }));
  await waitFor(() => expect(api.provisionSite).toHaveBeenCalledOnce());
  return vi.mocked(api.provisionSite).mock.calls[0][0] as ProvisionPayload;
}

describe('ProvisionSite', () => {
  test('renders all section headings', () => {
    renderPage();
    for (const name of ['Site identity', 'Branding', 'First venue', 'Courses', 'Offering', 'Org admin (optional)']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
  });

  test('typing the org name auto-fills the org and venue slugs', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByPlaceholderText("Bullwinkle's"), 'Putt Palace');
    // Org slug + venue slug both derive from the name.
    expect(screen.getAllByDisplayValue('putt-palace')).toHaveLength(2);
    // The live subdomain preview (no admin.* hostname in jsdom → placeholder domain).
    expect(screen.getByText('putt-palace.<your platform domain>')).toBeInTheDocument();
  });

  test('submitting with defaults sends the derived payload, with pos absent', async () => {
    const user = userEvent.setup();
    renderPage();
    const payload = await fillAndSubmit(user);

    expect(payload.org).toEqual({ name: 'Putt Palace', slug: 'putt-palace' });
    expect(payload.branding).toEqual({
      appName: 'Putt Palace',
      shortName: 'Putt',
      themeColor: '#d61b5e',
      accentColor: '#ff2e73',
      backgroundColor: '#2b0a18',
      shareFooter: 'Putt Palace · come beat this score',
    });
    expect(payload.location.name).toBe('Putt Palace');
    expect(payload.location.slug).toBe('putt-palace');
    expect(payload.location.geofenceKm).toBe(2);
    expect(payload.location.hours?.mon).toEqual({ open: '10:00', close: '21:00' });
    expect(payload.location.pos).toBeUndefined();
    expect(payload.courses).toHaveLength(1);
    expect(payload.courses[0].name).toBe('Putt Palace Course');
    expect(payload.courses[0].pars).toHaveLength(18);
    expect(payload.adminUser).toBeUndefined();
  });

  test('"Ordering + loyalty" sends both pos blocks', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Ordering + loyalty' }));
    const payload = await fillAndSubmit(user);

    expect(payload.location.pos).toEqual({
      ordering: { vendor: 'centeredge' },
      loyalty: { vendor: 'centeredge', gameRewards: true },
    });
  });

  test('success replaces the form with the "Site is live" panel and playerUrl link', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillAndSubmit(user);

    expect(await screen.findByRole('heading', { name: 'Site is live' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'https://putt-palace.ffc.example' });
    expect(link).toHaveAttribute('href', 'https://putt-palace.ffc.example');
    expect(screen.getByRole('link', { name: 'Upload logos and icons' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ticket caps, hours, food links' })).toBeInTheDocument();
    // The form is gone.
    expect(screen.queryByRole('button', { name: 'Provision site' })).not.toBeInTheDocument();
  });

  test('a server error shows in the banner and keeps the form', async () => {
    vi.mocked(api.provisionSite).mockRejectedValue(new Error('org slug already in use'));
    const user = userEvent.setup();
    renderPage();
    await fillAndSubmit(user);

    expect(await screen.findByText('org slug already in use')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Provision site' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Site is live' })).not.toBeInTheDocument();
  });
});
