// Tests for LocationDetail: the pure serialization helpers (business hours +
// hunt cap — the same direct-function idiom as api.test.ts), plus mounted
// round-trip tests that the hunt cap actually rides the save payload.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LocationDetail, {
  buildHoursPayload,
  hoursValidationError,
  buildHuntPayload,
  huntCapValidationError,
} from './LocationDetail';
import { api, HOURS_DAY_KEYS, type HoursDayKey, type Location } from './api';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    api: {
      getLocation: vi.fn(),
      listLocationCourses: vi.fn(),
      gameRewardsMeta: vi.fn(),
      saveLocation: vi.fn(),
      archiveLocation: vi.fn(),
    },
  };
});

type DayState = { closed: boolean; open: string; close: string };
type HoursState = Record<HoursDayKey, DayState>;

// All 7 days closed by default — the state a fresh "hours enabled" toggle
// starts from, and what hoursToState() produces for a location with no
// stored hours.
function allClosed(): HoursState {
  return Object.fromEntries(
    HOURS_DAY_KEYS.map((k) => [k, { closed: true, open: '', close: '' }])
  ) as HoursState;
}

describe('buildHoursPayload', () => {
  test('disabled always sends null, regardless of day state', () => {
    const state = allClosed();
    state.mon = { closed: false, open: '09:00', close: '21:00' };
    expect(buildHoursPayload(false, state)).toBeNull();
  });

  test('enabled with every day closed sends all 7 days as "closed"', () => {
    expect(buildHoursPayload(true, allClosed())).toEqual({
      mon: 'closed',
      tue: 'closed',
      wed: 'closed',
      thu: 'closed',
      fri: 'closed',
      sat: 'closed',
      sun: 'closed',
    });
  });

  test('a day → hours object for each open day, "closed" for the rest', () => {
    const state = allClosed();
    state.mon = { closed: false, open: '12:00', close: '21:00' };
    state.fri = { closed: false, open: '10:00', close: '24:00' }; // midnight close
    const out = buildHoursPayload(true, state);
    expect(out?.mon).toEqual({ open: '12:00', close: '21:00' });
    expect(out?.fri).toEqual({ open: '10:00', close: '24:00' });
    expect(out?.tue).toBe('closed');
    expect(out?.sun).toBe('closed');
  });
});

describe('buildHuntPayload', () => {
  test('blank = unlimited → {} (the column default; clears any stored cap)', () => {
    expect(buildHuntPayload('', false)).toEqual({});
    expect(buildHuntPayload('   ', false)).toEqual({});
  });

  test('0 is distinct from blank: hunt off at this venue', () => {
    expect(buildHuntPayload('0', false)).toEqual({ dailyScanCap: 0 });
  });

  test('a positive cap ships as the integer', () => {
    expect(buildHuntPayload('250', false)).toEqual({ dailyScanCap: 250 });
  });

  test('venueMode ships only when on — false is the default, so it stays unwritten', () => {
    expect(buildHuntPayload('', true)).toEqual({ venueMode: true });
    expect(buildHuntPayload('', false)).toEqual({});
  });

  test('cap and venue mode ride together (the payload replaces the stored object)', () => {
    expect(buildHuntPayload('250', true)).toEqual({ dailyScanCap: 250, venueMode: true });
    // The kill switch wins over the mode flag server-side; both still ship, so
    // turning the cap to 0 never silently drops the venue-hunt setting.
    expect(buildHuntPayload('0', true)).toEqual({ dailyScanCap: 0, venueMode: true });
  });
});

describe('huntCapValidationError', () => {
  test('blank and whole numbers ≥ 0 are valid', () => {
    expect(huntCapValidationError('')).toBeNull();
    expect(huntCapValidationError('0')).toBeNull();
    expect(huntCapValidationError('100')).toBeNull();
  });

  test('negatives, fractions and non-numbers error', () => {
    expect(huntCapValidationError('-1')).toMatch(/whole number/);
    expect(huntCapValidationError('2.5')).toMatch(/whole number/);
    expect(huntCapValidationError('lots')).toMatch(/whole number/);
  });
});

