import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Signups from './Signups';
import { api, type LaunchSignup } from './api';

vi.mock('./api', () => ({
  api: {
    listLaunchSignups: vi.fn(),
    exportLaunchSignupsCsv: vi.fn(),
  },
}));

const ROWS: LaunchSignup[] = [
  {
    id: 'ls-1',
    email: 'owner@moosemountain.com',
    consent: true,
    source: 'landing',
    createdAt: '2026-08-15T18:30:00Z',
    updatedAt: '2026-08-16T01:15:00Z',
  },
  {
    id: 'ls-2',
    email: 'gm@boardwalkfun.com',
    consent: true,
    source: 'landing',
    createdAt: '2026-08-10T02:00:00Z',
    updatedAt: '2026-08-12T02:00:00Z',
  },
];

beforeEach(() => {
  vi.mocked(api.listLaunchSignups).mockReset().mockResolvedValue(ROWS);
  vi.mocked(api.exportLaunchSignupsCsv).mockReset();
});

describe('Signups', () => {
  test('renders a row per signup with email, consent, and Pacific dates', async () => {
    render(<Signups />);

    expect(await screen.findByText('owner@moosemountain.com')).toBeInTheDocument();
    expect(screen.getByText('gm@boardwalkfun.com')).toBeInTheDocument();
    // 2026-08-15T18:30Z is Aug 15, 11:30 AM Pacific; the update lands 6:15 PM.
    expect(screen.getByText('Aug 15, 2026, 11:30 AM')).toBeInTheDocument();
    expect(screen.getByText('Aug 15, 2026, 6:15 PM')).toBeInTheDocument();
    // 2026-08-10T02:00Z rolls back to Aug 9 Pacific.
    expect(screen.getByText('Aug 9, 2026, 7:00 PM')).toBeInTheDocument();
    expect(screen.getAllByText('yes')).toHaveLength(2);
  });

  test('empty list shows the empty state, not a table', async () => {
    vi.mocked(api.listLaunchSignups).mockResolvedValue([]);
    render(<Signups />);

    expect(await screen.findByText('No signups yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('a failed load shows the error banner', async () => {
    vi.mocked(api.listLaunchSignups).mockRejectedValue(new Error('server exploded'));
    render(<Signups />);

    expect(await screen.findByText('server exploded')).toBeInTheDocument();
  });

  test('Export CSV downloads the blob from exportLaunchSignupsCsv', async () => {
    const blob = new Blob(['email\n'], { type: 'text/csv' });
    vi.mocked(api.exportLaunchSignupsCsv).mockResolvedValue(blob);
    const createObjectURL = vi.fn(() => 'blob:launch-signups');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    let downloadName = '';
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download;
      });
    const user = userEvent.setup();
    render(<Signups />);
    await screen.findByText('owner@moosemountain.com');

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(api.exportLaunchSignupsCsv).toHaveBeenCalledOnce();
    expect(downloadName).toBe('launch-signups.csv');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:launch-signups');
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  test('a failed export shows the error inline and re-enables the button', async () => {
    vi.mocked(api.exportLaunchSignupsCsv).mockRejectedValue(new Error('HTTP 500'));
    const user = userEvent.setup();
    render(<Signups />);
    await screen.findByText('owner@moosemountain.com');

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });
});
