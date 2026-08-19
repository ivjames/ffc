import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArcadeBotCharts from './ArcadeBotCharts';
import { api, type ArcadeProfile, type ArcadeProfileDetail, type ArcadeTraffic } from './api';

vi.mock('./api', () => ({
  api: { arcadeProfile: vi.fn(), arcadeTraffic: vi.fn() },
}));

const GAMES = [
  { key: 'skeeball', label: 'Skee-Ball' },
  { key: 'darts', label: 'Darts' },
  { key: 'gokarts', label: 'Go-Karts', lowerIsBetter: true },
];

const LISTED: ArcadeProfile[] = [
  {
    name: 'mixed.json',
    bytes: 900,
    modifiedAt: '2026-08-19T01:35:54.000Z',
    summary: { games: 2, gameKeys: ['skeeball', 'darts'], samples: 4, skillMin: 0.3, skillMax: 0.9, skillMean: 0.6 },
  },
];

const DETAIL: ArcadeProfileDetail = {
  ok: true,
  name: 'mixed.json',
  capturedAt: '2026-08-19T01:35:55.000Z',
  base: 'https://bullwinkles.example',
  wallMs: 120_000,
  workers: 3,
  games: [
    {
      key: 'skeeball',
      label: 'Skee-Ball',
      rounds: 2,
      stats: { mean: 400, p10: 120, p50: 400, p90: 700, max: 700, min: 120, meanRoundMs: 20_000 },
      samples: [
        { score: 120, tickets: 12, skill: 0.3 },
        { score: 700, tickets: 70, skill: 0.9 },
      ],
    },
    {
      key: 'darts',
      label: 'Darts',
      rounds: 2,
      // A deliberately FLAT game: p10 === p90. The chart must not imply a spread.
      stats: { mean: 300, p10: 300, p50: 300, p90: 300, max: 300, min: 300, meanRoundMs: 40_000 },
      samples: [
        { score: 300, tickets: 30, skill: 0.4 },
        { score: 300, tickets: 30, skill: 0.8 },
      ],
    },
  ],
};

const TRAFFIC: ArcadeTraffic = {
  ok: true,
  days: 7,
  unit: 'day',
  buckets: [
    { at: '2026-08-18T00:00:00.000Z', awards: 116, requested: 4000, awarded: 2400 },
    { at: '2026-08-19T00:00:00.000Z', awards: 70, requested: 2844, awarded: 1731 },
  ],
  byGame: [
    { game: 'skeeball', awards: 125, requested: 3204, awarded: 2041, capped: 46, pending: 0 },
    { game: 'darts', awards: 61, requested: 3640, awarded: 2090, capped: 26, pending: 0 },
  ],
  totals: {
    awards: 186,
    requested: 6844,
    awarded: 4131,
    pending: 0,
    pending_tickets: 0,
    cards: 11,
    runs: 10,
    capped: 72,
    first_at: '2026-08-18T15:44:02.000Z',
    last_at: '2026-08-19T02:18:32.000Z',
  },
};

beforeEach(() => {
  vi.mocked(api.arcadeProfile).mockReset().mockResolvedValue(DETAIL);
  vi.mocked(api.arcadeTraffic).mockReset().mockResolvedValue(TRAFFIC);
});

describe('ArcadeBotCharts — the numbers the charts encode', () => {
  test('the clamping gap is stated as a share, not left to the eye', async () => {
    // 6,844 requested → 4,131 paid. The 40% the server withheld is the whole
    // reason this chart exists, so it is a figure, not just two bar lengths.
    render(<ArcadeBotCharts profiles={LISTED} games={GAMES} />);
    expect(await screen.findByText('40%')).toBeInTheDocument();
    expect(screen.getByText(/of 6,844 requested/)).toBeInTheDocument();
    expect(screen.getByText('4,131')).toBeInTheDocument();
  });

  test('game keys are rendered as their labels, never raw registry keys', async () => {
    render(<ArcadeBotCharts profiles={LISTED} games={GAMES} />);
    await screen.findByText('40%');
    expect(screen.queryByText('skeeball')).not.toBeInTheDocument();
    expect(screen.getAllByText('Skee-Ball').length).toBeGreaterThan(0);
  });

  test('every charted value is also reachable in a table view', async () => {
    // Tooltips enhance, they never gate: p10/p90 appear nowhere else on screen.
    render(<ArcadeBotCharts profiles={LISTED} games={GAMES} />);
    const summaries = await screen.findAllByText(/Table view/);
    expect(summaries).toHaveLength(2); // one per half
    await userEvent.click(summaries[0]);
    await waitFor(() => expect(screen.getByText('p10')).toBeInTheDocument());
    expect(screen.getByText('p90')).toBeInTheDocument();
  });

  test('a capture with no rounds says so instead of drawing an empty axis', async () => {
    vi.mocked(api.arcadeProfile).mockResolvedValue({ ...DETAIL, games: [] });
    render(<ArcadeBotCharts profiles={LISTED} games={GAMES} />);
    expect(await screen.findByText(/recorded no rounds/)).toBeInTheDocument();
  });

  test('an empty window says so rather than rendering a zero-height chart', async () => {
    vi.mocked(api.arcadeTraffic).mockResolvedValue({
      ...TRAFFIC,
      buckets: [],
      byGame: [],
      totals: { ...TRAFFIC.totals, awards: 0, requested: 0, awarded: 0, capped: 0, cards: 0, runs: 0 },
    });
    render(<ArcadeBotCharts profiles={LISTED} games={GAMES} />);
    expect(await screen.findByText(/No synthetic awards in this window/)).toBeInTheDocument();
  });

  test('changing the window refetches for that many days', async () => {
    render(<ArcadeBotCharts profiles={LISTED} games={GAMES} />);
    await screen.findByText('40%');
    expect(api.arcadeTraffic).toHaveBeenCalledWith(7);
    await userEvent.selectOptions(screen.getByDisplayValue('last 7 days'), '1');
    await waitFor(() => expect(api.arcadeTraffic).toHaveBeenCalledWith(1));
  });

  test('a time-scored game calls its FASTEST round best, not its slowest', async () => {
    // Go-Karts scores elapsed seconds. Normalising by max would label the
    // slowest race "best" and flip the skill scatter's meaning.
    vi.mocked(api.arcadeProfile).mockResolvedValue({
      ...DETAIL,
      games: [
        {
          key: 'gokarts',
          label: 'Go-Karts',
          rounds: 2,
          stats: { mean: 60, p10: 48, p50: 60, p90: 72, max: 72, min: 48, meanRoundMs: 60_000 },
          samples: [
            { score: 48, tickets: 12, skill: 0.9 },
            { score: 72, tickets: 8, skill: 0.3 },
          ],
        },
      ],
    });
    render(<ArcadeBotCharts profiles={LISTED} games={GAMES} />);
    const row = await screen.findByTitle(/Go-Karts — p10 48/);
    expect(row.title).toMatch(/best 48/); // min, because lower is better
    expect(row.title).toMatch(/lower is better/);

    // And the table's Best column agrees.
    const summaries = screen.getAllByText(/Table view/);
    await userEvent.click(summaries[0]);
    await waitFor(() => expect(screen.getByText('Go-Karts (time)')).toBeInTheDocument());
  });

  test('no profiles at all: the capture half stays quiet, the replay half still renders', async () => {
    render(<ArcadeBotCharts profiles={[]} games={GAMES} />);
    expect(await screen.findByText(/No captured profiles yet/)).toBeInTheDocument();
    expect(await screen.findByText('40%')).toBeInTheDocument();
    expect(api.arcadeProfile).not.toHaveBeenCalled();
  });
});
