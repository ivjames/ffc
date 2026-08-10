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
    { achievement: 'hole_in_one', granted: 12, cardClaims: 9, pending: 1, unclaimed: 2, tickets: 900 },
    { achievement: 'under_par', granted: 5, cardClaims: 5, pending: 0, unclaimed: 0, tickets: 250 },
  ],
  rows: [
    {
      day: '2026-08-07',
      locationId: 'loc-1',
      locationName: 'Upland',
      achievement: 'hole_in_one',
      granted: 3,
      cardClaims: 2,
      pending: 1,
      tickets: 200,
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
  test('reports achievement issuance with labels, banked counts and tickets paid', async () => {
    render(<Rewards />);
    // Hole-in-One appears in both the summary and the per-day drilldown.
    expect((await screen.findAllByText('Hole-in-One')).length).toBeGreaterThan(0);
    expect(screen.getByText('Under Par')).toBeInTheDocument();
    // Tickets paid for hole-in-one appears in the summary table.
    expect(screen.getByText('900')).toBeInTheDocument();
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
