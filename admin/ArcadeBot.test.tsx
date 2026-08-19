import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArcadeBot from './ArcadeBot';
import { api, type ArcadeStatus, type ArcadeProfile } from './api';

vi.mock('./api', () => ({
  api: {
    arcadeStatus: vi.fn(),
    arcadeCapture: vi.fn(),
    arcadeReplay: vi.fn(),
    arcadeStop: vi.fn(),
  },
}));

const IDLE = {
  running: false,
  pid: null,
  startedAt: null,
  params: null,
  lastExit: null,
  logs: [],
};

const MIXED: ArcadeProfile = {
  name: 'mixed.json',
  bytes: 900,
  modifiedAt: '2026-08-19T01:35:54.000Z',
  summary: { games: 1, gameKeys: ['skeeball'], samples: 10, skillMin: 0.3, skillMax: 0.74, skillMean: 0.51 },
};
const EXPERT: ArcadeProfile = {
  name: 'expert.json',
  bytes: 800,
  modifiedAt: '2026-08-19T00:32:07.000Z',
  summary: { games: 2, gameKeys: ['skeeball', 'gokarts'], samples: 12, skillMin: 1, skillMax: 1, skillMean: 1 },
};
const EMPTY: ArcadeProfile = {
  name: 'empty.json',
  bytes: 300,
  modifiedAt: '2026-08-18T00:00:00.000Z',
  summary: { games: 1, gameKeys: [], samples: 0, skillMin: null, skillMax: null, skillMean: null },
};

function status(profiles: ArcadeProfile[]): ArcadeStatus {
  return {
    canControl: true,
    games: [
      { key: 'skeeball', label: 'Skee-Ball', estRoundMs: 19_500 },
      { key: 'gokarts', label: 'Go-Karts', estRoundMs: 180_000 },
    ],
    browser: { available: true, at: '/opt/pw-browsers' },
    appBase: 'http://127.0.0.1:5173',
    profiles,
    venues: [{ id: 'loc-1', name: 'Upland', orgName: null, orgSlug: null, gameRewards: true }],
    syntheticAwards: { total: 10, last24h: 4, tickets: 300 },
    capture: IDLE,
    replay: IDLE,
  };
}

beforeEach(() => {
  vi.mocked(api.arcadeStatus).mockReset();
  vi.mocked(api.arcadeReplay).mockReset().mockResolvedValue({ ok: true, runner: IDLE });
});

describe('ArcadeBot — a profile advertises the skill it will replay as', () => {
  // Replay draws from the recorded samples, so a fixed-skill capture pays that
  // same standard of play forever. The bot does not have to play at expert
  // level, and an operator has no way to tell which kind of profile they picked
  // unless the page says so.
  test('a fixed-skill profile is called out as one', async () => {
    vi.mocked(api.arcadeStatus).mockResolvedValue(status([EXPERT]));
    render(<ArcadeBot />);
    expect(await screen.findByText(/fixed skill of/)).toBeInTheDocument();
    expect(screen.getByText(/wrong for\s+traffic that should look like an arcade/)).toBeInTheDocument();
  });

  test('a mixed profile reports its spread instead of a warning', async () => {
    vi.mocked(api.arcadeStatus).mockResolvedValue(status([MIXED]));
    render(<ArcadeBot />);
    expect(await screen.findByText(/Player mix: skill 0\.30–0\.74 \(mean 0\.51\)/)).toBeInTheDocument();
    expect(screen.queryByText(/fixed skill of/)).not.toBeInTheDocument();
  });

  test('switching profiles switches the note', async () => {
    vi.mocked(api.arcadeStatus).mockResolvedValue(status([MIXED, EXPERT]));
    render(<ArcadeBot />);
    // Newest first, so the mixed one is preselected.
    expect(await screen.findByText(/Player mix:/)).toBeInTheDocument();

    const picker = screen.getByLabelText(/Profile/i);
    await userEvent.selectOptions(picker, 'expert.json');
    await waitFor(() => expect(screen.getByText(/fixed skill of/)).toBeInTheDocument());
    expect(screen.queryByText(/Player mix:/)).not.toBeInTheDocument();
  });
});

describe('ArcadeBot — guards', () => {
  test('a profile that recorded 0 rounds cannot be replayed', async () => {
    vi.mocked(api.arcadeStatus).mockResolvedValue(status([EMPTY]));
    render(<ArcadeBot />);
    expect(await screen.findByText(/recorded 0 rounds/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start dry run/i })).toBeDisabled();
  });

  test('the replay game picker offers only what the profile captured', async () => {
    // Picking a game the profile has no samples for makes arcade-traffic throw
    // "profile has no game" and exit having posted nothing.
    vi.mocked(api.arcadeStatus).mockResolvedValue(status([MIXED]));
    render(<ArcadeBot />);
    await screen.findByText(/Player mix:/);
    // Capture's picker lists the whole registry; replay's lists the profile's.
    expect(screen.getAllByLabelText('Skee-Ball')).toHaveLength(2);
    expect(screen.getAllByLabelText('Go-Karts')).toHaveLength(1);
  });

  test('switching to a narrower profile drops a now-invalid game selection', async () => {
    // EXPERT holds both games, MIXED only skeeball.
    vi.mocked(api.arcadeStatus).mockResolvedValue(status([EXPERT, MIXED]));
    render(<ArcadeBot />);
    await screen.findByText(/fixed skill of/);

    // Tick Go-Karts in the REPLAY picker (the second one on the page).
    const gokarts = screen.getAllByLabelText('Go-Karts');
    await userEvent.click(gokarts[gokarts.length - 1]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText(/Profile/i), 'mixed.json');
    await waitFor(() => expect(screen.queryByText(/1 selected/)).not.toBeInTheDocument());
  });

  test('capture is refused, with the reason, when the host has no browser', async () => {
    const s = status([MIXED]);
    s.browser = { available: false, at: null, reason: 'no Playwright browser found on the API host' };
    vi.mocked(api.arcadeStatus).mockResolvedValue(s);
    render(<ArcadeBot />);
    expect(await screen.findByText(/no Playwright browser found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start capture/i })).toBeDisabled();
  });

  test('the capture estimate sums the per-game round times, not a flat rate', async () => {
    vi.mocked(api.arcadeStatus).mockResolvedValue(status([MIXED]));
    render(<ArcadeBot />);
    // Default 10 rounds × (19.5s + 180s) = ~33 min, and emphatically not
    // 10 × 2 games at some uniform pace. The number is its own <strong>, so
    // match on the paragraph's full text.
    const est = await screen.findByText(/of wall clock/);
    expect(est.textContent).toMatch(/≈ 20 rounds, roughly 33 min of wall clock/);
  });
});
