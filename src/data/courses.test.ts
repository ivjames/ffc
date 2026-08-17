// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isValidContent,
  hydrateContent,
  isTenantUnavailable,
  locationById,
  coursesByLocation,
  LOCATIONS,
} from './courses';
import { getOrg, getBranding, hasExplicitThemeColor } from '../lib/branding';
import { getCurrentLocationId } from '../lib/location';
import { detectNearestLocation } from '../lib/geolocate';

// The content store: shape-guarding /api/content and live-hydrating locations
// (incl. POS config) without a redeploy, with the baked copy as the fallback.
// jsdom so hydration's localStorage cache + theme-color meta are exercised.

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

  it('rejects an empty catalog only when it lacks the org key (legacy/garbled)', () => {
    expect(isValidContent({ locations: [], courses: [] })).toBe(false);
    // The tenant-aware shape (MULTI-VENUE.md §3) always carries `org` — an
    // empty catalog is then a real state (brand-new org, all venues archived)
    // and must be accepted, or the previous tenant's catalog would stick.
    expect(
      isValidContent({
        locations: [],
        courses: [],
        org: { id: 'o', slug: 'fresh', name: 'Fresh Org', branding: {} },
      }),
    ).toBe(true);
    // `org: null` (server resolved no tenant) still counts as tenant-aware.
    expect(isValidContent({ locations: [], courses: [], org: null })).toBe(true);
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

// Finding: the wire branding is SPARSE (only stored keys) so the client can
// tell an explicit themeColor from its own default — the explicit one owns the
// theme-color meta; without it the mode greys do (see src/lib/branding.ts).
describe('branding explicitness through hydration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function payload(branding: Record<string, string>) {
    return {
      org: { id: 'org-acme', slug: 'acme', name: 'Acme Golf', branding },
      locations: [{ id: 'acme-loc', name: 'Acme Park', slug: 'acme-park', sortOrder: 0 }],
      courses: [],
    };
  }
  function metaContent(): string | null {
    return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;
  }

  it('hydrating an org with {} branding leaves the mode greys in charge', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload({})), { status: 200 }),
    );
    await hydrateContent();
    expect(getOrg()?.slug).toBe('acme');
    expect(hasExplicitThemeColor()).toBe(false);
    // No data-theme attr and no light-mode match in jsdom → the dark grey.
    expect(metaContent()).toBe('#2f2f2f');
    // The client-side default still resolves for everything else.
    expect(getBranding().themeColor).toBe('#15803d');
  });

  it('hydrating an org with an explicit themeColor pins the meta to it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload({ themeColor: '#123abc' })), { status: 200 }),
    );
    await hydrateContent();
    expect(hasExplicitThemeColor()).toBe(true);
    expect(metaContent()).toBe('#123abc');
  });
});

// Finding: a tenant with zero live locations (brand-new org, or everything
// archived) must still hydrate — discarding the payload would leave ANOTHER
// tenant's cached venues and branding on this tenant's subdomain — and the
// zero-location state must not crash the LOCATIONS[0]-style fallbacks.
describe('zero-location tenant (un-onboarded org)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('empty catalog + org replaces a previously cached non-empty catalog (the leak case)', async () => {
    // The describes above left another org's venue ('acme-loc') live + cached.
    expect(locationById('acme-loc')).toBeDefined();
    const empty = {
      org: { id: 'org-fresh', slug: 'fresh', name: 'Fresh Org', branding: {} },
      locations: [],
      courses: [],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(empty), { status: 200 }),
    );
    await hydrateContent();

    expect(LOCATIONS).toEqual([]); // the other tenant's venues are gone
    expect(locationById('acme-loc')).toBeUndefined();
    expect(getOrg()?.slug).toBe('fresh'); // branding travelled with the catalog
    // The cache was replaced too, so an offline reload can't resurrect the leak.
    expect(JSON.parse(localStorage.getItem('ffc.content')!)).toEqual(empty);
  });

  it('zero-location fallbacks compute without throwing', async () => {
    expect(LOCATIONS).toEqual([]); // state left by the leak test above
    expect(getCurrentLocationId()).toBe(''); // matches nothing, crashes nothing
    expect(locationById(getCurrentLocationId())).toBeUndefined();
    expect(coursesByLocation(getCurrentLocationId())).toEqual([]);
  });

  it('GPS detection bails out before prompting when there is nothing to match', async () => {
    // Stub a working geolocation stack so only the empty catalog can bail.
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    vi.stubGlobal('isSecureContext', true);
    await expect(detectNearestLocation()).resolves.toEqual({ status: 'unavailable' });
    expect(getCurrentPosition).not.toHaveBeenCalled(); // no wasted permission prompt
  });
});

