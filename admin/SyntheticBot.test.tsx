import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SyntheticBot from './SyntheticBot';
import { api, type SyntheticStatus, type SyntheticProjection } from './api';

vi.mock('./api', () => ({
  api: {
    syntheticStatus: vi.fn(),
    syntheticProjection: vi.fn(),
    syntheticStart: vi.fn(),
    syntheticStop: vi.fn(),
  },
}));

const COURSES: SyntheticStatus['courses'] = [
  {
    courseId: 'c1',
    courseName: 'California Course',
    locationId: 'loc-upland',
    locationName: 'Upland',
    tz: 'America/Los_Angeles',
    hours: null,
    parsKnown: true,
    openNow: true,
    weeklyOpenHours: 71,
  },
];

function status(over: Partial<SyntheticStatus> = {}): SyntheticStatus {
  return {
    keySet: true,
    canControl: true,
    policy: { countsOnBoard: true, mintsRewards: true },
    courses: COURSES,
    syntheticRounds: { total: 12, last24h: 3 },
    runner: { running: false, pid: null, startedAt: null, params: null, lastExit: null, logs: [] },
    ...over,
  };
}

const PROJECTION: SyntheticProjection = {
  courseCount: 1,
  avgPlayers: 2.5,
  max: { roundsPerYear: 17520, playersPerYear: 43800 },
  gated: { roundsPerYear: 9256, playersPerYear: 23140 },
  effective: { roundsPerYear: 9256, playersPerYear: 23140 },
};

beforeEach(() => {
  vi.mocked(api.syntheticStatus).mockReset().mockResolvedValue(status());
  vi.mocked(api.syntheticProjection).mockReset().mockResolvedValue(PROJECTION);
  vi.mocked(api.syntheticStart).mockReset().mockResolvedValue({ ok: true, runner: status().runner });
  vi.mocked(api.syntheticStop).mockReset().mockResolvedValue({ ok: true, runner: status().runner });
});

describe('SyntheticBot', () => {
  test('warns and disables Start when no key is set', async () => {
    vi.mocked(api.syntheticStatus).mockResolvedValue(status({ keySet: false }));
    render(<SyntheticBot />);
    expect(await screen.findByText(/Bot disabled — no key set/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start bot/ })).toBeDisabled();
  });

  test('shows the projected players/year and starts the bot with the current cadence', async () => {
    const user = userEvent.setup();
    render(<SyntheticBot />);

    // Debounced projection preview renders the effective players/yr.
    expect(await screen.findByText('23,140')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.syntheticProjection).toHaveBeenCalledWith(
        expect.objectContaining({ playsPerCourse: 2, intervalMin: 60, maxPlayers: 4, ignoreHours: false, locationId: null })
      )
    );

    const start = await screen.findByRole('button', { name: /Start bot/ });
    expect(start).toBeEnabled();
    await user.click(start);
    expect(api.syntheticStart).toHaveBeenCalledWith(
      expect.objectContaining({ playsPerCourse: 2, intervalMin: 60, maxPlayers: 4, locationId: null })
    );
  });

  test('when running, offers Stop and reports the pid', async () => {
    const user = userEvent.setup();
    vi.mocked(api.syntheticStatus).mockResolvedValue(
      status({ runner: { running: true, pid: 4242, startedAt: new Date().toISOString(), params: null, lastExit: null, logs: [{ at: '', line: 'sweep 1/∞: 2/2 ok' }] } })
    );
    render(<SyntheticBot />);

    expect(await screen.findByText(/running · pid 4242/)).toBeInTheDocument();
    const stop = screen.getByRole('button', { name: /Stop bot/ });
    await user.click(stop);
    expect(api.syntheticStop).toHaveBeenCalled();
  });

  test('background poll refresh does not blank the page to a spinner', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(api.syntheticStatus).mockResolvedValue(
        status({ runner: { running: true, pid: 5, startedAt: new Date().toISOString(), params: null, lastExit: null, logs: [] } })
      );
      render(<SyntheticBot />);
      expect(await screen.findByText(/running · pid 5/)).toBeInTheDocument();

      // Fire the 4s runner poll. The first-load spinner must NOT reappear, and
      // the page content must stay put (updates in place, no re-flash).
      await vi.advanceTimersByTimeAsync(4500);
      expect(screen.queryByText('Loading synthetic bot…')).not.toBeInTheDocument();
      expect(screen.getByText(/running · pid 5/)).toBeInTheDocument();
      expect(vi.mocked(api.syntheticStatus).mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('hides controls for non-super-admins', async () => {
    vi.mocked(api.syntheticStatus).mockResolvedValue(status({ canControl: false }));
    render(<SyntheticBot />);
    expect(await screen.findByText(/limited to super admins/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start bot/ })).not.toBeInTheDocument();
  });
});
