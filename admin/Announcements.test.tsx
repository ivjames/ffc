import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Announcements from './Announcements';
import { api, type Announcement, type Location } from './api';

vi.mock('./api', () => ({
  api: {
    listAnnouncements: vi.fn(),
    listLocations: vi.fn(),
    saveAnnouncement: vi.fn(),
    archiveAnnouncement: vi.fn(),
  },
}));

const LOCATIONS = [
  { id: 'loc-1', name: 'Upland' } as Location,
  { id: 'loc-2', name: 'Tukwila' } as Location,
];

const ROWS: Announcement[] = [
  {
    id: 'ann-1',
    title: 'Taco Tuesday',
    body: 'Half-price tacos',
    locationId: null,
    startsAt: null,
    endsAt: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'ann-2',
    title: 'Upland league night',
    body: null,
    locationId: 'loc-1',
    locationName: 'Upland',
    startsAt: null,
    endsAt: '2020-01-01T00:00:00Z', // window closed -> "Ended"
    sortOrder: 0,
    archivedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
  },
];

beforeEach(() => {
  vi.mocked(api.listAnnouncements).mockReset().mockResolvedValue(ROWS);
  vi.mocked(api.listLocations).mockReset().mockResolvedValue(LOCATIONS);
  vi.mocked(api.saveAnnouncement).mockReset();
  vi.mocked(api.archiveAnnouncement).mockReset();
});

describe('Announcements', () => {
  test('lists rows with scope and window state', async () => {
    render(<Announcements isSuperAdmin={true} />);
    expect(await screen.findByText('Taco Tuesday')).toBeInTheDocument();
    // "All locations" appears both as the form's select option and the global
    // row's scope label — assert on the row label specifically.
    expect(
      screen.getAllByText('All locations').some((el) => el.tagName === 'SPAN')
    ).toBe(true);
    expect(screen.getAllByText('Upland').some((el) => el.tagName === 'SPAN')).toBe(true);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();
  });

  test('publishing calls api.saveAnnouncement with title and null location for "All locations"', async () => {
    vi.mocked(api.saveAnnouncement).mockResolvedValue({ ok: true, announcement: ROWS[0] });
    const user = userEvent.setup();
    render(<Announcements isSuperAdmin={true} />);
    await screen.findByText('Taco Tuesday');

    await user.type(screen.getByPlaceholderText('Taco Tuesday'), 'New special');
    await user.click(screen.getByRole('button', { name: 'Publish announcement' }));

    await waitFor(() =>
      expect(api.saveAnnouncement).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New special', locationId: null })
      )
    );
  });

  test('org_admin gets no "All locations" option — announcements pin to a venue', async () => {
    render(<Announcements isSuperAdmin={false} />);
    await screen.findByText('Taco Tuesday');
    const select = screen.getByRole('combobox');
    expect(select).not.toHaveTextContent('All locations');
    expect(select).toHaveTextContent('Upland');
  });

  test('archive button calls api.archiveAnnouncement', async () => {
    vi.mocked(api.archiveAnnouncement).mockResolvedValue({ ok: true, announcement: ROWS[0] });
    const user = userEvent.setup();
    render(<Announcements isSuperAdmin={true} />);
    await screen.findByText('Taco Tuesday');

    await user.click(screen.getAllByRole('button', { name: 'Archive' })[0]);
    await waitFor(() => expect(api.archiveAnnouncement).toHaveBeenCalledWith('ann-1', true));
  });
});