describe('hoursValidationError', () => {
  test('disabled never errors', () => {
    const state = allClosed();
    state.mon = { closed: false, open: '', close: '' };
    expect(hoursValidationError(false, state)).toBeNull();
  });

  test('enabled with all days closed is valid', () => {
    expect(hoursValidationError(true, allClosed())).toBeNull();
  });

  test('enabled with a fully-specified open day is valid', () => {
    const state = allClosed();
    state.sat = { closed: false, open: '09:00', close: '17:00' };
    expect(hoursValidationError(true, state)).toBeNull();
  });

  test('enabled with an open day missing a close time errors, naming the day', () => {
    const state = allClosed();
    state.wed = { closed: false, open: '09:00', close: '' };
    expect(hoursValidationError(true, state)).toMatch(/Wed/);
  });

  test('enabled with an open day missing an open time errors', () => {
    const state = allClosed();
    state.sun = { closed: false, open: '', close: '18:00' };
    expect(hoursValidationError(true, state)).toMatch(/Sun/);
  });
});

// --- Mounted round-trip: the cap field ↔ the save payload ---------------------

const LOCATION: Location = {
  id: 'loc-1',
  name: 'Upland',
  slug: 'upland',
  lat: null,
  lng: null,
  geofenceKm: null,
  tz: 'America/Los_Angeles',
  tzLabel: 'Pacific Time (PT)',
  sortOrder: 0,
  menuUrl: null,
  orderingUrl: null,
  pos: null,
  modules: null,
  hours: null,
  hunt: {},
  orgId: 'org-1',
  archivedAt: null,
};

beforeEach(() => {
  vi.mocked(api.getLocation).mockReset().mockResolvedValue({ location: LOCATION, courses: [], modules: [] });
  vi.mocked(api.listLocationCourses).mockReset().mockResolvedValue([]);
  vi.mocked(api.gameRewardsMeta).mockReset().mockRejectedValue(new Error('unavailable'));
  vi.mocked(api.saveLocation)
    .mockReset()
    .mockResolvedValue({ ok: true, location: LOCATION });
  vi.mocked(api.archiveLocation).mockReset();
});

function renderLocationDetail() {
  return render(
    <MemoryRouter initialEntries={['/locations/loc-1']}>
      <Routes>
        <Route path="/locations/:id" element={<LocationDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

const capInput = () => screen.getByLabelText(/^Daily scan cap/);
const lastSavePayload = () =>
  vi.mocked(api.saveLocation).mock.calls.at(-1)?.[0] as Partial<Location>;

describe('LocationDetail — hunt daily scan cap', () => {
  test('an unset cap renders blank and saves hunt: {} (unlimited)', async () => {
    const user = userEvent.setup();
    renderLocationDetail();
    await screen.findByRole('heading', { name: 'Upland' });
    expect(capInput()).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Save location' }));

    await waitFor(() => expect(api.saveLocation).toHaveBeenCalled());
    expect(lastSavePayload().hunt).toEqual({});
  });

  test('a stored cap prefills, and 0 saves distinctly from blank (hunt off)', async () => {
    vi.mocked(api.getLocation).mockResolvedValue({
      location: { ...LOCATION, hunt: { dailyScanCap: 250 } },
      courses: [],
      modules: [],
    });
    const user = userEvent.setup();
    renderLocationDetail();
    await screen.findByRole('heading', { name: 'Upland' });
    expect(capInput()).toHaveValue('250');

    await user.clear(capInput());
    await user.type(capInput(), '0');
    await user.click(screen.getByRole('button', { name: 'Save location' }));

    await waitFor(() => expect(api.saveLocation).toHaveBeenCalled());
    expect(lastSavePayload().hunt).toEqual({ dailyScanCap: 0 });
  });

  test('clearing a stored cap saves hunt: {} — back to unlimited', async () => {
    vi.mocked(api.getLocation).mockResolvedValue({
      location: { ...LOCATION, hunt: { dailyScanCap: 250 } },
      courses: [],
      modules: [],
    });
    const user = userEvent.setup();
    renderLocationDetail();
    await screen.findByRole('heading', { name: 'Upland' });

    await user.clear(capInput());
    await user.click(screen.getByRole('button', { name: 'Save location' }));

    await waitFor(() => expect(api.saveLocation).toHaveBeenCalled());
    expect(lastSavePayload().hunt).toEqual({});
  });

  test('an invalid cap blocks the save with an inline error', async () => {
    const user = userEvent.setup();
    renderLocationDetail();
    await screen.findByRole('heading', { name: 'Upland' });

    await user.type(capInput(), '-5');
    await user.click(screen.getByRole('button', { name: 'Save location' }));

    expect(await screen.findByText(/whole number/)).toBeInTheDocument();
    expect(api.saveLocation).not.toHaveBeenCalled();
  });
});
