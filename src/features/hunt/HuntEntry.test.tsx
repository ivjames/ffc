// @vitest-environment jsdom
// /hunt is shared: the course-free venue hunt claims it where a venue runs one,
// and it forwards to /golf/hunt everywhere else so the pre-renamespace links
// (printed QRs, muscle memory) keep working. The cold-start case is the one
// that matters most — a hunt-only venue's own QR is exactly the link most
// likely to be opened with no cached catalog.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LocationSeed } from '../../types';

const VENUE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// The catalog is module state in the real app; here it's a mock we can empty
// (cold start) or fill (hydrated).
let catalog: LocationSeed[] = [];

vi.mock('../../data/courses', () => ({
  locationById: (id: string) => catalog.find((l) => l.id === id),
  useContentRevision: () => 0,
  courseById: () => undefined,
}));

vi.mock('../../lib/location', () => ({
  useCurrentLocationId: () => (catalog.length > 0 ? VENUE_ID : ''),
}));

// The hunt screen itself is exercised elsewhere; here we only care WHICH
// thing /hunt renders.
vi.mock('./Hunt', () => ({
  default: ({ mode }: { mode?: string }) => <div>hunt screen: {mode}</div>,
}));

const venue = (over: Partial<LocationSeed> = {}): LocationSeed => ({
  id: VENUE_ID,
  name: 'Test Venue',
  slug: 'test-venue',
  accent: '#000000',
  lat: 0,
  lng: 0,
  ...over,
});

async function renderEntry() {
  const { default: HuntEntry } = await import('./HuntEntry');
  return render(
    <MemoryRouter initialEntries={['/hunt']}>
      <Routes>
        <Route path="/hunt" element={<HuntEntry />} />
        <Route path="/golf/hunt" element={<div>on-course hunt</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  catalog = [];
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HuntEntry', () => {
  it('serves the venue hunt where the venue runs one', async () => {
    catalog = [venue({ venueHunt: true })];
    await renderEntry();
    expect(await screen.findByText('hunt screen: venue')).toBeInTheDocument();
  });

  it('forwards to the on-course hunt where the venue does not', async () => {
    catalog = [venue({ venueHunt: false })];
    await renderEntry();
    expect(await screen.findByText('on-course hunt')).toBeInTheDocument();
  });

  it('waits for the catalog instead of forwarding on a cold start', async () => {
    vi.useFakeTimers();
    // No cached catalog yet — the venue does not resolve.
    await renderEntry();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('on-course hunt')).not.toBeInTheDocument();
  });

  it('forwards once the wait runs out with no catalog (offline, no cache)', async () => {
    vi.useFakeTimers();
    await renderEntry();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('on-course hunt')).toBeInTheDocument());
  });
});