// Finding: the tenant dead-end flag (MULTI-VENUE.md §1/§3). The dark sentinel
// (unknown platform subdomain, suspended org) answers `unavailable: true` and
// ONLY it does — the store must set the flag on that payload, persist it in
// the ffc.content cache (repeat visits dead-end with no flash of the empty
// app), and CLEAR it on any later flagless hydrate (org unsuspended, org
// created for the slug). A real org's empty catalog must never trip it.
describe('tenant dead-end flag (unavailable)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const dark = { unavailable: true, org: null, locations: [], courses: [] };

  it('hydrating the dark payload sets the flag and caches it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(dark), { status: 200 }),
    );
    await hydrateContent();
    expect(isTenantUnavailable()).toBe(true);
    expect(LOCATIONS).toEqual([]);
    expect(JSON.parse(localStorage.getItem('ffc.content')!).unavailable).toBe(true);
  });

  it('a later flagless hydrate clears it — org unsuspended / created', async () => {
    const restored = {
      org: { id: 'org-back', slug: 'backco', name: 'Back Co', branding: {} },
      locations: [{ id: 'back-1', name: 'Back Park', slug: 'back-park', sortOrder: 0 }],
      courses: [],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(restored), { status: 200 }),
    );
    await hydrateContent();
    expect(isTenantUnavailable()).toBe(false);
    expect(LOCATIONS.map((l) => l.name)).toEqual(['Back Park']);
    // The cache is flagless again too, so the next boot doesn't dead-end.
    expect('unavailable' in JSON.parse(localStorage.getItem('ffc.content')!)).toBe(false);
  });

  it("a real org's EMPTY catalog does not trip it (onboarding, not dead)", async () => {
    const emptyReal = {
      org: { id: 'org-new', slug: 'newco', name: 'New Co', branding: {} },
      locations: [],
      courses: [],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(emptyReal), { status: 200 }),
    );
    await hydrateContent();
    expect(isTenantUnavailable()).toBe(false);
    expect(LOCATIONS).toEqual([]);
  });

  it('boots true from a cached dark payload, false from a malformed flag', async () => {
    // Fresh module graphs so the at-import boot path reads each cache shape.
    vi.resetModules();
    localStorage.setItem('ffc.content', JSON.stringify(dark));
    let mod = await import('./courses');
    expect(mod.isTenantUnavailable()).toBe(true);

    // Only a literal `true` counts — a stale/garbled cache must not dead-end.
    vi.resetModules();
    localStorage.setItem(
      'ffc.content',
      JSON.stringify({ unavailable: 'yes', org: null, locations: [], courses: [] }),
    );
    mod = await import('./courses');
    expect(mod.isTenantUnavailable()).toBe(false);

    localStorage.clear();
    vi.resetModules();
  });
});

// Finding: first-paint isolation. The baked GENERATED_* snapshot is the
// DEFAULT org's catalog + org; booting it on a never-hydrated origin (fresh
// client subdomain, first visit) flashed another tenant's venues and branding
// until /api/content answered. A no-cache boot must start EMPTY — safe because
// a first visit can't be offline (no service worker yet) and the zero-location
// guards above cover the brief empty state — while a cached origin boots from
// its cache exactly as before. Each test re-imports the module graph fresh so
// the at-import boot path itself is what's exercised.
describe('boot: no-cache origins never see the baked snapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.resetModules();
  });

  async function freshBoot() {
    vi.resetModules();
    const courses = await import('./courses');
    const branding = await import('../lib/branding');
    return { courses, branding };
  }

  it('no ffc.content cache → empty catalog and no org, not the snapshot', async () => {
    localStorage.clear();
    // The snapshot has real content — proves empty-boot is a choice, not luck.
    const gen = await import('./content.generated');
    expect(gen.GENERATED_LOCATIONS.length).toBeGreaterThan(0);

    const { courses, branding } = await freshBoot();
    expect(courses.LOCATIONS).toEqual([]);
    expect(courses.COURSES).toEqual([]);
    expect(branding.getOrg()).toBeNull(); // snapshot org must not leak either
    expect(branding.getBranding().shareFooter).toBe('Come beat this score');
  });

  it('the first successful hydrate populates and caches the empty boot', async () => {
    localStorage.clear();
    const { courses, branding } = await freshBoot();
    expect(courses.LOCATIONS).toEqual([]);

    const live = {
      org: { id: 'org-live', slug: 'liveco', name: 'Live Co', branding: {} },
      locations: [{ id: 'live-1', name: 'Live Park', slug: 'live-park', sortOrder: 0 }],
      courses: [],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(live), { status: 200 }),
    );
    await courses.hydrateContent();

    expect(courses.LOCATIONS.map((l) => l.name)).toEqual(['Live Park']);
    expect(branding.getOrg()?.slug).toBe('liveco');
    expect(JSON.parse(localStorage.getItem('ffc.content')!)).toEqual(live);
  });

  it('a cached origin still boots straight from its cache (unchanged path)', async () => {
    localStorage.setItem(
      'ffc.content',
      JSON.stringify({
        org: { id: 'org-c', slug: 'cachedco', name: 'Cached Co', branding: { shareFooter: 'Cached!' } },
        locations: [{ id: 'cached-1', name: 'Cached Park', slug: 'cached-park', sortOrder: 0 }],
        courses: [],
      }),
    );
    const { courses, branding } = await freshBoot();
    expect(courses.LOCATIONS.map((l) => l.name)).toEqual(['Cached Park']);
    expect(branding.getOrg()?.slug).toBe('cachedco');
    expect(branding.getBranding().shareFooter).toBe('Cached!');
  });
});

// Codex finding on #197: if the flagless (recovered) payload can't be written
// (quota), the old `unavailable: true` cache entry must not survive to
// resurrect the dead-end on the next boot — hydrateContent drops it outright.
describe('dead-end recovery under storage quota', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a failed recovery cache write still clears the stale dead-end marker', async () => {
    localStorage.setItem(
      'ffc.content',
      JSON.stringify({ locations: [], courses: [], org: null, unavailable: true }),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ org: null, locations: [], courses: [] }), { status: 200 }),
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    await hydrateContent();
    expect(isTenantUnavailable()).toBe(false);
    expect(localStorage.getItem('ffc.content')).toBeNull();
  });
});
