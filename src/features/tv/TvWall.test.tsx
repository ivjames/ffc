// @vitest-environment jsdom
// The TV wall on a tenant with no branding: it must render entirely from
// neutral chrome — no logo (there is no platform default logo to fall back
// to), no /brand/ asset references, and a generic title when the catalog
// hasn't hydrated yet. The wall is a fire-and-forget screen on a TV stick, so
// a broken-image flash would sit there all day.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TvWall from './TvWall';
import { setOrg } from '../../lib/branding';

vi.mock('../../sync', () => ({
  fetchCourseBoards: vi.fn().mockResolvedValue({ courses: [] }),
  courseBoardsStreamUrl: () => 'http://localhost/api/leaderboard/wall/stream',
}));
// The banner polls /api/announcements on its own — out of scope here.
vi.mock('../../ui/AnnouncementBanner', () => ({ default: () => null }));

// jsdom has no EventSource; the wall only needs the constructor surface.
class FakeEventSource {
  addEventListener() {}
  close() {}
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  setOrg(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TvWall without tenant branding', () => {
  it('renders logo-free neutral chrome — no images, no /brand/ assets', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/tv/wall']}>
        <TvWall />
      </MemoryRouter>,
    );
    // Empty catalog (no-cache boot) → the generic header, not a venue name.
    expect(await screen.findByText(/Mini Golf Leaderboard/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('/brand/');
    expect(container.innerHTML).not.toMatch(/bullwinkle/i);
  });
});
