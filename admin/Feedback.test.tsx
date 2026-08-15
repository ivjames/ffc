import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Feedback from './Feedback';
import { api, type AdminFeedback } from './api';

vi.mock('./api', () => ({
  api: {
    listFeedback: vi.fn(),
    setFeedbackStatus: vi.fn(),
    removeFeedback: vi.fn(),
    fetchFeedbackScreenshot: vi.fn(),
  },
}));

const NOTES: AdminFeedback[] = [
  {
    id: 'fb-1',
    body: 'The hole numbers wash out in sunlight',
    screenPath: '/golf/play',
    reviewer: 'Sam',
    appBuild: 'abc1234',
    userAgent: 'Mozilla/5.0 (iPhone)',
    status: 'open',
    createdAt: '2026-08-14T18:00:00Z',
    resolvedAt: null,
    resolvedBy: null,
    hasScreenshot: true,
    locationName: 'Upland',
  },
  {
    id: 'fb-2',
    body: 'Booth stickers are great',
    screenPath: null,
    reviewer: null, // anonymous — no name typed
    appBuild: null,
    userAgent: null,
    status: 'open',
    createdAt: '2026-08-14T17:00:00Z',
    resolvedAt: null,
    resolvedBy: null,
    hasScreenshot: false,
    locationName: null,
  },
];

// jsdom has no object-URL API; the screenshot thumbnail needs both halves.
URL.createObjectURL = vi.fn(() => 'blob:shot');
URL.revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.mocked(api.listFeedback).mockReset().mockResolvedValue(NOTES);
  vi.mocked(api.setFeedbackStatus).mockReset();
  vi.mocked(api.removeFeedback).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(api.fetchFeedbackScreenshot)
    .mockReset()
    .mockResolvedValue(new Blob(['shot'], { type: 'image/png' }));
});

describe('Feedback', () => {
  test('opens on the unresolved notes — the triage queue, not the archive', async () => {
    render(<Feedback />);
    await waitFor(() => expect(api.listFeedback).toHaveBeenCalled());
    expect(vi.mocked(api.listFeedback).mock.calls[0][0]).toMatchObject({ status: 'open' });
  });

  test('shows each note with the screen and build it was filed against', async () => {
    render(<Feedback />);
    expect(await screen.findByText('The hole numbers wash out in sunlight')).toBeInTheDocument();
    expect(screen.getByText('/golf/play')).toBeInTheDocument();
    expect(screen.getByText(/build abc1234/)).toBeInTheDocument();
    expect(screen.getByText(/Upland/)).toBeInTheDocument();
    // A note filed without a name still reads as a note, not a blank row.
    expect(screen.getByText('Anonymous reviewer')).toBeInTheDocument();
    // Only the note that has one fetches a screenshot.
    await waitFor(() => expect(api.fetchFeedbackScreenshot).toHaveBeenCalledTimes(1));
    expect(api.fetchFeedbackScreenshot).toHaveBeenCalledWith('fb-1');
  });

  test('resolving a note clears it from the open queue', async () => {
    vi.mocked(api.setFeedbackStatus).mockResolvedValue({
      ok: true,
      status: 'resolved',
      resolvedAt: '2026-08-15T00:00:00Z',
      resolvedBy: 'ops@example.com',
    });
    const user = userEvent.setup();
    render(<Feedback />);

    await user.click((await screen.findAllByRole('button', { name: /mark resolved/i }))[0]);

    await waitFor(() => expect(api.setFeedbackStatus).toHaveBeenCalledWith('fb-1', 'resolved'));
    // Resolved from the Open tab -> it leaves the list rather than lingering greyed.
    await waitFor(() =>
      expect(screen.queryByText('The hole numbers wash out in sunlight')).not.toBeInTheDocument()
    );
    expect(screen.getByText('Booth stickers are great')).toBeInTheDocument();
  });

  test('the Resolved tab re-queries the server for that state', async () => {
    const user = userEvent.setup();
    render(<Feedback />);
    await screen.findByText('The hole numbers wash out in sunlight');

    vi.mocked(api.listFeedback).mockResolvedValue([
      { ...NOTES[0], status: 'resolved', resolvedBy: 'ops@example.com' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Resolved' }));

    await waitFor(() =>
      expect(vi.mocked(api.listFeedback).mock.lastCall?.[0]).toMatchObject({ status: 'resolved' })
    );
    expect(await screen.findByText('resolved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-open/i })).toBeInTheDocument();
  });

  test('the All tab drops the status filter entirely', async () => {
    const user = userEvent.setup();
    render(<Feedback />);
    await screen.findByText('The hole numbers wash out in sunlight');

    await user.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() =>
      expect(vi.mocked(api.listFeedback).mock.lastCall?.[0]?.status).toBeUndefined()
    );
  });

  test('deleting asks first, and a declined confirm changes nothing', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Feedback />);

    await user.click((await screen.findAllByRole('button', { name: /delete/i }))[0]);
    expect(api.removeFeedback).not.toHaveBeenCalled();
    expect(screen.getByText('The hole numbers wash out in sunlight')).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await user.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    await waitFor(() => expect(api.removeFeedback).toHaveBeenCalledWith('fb-1'));
    await waitFor(() =>
      expect(screen.queryByText('The hole numbers wash out in sunlight')).not.toBeInTheDocument()
    );
    confirm.mockRestore();
  });

  test('surfaces a load failure instead of an empty-looking queue', async () => {
    vi.mocked(api.listFeedback).mockRejectedValue(new Error('HTTP 500'));
    render(<Feedback />);
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
  });

  test('says so when there is nothing to triage', async () => {
    vi.mocked(api.listFeedback).mockResolvedValue([]);
    render(<Feedback />);
    expect(await screen.findByText('No feedback right now.')).toBeInTheDocument();
  });
});
