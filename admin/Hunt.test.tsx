import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Hunt from './Hunt';
import { api, type HuntCourseRef, type HuntItem, type HuntVenueRef } from './api';

vi.mock('./api', () => ({
  api: {
    listHuntItems: vi.fn(),
    createHuntItem: vi.fn(),
    fetchHuntItemImage: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const COURSES: HuntCourseRef[] = [
  { id: 'c-1', name: 'Western', locationId: 'l-1', locationName: 'Upland' },
  { id: 'c-2', name: 'Blue Course', locationId: 'l-2', locationName: 'Tukwila' },
];

// Two venues covering both course-free states: Upland's list is switched on,
// Tukwila's exists only as an empty, un-switched-on target.
const VENUES: HuntVenueRef[] = [
  { id: 'l-1', name: 'Upland', venueMode: true },
  { id: 'l-2', name: 'Tukwila', venueMode: false },
];

const ITEM: HuntItem = {
  id: 'hi-1',
  courseId: 'c-1',
  ownerLocationId: null,
  slug: 'horseshoe',
  name: 'A hidden horseshoe',
  hint: 'Look around the course',
  extraPrompt: 'Only real horseshoes count.',
  sortOrder: 10,
  active: true,
  countable: true,
  courseName: 'Western',
  locationId: 'l-1',
  locationName: 'Upland',
  imageCount: 2,
  thumbImageId: 'img-1',
};

// The same item shape, owned by a venue instead of a course — the course-free
// hunt's list.
const VENUE_ITEM: HuntItem = {
  ...ITEM,
  id: 'hi-2',
  courseId: null,
  ownerLocationId: 'l-1',
  slug: 'ferris-wheel',
  name: 'The ferris wheel',
  courseName: null,
  countable: false,
  extraPrompt: null,
  imageCount: 0,
  thumbImageId: null,
};

/** The "+ Add item" button inside one group's card, by its heading. */
function addItemIn(heading: RegExp) {
  const h = screen.getByRole('heading', { name: heading });
  return within(h.parentElement as HTMLElement).getByRole('button', { name: '+ Add item' });
}

beforeEach(() => {
  vi.mocked(api.listHuntItems)
    .mockReset()
    .mockResolvedValue({ courses: COURSES, venues: VENUES, items: [ITEM, VENUE_ITEM] });
  vi.mocked(api.createHuntItem).mockReset();
  vi.mocked(api.fetchHuntItemImage).mockReset().mockResolvedValue(new Blob(['x']));
  // jsdom has no createObjectURL; the thumb component calls it on the blob.
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

function renderHunt(isSuperAdmin = false) {
  return render(
    <MemoryRouter>
      <Hunt isSuperAdmin={isSuperAdmin} />
    </MemoryRouter>
  );
}

describe('Hunt', () => {
  test('groups items under venue · course, shows badges, and offers empty courses', async () => {
    renderHunt();
    expect(await screen.findByText('Upland · Western')).toBeInTheDocument();
    expect(screen.getByText('A hidden horseshoe')).toBeInTheDocument();
    expect(screen.getByText('countable')).toBeInTheDocument();
    expect(screen.getByText('extra prompt')).toBeInTheDocument();
    expect(screen.getByText('2 vetting images')).toBeInTheDocument();
    // The item-less course still renders, ready for its first item.
    expect(screen.getByText('Tukwila · Blue Course')).toBeInTheDocument();
    expect(screen.getByText('No items on this course yet.')).toBeInTheDocument();
    // The item row links to the detail editor.
    expect(screen.getByRole('link', { name: /A hidden horseshoe/ })).toHaveAttribute(
      'href',
      '/hunt/items/hi-1'
    );
  });

  test('the vision bench link is super_admin only', async () => {
    renderHunt(false);
    await screen.findByText('Upland · Western');
    expect(screen.queryByText(/Vision bench/)).not.toBeInTheDocument();

    renderHunt(true);
    expect((await screen.findAllByText(/Vision bench/)).length).toBeGreaterThan(0);
  });

  test('adding an item prefills the slug from the name and calls the API', async () => {
    vi.mocked(api.createHuntItem).mockResolvedValue({ ok: true, item: { ...ITEM, id: 'hi-new' } });
    const user = userEvent.setup();
    renderHunt();
    await screen.findByText('Upland · Western');

    await user.click(addItemIn(/Upland · Western/));
    await user.type(screen.getByPlaceholderText('A garden gnome'), "The dragon's egg");
    expect(screen.getByPlaceholderText('gnome')).toHaveValue('the-dragon-s-egg');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(api.createHuntItem).toHaveBeenCalledWith({
        courseId: 'c-1',
        slug: 'the-dragon-s-egg',
        name: "The dragon's egg",
      })
    );
  });

  test('venue-wide lists group separately and lead the courses', async () => {
    renderHunt();
    // The venue's own list, with its item.
    expect(await screen.findByRole('heading', { name: /Upland · venue-wide/ })).toBeInTheDocument();
    expect(screen.getByText('The ferris wheel')).toBeInTheDocument();
    // Its course list is a different group, holding the course item only.
    expect(screen.getByRole('heading', { name: /Upland · Western/ })).toBeInTheDocument();
    expect(screen.getByText('A hidden horseshoe')).toBeInTheDocument();
    // A venue with no venue-wide items yet still offers its own list.
    expect(
      screen.getByRole('heading', { name: /Tukwila · venue-wide/ })
    ).toBeInTheDocument();
    expect(screen.getByText('No venue-wide items yet.')).toBeInTheDocument();
    // Venue lists come first in the page order.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    expect(headings[0]).toMatch(/venue-wide/);
    expect(headings.findIndex((h) => /Western/.test(h))).toBeGreaterThan(
      headings.findIndex((h) => /Tukwila · venue-wide/.test(h))
    );
  });

  test("a venue list that isn't switched on is flagged, and a live one reads live", async () => {
    // Tukwila has items but venueMode off — the case that would otherwise sit
    // finished and invisible to players.
    vi.mocked(api.listHuntItems).mockResolvedValue({
      courses: COURSES,
      venues: VENUES,
      items: [{ ...VENUE_ITEM, id: 'hi-3', ownerLocationId: 'l-2', locationId: 'l-2' }],
    });
    renderHunt();
    expect(await screen.findByText(/not live/)).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  test('adding to a venue list sends locationId, not courseId', async () => {
    vi.mocked(api.createHuntItem).mockResolvedValue({
      ok: true,
      item: { ...VENUE_ITEM, id: 'hi-new' },
    });
    const user = userEvent.setup();
    renderHunt();
    await screen.findByRole('heading', { name: /Upland · venue-wide/ });

    await user.click(addItemIn(/Upland · venue-wide/));
    await user.type(screen.getByPlaceholderText('A garden gnome'), 'The big slide');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(api.createHuntItem).toHaveBeenCalledWith({
        locationId: 'l-1',
        slug: 'the-big-slide',
        name: 'The big slide',
      })
    );
  });
});
