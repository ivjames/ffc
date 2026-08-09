import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Hunt from './Hunt';
import { api, type HuntCourseRef, type HuntItem } from './api';

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

const ITEM: HuntItem = {
  id: 'hi-1',
  courseId: 'c-1',
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

beforeEach(() => {
  vi.mocked(api.listHuntItems).mockReset().mockResolvedValue({ courses: COURSES, items: [ITEM] });
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

    await user.click(screen.getAllByRole('button', { name: '+ Add item' })[0]);
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
});
