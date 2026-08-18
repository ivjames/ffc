import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LocationModules from './LocationModules';
import { api, type Location, type ModuleStatus } from './api';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, api: { ...actual.api, saveLocation: vi.fn() } };
});

const LOCATION: Location = {
  id: 'loc-1',
  name: 'Upland',
  slug: 'upland',
  lat: null,
  lng: null,
  geofenceKm: null,
  tz: null,
  tzLabel: null,
  sortOrder: 0,
  menuUrl: null,
  orderingUrl: null,
  pos: { ordering: null, loyalty: { vendor: 'centeredge', apiBase: null, gameRewards: true } },
  modules: null,
  hours: null,
  hunt: null,
  orgId: 'org-1',
  archivedAt: null,
};

const mod = (over: Partial<ModuleStatus>): ModuleStatus => ({
  key: 'rewards',
  label: 'Rewards card',
  blurb: 'Player card balances, tickets, and redemption in the app.',
  live: true,
  entitled: true,
  wired: true,
  needsVendor: 'loyalty',
  requires: null,
  blockedBy: null,
  inherited: true,
  ...over,
});

function renderPanel(modules: ModuleStatus[], location: Location = LOCATION) {
  return render(
    <LocationModules location={location} modules={modules} onSaved={() => {}} />
  );
}

beforeEach(() => {
  vi.mocked(api.saveLocation).mockReset().mockResolvedValue({ ok: true, location: LOCATION });
});

describe('LocationModules', () => {
  test('a live module reads as live; an unwired one says what is missing', async () => {
    renderPanel([
      mod({ key: 'rewards', label: 'Rewards card', live: true }),
      mod({
        key: 'ordering',
        label: 'Food & drink ordering',
        needsVendor: 'ordering',
        live: false,
        entitled: true,
        wired: false,
        blockedBy: 'not-wired',
      }),
    ]);

    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Needs wiring')).toBeInTheDocument();
    expect(screen.getByText(/No POS vendor configured/)).toBeInTheDocument();
  });

  test('a module blocked by its dependency explains that, not "unwired"', () => {
    renderPanel([
      mod({
        key: 'gameTickets',
        label: 'Game ticket payouts',
        requires: 'rewards',
        live: false,
        entitled: true,
        wired: true,
        blockedBy: 'requires',
      }),
    ]);
    expect(screen.getByText(/parent module to be live/)).toBeInTheDocument();
    expect(screen.queryByText('Needs wiring')).not.toBeInTheDocument();
  });

  test('toggling a module writes only that key, carrying the rest of the record', async () => {
    const user = userEvent.setup();
    renderPanel([mod({ key: 'rewards', label: 'Rewards card', entitled: true })]);

    await user.click(screen.getByRole('checkbox', { name: 'Rewards card' }));

    await waitFor(() => expect(api.saveLocation).toHaveBeenCalled());
    const payload = vi.mocked(api.saveLocation).mock.calls[0][0];
    expect(payload.modules).toEqual({ rewards: false });
    // The save is replace-not-merge, so switching a module must not drop the
    // venue's POS wiring — that's the entire point of separating the two.
    expect(payload.pos).toEqual(LOCATION.pos);
    expect(payload.slug).toBe('upland');
  });

  test('an existing modules object is merged, not replaced', async () => {
    const user = userEvent.setup();
    const withModules: Location = { ...LOCATION, modules: { arcade: false } };
    renderPanel([mod({ key: 'rewards', label: 'Rewards card', entitled: true })], withModules);

    await user.click(screen.getByRole('checkbox', { name: 'Rewards card' }));

    await waitFor(() => expect(api.saveLocation).toHaveBeenCalled());
    expect(vi.mocked(api.saveLocation).mock.calls[0][0].modules).toEqual({
      arcade: false,
      rewards: false,
    });
  });

  test('"inherited" marks a module nobody has decided on yet', () => {
    renderPanel([
      mod({ key: 'rewards', label: 'Rewards card', inherited: true }),
      mod({ key: 'arcade', label: 'Arcade', needsVendor: null, inherited: false }),
    ]);
    expect(screen.getAllByText('Inherited')).toHaveLength(1);
  });
});
