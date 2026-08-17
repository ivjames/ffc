import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HuntUsage from './HuntUsage';
import { api, type HuntUsage as HuntUsagePayload } from './api';

vi.mock('./api', () => ({
  api: {
    huntUsage: vi.fn(),
  },
}));

const USAGE: HuntUsagePayload = {
  pricing: { model: 'claude-haiku-4-5', inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  months: 6,
  rows: [
    {
      month: '2026-08-01',
      orgId: 'org-1',
      orgName: 'Acme Family Fun',
      locationId: 'loc-1',
      locationName: 'Upland',
      locationSlug: 'upland',
      huntRounds: 40,
      scans: 130,
      verifyScans: 120,
      screenScans: 10,
      inputTokens: 240000,
      outputTokens: 12000,
      verifyCostUsd: 0.3,
      screenCostUsd: 0.0042,
      apiCostUsd: 0.3,
    },
    {
      month: '2026-07-01',
      orgId: 'org-2',
      orgName: 'PA Parks',
      locationId: 'loc-2',
      locationName: 'Riverside',
      locationSlug: 'riverside',
      huntRounds: 900,
      scans: 3000,
      verifyScans: 3000,
      screenScans: 0,
      inputTokens: 6000000,
      outputTokens: 300000,
      verifyCostUsd: 7.5,
      screenCostUsd: 0,
      apiCostUsd: 7.5,
    },
  ],
  orgSummary: [
    {
      month: '2026-08-01',
      orgId: 'org-1',
      orgName: 'Acme Family Fun',
      huntRounds: 40,
      scans: 130,
      verifyScans: 120,
      screenScans: 10,
      inputTokens: 240000,
      outputTokens: 12000,
      verifyCostUsd: 0.3,
      screenCostUsd: 0.0042,
      apiCostUsd: 0.3,
    },
    {
      month: '2026-07-01',
      orgId: 'org-2',
      orgName: 'PA Parks',
      huntRounds: 900,
      scans: 3000,
      verifyScans: 3000,
      screenScans: 0,
      inputTokens: 6000000,
      outputTokens: 300000,
      verifyCostUsd: 7.5,
      screenCostUsd: 0,
      apiCostUsd: 7.5,
    },
  ],
};

beforeEach(() => {
  vi.mocked(api.huntUsage).mockReset().mockResolvedValue(USAGE);
});

describe('HuntUsage', () => {
  test('renders the per-org invoice summary: orgs, exact tokens, formatted costs', async () => {
    render(<HuntUsage />);
    // Each org appears in the summary AND its venue row.
    expect(await screen.findAllByText('Acme Family Fun')).toHaveLength(2);
    expect(screen.getAllByText('PA Parks')).toHaveLength(2);
    // Month buckets render compact.
    expect(screen.getAllByText('2026-08').length).toBeGreaterThan(0);
    // Exact billed token counts (CLAUDE.md: no estimates) — once in the org
    // summary, once in the venue drilldown.
    expect(screen.getAllByText('6,000,000')).toHaveLength(2);
    expect(screen.getAllByText('240,000')).toHaveLength(2);
    // Invoice totals to the cent; the screen split keeps 4 decimals.
    expect(screen.getAllByText('$7.50').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.0042').length).toBeGreaterThan(0);
    // The verify pricing footnote names the model.
    expect(screen.getByText(/claude-haiku-4-5 list rates/)).toBeInTheDocument();
  });

  test('renders the per-venue rows with venue names', async () => {
    render(<HuntUsage />);
    expect(await screen.findByText('Upland')).toBeInTheDocument();
    expect(screen.getByText('Riverside')).toBeInTheDocument();
    expect(screen.getByText('/riverside')).toBeInTheDocument();
  });

  test('the month filter narrows the venue rows (summary stays complete)', async () => {
    const user = userEvent.setup();
    render(<HuntUsage />);
    await screen.findByText('Upland');

    await user.selectOptions(screen.getByLabelText('Filter by month'), '2026-07');

    expect(screen.queryByText('Upland')).not.toBeInTheDocument();
    expect(screen.getByText('Riverside')).toBeInTheDocument();
    // The org summary above is untouched by the venue filter.
    expect(screen.getAllByText('Acme Family Fun')).toHaveLength(1);
  });

  test('defaults to 6 months and refetches when the window changes', async () => {
    const user = userEvent.setup();
    render(<HuntUsage />);
    await screen.findByText('Upland');
    expect(api.huntUsage).toHaveBeenCalledWith(6);

    await user.selectOptions(screen.getByLabelText('Months back'), '12');
    await waitFor(() => expect(api.huntUsage).toHaveBeenCalledWith(12));
  });

  test('shows an empty state when there is no billed spend', async () => {
    vi.mocked(api.huntUsage).mockResolvedValue({ ...USAGE, rows: [], orgSummary: [] });
    render(<HuntUsage />);
    expect(await screen.findByText(/No billed hunt scans/)).toBeInTheDocument();
  });
});
