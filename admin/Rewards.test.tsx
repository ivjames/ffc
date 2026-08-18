import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Rewards from './Rewards';
import { api, type RewardSummary } from './api';

vi.mock('./api', () => ({
  api: {
    rewardsSummary: vi.fn(),
    gameRewardsMeta: vi.fn(),
    gameRewardsUsage: vi.fn(),
  },
}));

const SUMMARY: RewardSummary = {
  days: 30,
  byAchievement: [
    { achievement: 'hole_in_one', label: 'Hole-in-One', granted: 12 },
    { achievement: 'under_par', label: 'Under Par', granted: 5 },
  ],
  rows: [
    {
      day: '2026-08-07',
      locationId: 'loc-1',
      locationName: 'Upland',
      achievement: 'hole_in_one',
      label: 'Hole-in-One',
      granted: 3,
    },
  ],
};

beforeEach(() => {
  vi.mocked(api.rewardsSummary).mockReset().mockResolvedValue(SUMMARY);
  vi.mocked(api.gameRewardsMeta)
    .mockReset()
    .mockResolvedValue({
      games: [{ key: 'skeeball', label: 'Skee-Ball' }],
      hardMaxPerRound: 100,
      defaultDailyPerCard: 500,
      maxDailyPerCard: 10000,
    });
  vi.mocked(api.gameRewardsUsage).mockReset().mockResolvedValue({
    days: 30,
    rows: [],
    topCards: [],
  });
});

describe('Rewards', () => {
  test('reports achievement issuance with labels and earned counts', async () => {
    render(<Rewards />);
    // Hole-in-One appears in both the summary and the per-day drilldown.
    expect((await screen.findAllByText('Hole-in-One')).length).toBeGreaterThan(0);
    expect(screen.getByText('Under Par')).toBeInTheDocument();
    // Earned counts are reported; achievements pay nothing, so there is no
    // ticket column to assert on.
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    // The per-day drilldown shows the venue.
    expect(screen.getByText('Upland')).toBeInTheDocument();
  });

  test('shows an empty state when no achievements were earned', async () => {
    vi.mocked(api.rewardsSummary).mockResolvedValue({ days: 30, byAchievement: [], rows: [] });
    render(<Rewards />);
    expect(
      await screen.findByText(/No golf achievements earned in this window/)
    ).toBeInTheDocument();
  });

  test('changing the window refetches both reports with the new day count', async () => {
    const user = userEvent.setup();
    render(<Rewards />);
    await screen.findAllByText('Hole-in-One');
    expect(api.rewardsSummary).toHaveBeenCalledWith(30);
    expect(api.gameRewardsUsage).toHaveBeenCalledWith(30);

    await user.selectOptions(screen.getByRole('combobox'), '7');

    await waitFor(() => expect(api.rewardsSummary).toHaveBeenCalledWith(7));
    await waitFor(() => expect(api.gameRewardsUsage).toHaveBeenCalledWith(7));
  });
});
