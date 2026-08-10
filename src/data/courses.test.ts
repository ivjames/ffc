import { describe, it, expect, afterEach, vi } from 'vitest';
import { isValidContent, hydrateContent, locationById } from './courses';

// The content store: shape-guarding /api/content and live-hydrating locations
// (incl. POS config) without a redeploy, with the baked copy as the fallback.

describe('isValidContent', () => {
  it('accepts a well-formed catalog', () => {
    expect(
      isValidContent({
        locations: [{ id: 'a', name: 'Upland' }],
        courses: [{ id: 'c', pars: [3, 3] }],
      }),
    ).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(isValidContent(null)).toBe(false);
    expect(isValidContent({ locations: [], courses: 'nope' })).toBe(false);
    expect(isValidContent({ locations: [{ name: 'no id' }], courses: [] })).toBe(false);
    expect(isValidContent({ locations: [{ id: 'a', name: 'x' }], courses: [{ id: 'c' }] })).toBe(
      false, // course missing pars[]
    );
  });

  it('rejects an empty location catalog (would crash LOCATIONS[0] fallback)', () => {
    expect(isValidContent({ locations: [], courses: [] })).toBe(false);
  });
});

describe('hydrateContent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('swaps in live POS config from /api/content', async () => {
    const live = {
      locations: [
        {
          id: 'live-loc',
          name: 'Upland',
          slug: 'upland',
          lat: null,
          lng: null,
          geofenceKm: null,
          sortOrder: 0,
          menuUrl: null,
          orderingUrl: null,
          pos: {
            ordering: { vendor: 'centeredge', apiBase: null },
            loyalty: { vendor: 'centeredge', apiBase: null, gameRewards: true },
          },
        },
      ],
      courses: [{ id: 'live-course', locationId: 'live-loc', name: 'Blue', theme: 'blue', pars: Array(18).fill(3) }],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(live), { status: 200 }),
    );

    expect(locationById('live-loc')).toBeUndefined(); // not in baked content
    await hydrateContent();
    expect(locationById('live-loc')?.pos?.loyalty?.gameRewards).toBe(true);
  });

  it('keeps existing content when the fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const before = locationById('live-loc'); // whatever the prior test left
    await hydrateContent();
    expect(locationById('live-loc')).toEqual(before); // unchanged, no throw
  });
});
