import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Rewards from './Rewards';
import { api, type Reward } from './api';

vi.mock('./api', () => ({
  api: {
    lookupReward: vi.fn(),
    listRewards: vi.fn(),
    redeemReward: vi.fn(),
    gameRewardsMeta: vi.fn(),
    gameRewardsUsage: vi.fn(),
  },
}));

const REWARD: Reward = {
  id: 'rw-1',
  code: 'K7M2PX',
  playerIndex: 0,
  playerTag: 'ACE',
  achievement: 'hole_in_one',
  createdAt: '2026-08-07T00:00:00Z',
  redeemedAt: null,
  redeemedBy: null,
  courseName: 'Blue Course',
  locationName: 'Upland',
};

beforeEach(() => {
  vi.mocked(api.listRewards).mockReset().mockResolvedValue([REWARD]);
  vi.mocked(api.lookupReward).mockReset();
  vi.mocked(api.redeemReward).mockReset();
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
  test('shows the outstanding list with achievement label and context', async () => {
    render(<Rewards />);
    expect(await screen.findByText('K7M2PX')).toBeInTheDocument();
    expect(screen.getByText('Hole-in-One')).toBeInTheDocument();
    expect(screen.getByText('ACE')).toBeInTheDocument();
    expect(screen.getByText(/Blue Course · Upland/)).toBeInTheDocument();
  });

  test('code lookup calls the API and surfaces a not-found message', async () => {
    vi.mocked(api.lookupReward).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<Rewards />);
    await screen.findByText('K7M2PX');

    await user.type(screen.getByPlaceholderText('K7M2PX'), 'zz9zz9');
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    await waitFor(() => expect(api.lookupReward).toHaveBeenCalledWith('ZZ9ZZ9'));
    expect(await screen.findByText(/No reward found for code "ZZ9ZZ9"/)).toBeInTheDocument();
  });

  test('Mark redeemed calls api.redeemReward and the list refreshes', async () => {
    vi.mocked(api.redeemReward).mockResolvedValue({
      ok: true,
      reward: { ...REWARD, redeemedAt: '2026-08-07T01:00:00Z', redeemedBy: 'app-token' },
    });
    const user = userEvent.setup();
    render(<Rewards />);
    await screen.findByText('K7M2PX');

    await user.click(screen.getByRole('button', { name: 'Mark redeemed' }));
    await waitFor(() => expect(api.redeemReward).toHaveBeenCalledWith('rw-1', true));
    // The outstanding list reloads after a redeem.
    await waitFor(() => expect(api.listRewards).toHaveBeenCalledTimes(2));
  });
});
