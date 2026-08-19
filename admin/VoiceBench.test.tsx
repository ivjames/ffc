import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceBench from './VoiceBench';
import { api, type TtsPlan, type TtsVenue } from './api';

vi.mock('./api', () => ({
  api: {
    ttsVenues: vi.fn(),
    ttsRuns: vi.fn(),
    ttsPlan: vi.fn(),
    ttsRun: vi.fn(),
    ttsRunGet: vi.fn(),
    fetchTtsClip: vi.fn(),
  },
}));

const VENUES: TtsVenue[] = [
  { id: 'loc-1', name: 'Upland', slug: 'upland', orgId: null, orgName: null },
  { id: 'loc-2', name: 'Other Client', slug: 'other', orgId: 'org-2', orgName: 'Other Org' },
];

const planFor = (locationId: string): TtsPlan => ({
  venue: VENUES.find((v) => v.id === locationId)!,
  lines: [{ label: 'Question 1', text: 'What year did the Titanic sink?' }],
  clips: 1,
  chars: 31,
  usd: 0.00093,
  byProvider: { Polly: { clips: 1, chars: 31, usd: 0.00093, estimated: false } },
  providers: [
    { key: 'polly', label: 'Polly', configured: true, why: 'AWS keys', voices: [], error: null },
    { key: 'openai', label: 'OpenAI', configured: false, why: 'OPENAI_API_KEY in server/.env', voices: [] },
  ],
});

beforeEach(() => {
  vi.mocked(api.ttsVenues).mockReset().mockResolvedValue({ venues: VENUES });
  vi.mocked(api.ttsRuns).mockReset().mockResolvedValue({ runs: [] });
  vi.mocked(api.ttsRun).mockReset();
  vi.mocked(api.ttsPlan)
    .mockReset()
    .mockImplementation(async ({ locationId }) => planFor(locationId));
});

describe('VoiceBench', () => {
  test('names the providers that are missing a key rather than showing fewer columns', async () => {
    render(<VoiceBench />);
    expect(
      await screen.findByText(/Not in this run: OpenAI \(set OPENAI_API_KEY in server\/\.env\)/),
    ).toBeTruthy();
  });

  /** Both halves of the same spend bug. Synthesize must bill the request that
   *  was PRICED (not the live controls, which may have moved on), and must not
   *  bill a stale priced request either (the operator is looking at a different
   *  venue). The only safe pairing is priced === on screen. */
  test('reprices instead of spending when the selection moved on', async () => {
    const user = userEvent.setup();
    // Hold the second pricing request open, so the screen still carries the
    // plan for loc-1 while the select already shows loc-2.
    let release!: (p: TtsPlan) => void;
    render(<VoiceBench />);
    await waitFor(() => expect(api.ttsPlan).toHaveBeenCalledTimes(1));

    vi.mocked(api.ttsPlan).mockImplementationOnce(
      () => new Promise<TtsPlan>((resolve) => (release = resolve)),
    );
    await user.selectOptions(screen.getByLabelText('Venue'), 'loc-2');
    await waitFor(() => expect(api.ttsPlan).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: /Synthesize/ }));
    expect(api.ttsRun).not.toHaveBeenCalled();
    expect(await screen.findByText(/Selection changed — pricing it/)).toBeTruthy();

    // Once the price for what is on screen lands, Synthesize spends on THAT.
    release(planFor('loc-2'));
    await waitFor(() => expect(screen.getByText(/Nothing spent yet/)).toBeTruthy());
    vi.mocked(api.ttsRun).mockResolvedValue({
      run: { runId: 'r1', createdAt: '2026-08-19T00:00:00Z', clips: [], billed: 0, usd: 0, errors: 0 },
    });
    await user.click(screen.getByRole('button', { name: /Synthesize/ }));
    await waitFor(() =>
      expect(api.ttsRun).toHaveBeenCalledWith({ locationId: 'loc-2', questions: 3 }),
    );
  });
});
