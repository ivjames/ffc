import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Photos from './Photos';
import { api, type Photo } from './api';

vi.mock('./api', () => ({
  api: {
    listPhotos: vi.fn(),
    fetchPhotoBlob: vi.fn(),
    approvePhoto: vi.fn(),
    rejectPhoto: vi.fn(),
  },
}));

const STORED: Photo = {
  id: 'ph-1',
  playerTag: 'ABC',
  roundClientId: 'round-1',
  verified: true,
  moderation: null, // legacy pre-moderation photo
  moderationReason: null,
  peoplePresent: true,
  minorsPresent: true,
  hasPhoto: true,
  createdAt: '2026-08-07T00:00:00Z',
  itemName: 'The windmill',
  courseName: 'Green Course',
  locationName: 'Upland',
};

const BLOCKED: Photo = {
  ...STORED,
  id: 'ph-2',
  verified: false,
  moderation: 'flagged',
  moderationReason: 'obscene gesture',
  hasPhoto: false,
  itemName: 'The castle',
};

beforeEach(() => {
  vi.mocked(api.listPhotos).mockReset().mockResolvedValue([STORED, BLOCKED]);
  vi.mocked(api.fetchPhotoBlob)
    .mockReset()
    .mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  vi.mocked(api.approvePhoto).mockReset();
  vi.mocked(api.rejectPhoto).mockReset();
  // jsdom doesn't implement object URLs at all — stub them on.
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

describe('Photos', () => {
  test('renders queue rows with moderation state and people/minors flags', async () => {
    render(<Photos />);
    expect(await screen.findByText('The windmill')).toBeInTheDocument();
    expect(screen.getByText('Unreviewed')).toBeInTheDocument();
    // "People"/"Minors" also exist as filter buttons — assert on the row pills.
    expect(screen.getAllByText('People').some((el) => el.tagName === 'SPAN')).toBe(true);
    expect(screen.getAllByText('Minors').some((el) => el.tagName === 'SPAN')).toBe(true);
    // The blocked-at-upload event shows its reason and no action buttons.
    expect(screen.getByText('obscene gesture')).toBeInTheDocument();
    expect(screen.getByText(/blocked at/)).toBeInTheDocument();
    expect(api.listPhotos).toHaveBeenCalledWith('review');
  });

  test('filter buttons refetch with the chosen filter', async () => {
    const user = userEvent.setup();
    render(<Photos />);
    await screen.findByText('The windmill');
    await user.click(screen.getByRole('button', { name: 'Minors' }));
    await waitFor(() => expect(api.listPhotos).toHaveBeenCalledWith('minors'));
  });

  test('approve calls the API and reloads', async () => {
    vi.mocked(api.approvePhoto).mockResolvedValue({ ok: true, id: 'ph-1', moderation: 'approved' });
    const user = userEvent.setup();
    render(<Photos />);
    await screen.findByText('The windmill');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.approvePhoto).toHaveBeenCalledWith('ph-1'));
    await waitFor(() => expect(api.listPhotos).toHaveBeenCalledTimes(2));
  });

  test('reject asks for confirmation before deleting', async () => {
    vi.mocked(api.rejectPhoto).mockResolvedValue({ ok: true, id: 'ph-1', moderation: 'rejected' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<Photos />);
    await screen.findByText('The windmill');

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(api.rejectPhoto).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.rejectPhoto).toHaveBeenCalledWith('ph-1'));
  });
});
