// @vitest-environment jsdom
// The tenant dead-end gate (MULTI-VENUE.md §1/§3): when /api/content marks the
// host `unavailable: true` (unknown/typo platform subdomain, suspended org),
// the app root renders the TenantUnavailable page INSTEAD of the router — no
// nav, no home dashboard — and a cached flag dead-ends the very first paint of
// a repeat visit. A flagless payload restores the full app.
//
// Every test boots a FRESH module graph (vi.resetModules) so the content
// store's at-import cache read is exercised, then renders the real <App/>.
// React, the DOM renderer, and the router are imported from the SAME fresh
// registry — mixing the test file's static copies with the reset graph would
// split React in two and break hooks — which is why this file renders via
// createElement instead of JSX (JSX would compile to the STATIC jsx-runtime).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// UpdateModal pulls in src/pwa.ts, whose `virtual:pwa-register` import only
// exists under the VitePWA build plugin — stub the module for tests. (The
// mock registry survives vi.resetModules, so every fresh graph gets it.)
vi.mock('./pwa', () => ({
  registerPwa: () => {},
  reloadForUpdate: async () => {},
}));

// jsdom has no indexedDB; Home's resume-round check would reject unhandled.
// Keep the rest of the db module real (nothing else runs on these routes) and
// answer "no active round".
vi.mock('./db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./db')>();
  return { ...mod, getActiveRound: async () => undefined };
});

// __BUILD_ID__/__BUILD_TIME__ are Vite `define`s (vite.config.ts) that vitest
// doesn't apply; at runtime the free identifiers fall through to globalThis,
// so stubs there keep the dev chrome (BuildStamp/UpdateModal) mountable.
(globalThis as Record<string, unknown>).__BUILD_ID__ = 'test';
(globalThis as Record<string, unknown>).__BUILD_TIME__ = 'test';

// jsdom ships no matchMedia; the mounted tree touches it (install detection,
// mode/haptics listeners). A minimal always-false stub keeps the real modules
// in play — no media query needs to match for any of these tests.
window.matchMedia = ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

const DEAD_END = /no venue at this address/i;
const HOME_PROMPT = /what do you want to do\?/i;

const DARK = { unavailable: true, org: null, locations: [], courses: [] };
const LIVE = {
  org: { id: 'org-live', slug: 'liveco', name: 'Live Co', branding: {} },
  locations: [{ id: 'live-1', name: 'Live Park', slug: 'live-park', sortOrder: 0 }],
  courses: [],
};
const EMPTY_REAL = {
  org: { id: 'org-new', slug: 'newco', name: 'New Co', branding: {} },
  locations: [],
  courses: [],
};

// URL-aware fetch mock: /api/content answers the given payload; every other
// endpoint the mounted tree touches (auth session, announcements, health) gets
// a 404, which each caller already treats as "no data" (their offline paths).
function mockApi(contentPayload: unknown) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/content')) {
      return Promise.resolve(new Response(JSON.stringify(contentPayload), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
}

type Rtl = typeof import('@testing-library/react');
let rtl: Rtl | null = null;

async function bootApp() {
  vi.resetModules();
  const [{ createElement }, freshRtl, { MemoryRouter }, appMod] = await Promise.all([
    import('react'),
    import('@testing-library/react'),
    import('react-router-dom'),
    import('./App'),
  ]);
  rtl = freshRtl;
  const view = freshRtl.render(
    createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(appMod.default)),
  );
  return { view, waitFor: freshRtl.waitFor, screen: freshRtl.screen };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  rtl?.cleanup();
  rtl = null;
  vi.restoreAllMocks();
  vi.resetModules();
  localStorage.clear();
});

describe('App tenant dead-end gate', () => {
  it('hydrating the dark payload swaps the app for the dead-end page', async () => {
    mockApi(DARK);
    const { screen, waitFor } = await bootApp();
    // First-ever visit: no cache, so the normal empty app boots until the
    // hydrate answers (the acceptable one-time flash) — then the dead-end.
    await waitFor(() => {
      expect(screen.getByText(DEAD_END)).toBeTruthy();
    });
    // Nothing app-like mounts alongside it: no home dashboard, no nav tiles.
    expect(screen.queryByText(HOME_PROMPT)).toBeNull();
    expect(screen.queryByText('Arcade')).toBeNull();
    // The flag was cached, so the next visit skips the flash entirely.
    expect(JSON.parse(localStorage.getItem('ffc.content')!).unavailable).toBe(true);
  });

  it('a cached flag boots straight to the dead-end — no flash of the app', async () => {
    localStorage.setItem('ffc.content', JSON.stringify(DARK));
    mockApi(DARK);
    const { screen } = await bootApp();
    // Synchronously on first paint, before any fetch resolves.
    expect(screen.getByText(DEAD_END)).toBeTruthy();
    expect(screen.queryByText(HOME_PROMPT)).toBeNull();
  });

  it('a later flagless hydrate restores the app (org unsuspended / created)', async () => {
    localStorage.setItem('ffc.content', JSON.stringify(DARK));
    mockApi(LIVE);
    const { screen, waitFor } = await bootApp();
    expect(screen.getByText(DEAD_END)).toBeTruthy(); // dead-ended from cache…
    await waitFor(() => {
      expect(screen.getByText(HOME_PROMPT)).toBeTruthy(); // …until the live payload lands
    });
    expect(screen.queryByText(DEAD_END)).toBeNull();
    expect('unavailable' in JSON.parse(localStorage.getItem('ffc.content')!)).toBe(false);
  });

  it("a real org's empty catalog keeps the normal app, not the dead-end", async () => {
    mockApi(EMPTY_REAL);
    const { screen, waitFor } = await bootApp();
    // Wait for the hydrate to land (it caches the payload when it does).
    await waitFor(() => {
      expect(localStorage.getItem('ffc.content')).toBeTruthy();
    });
    expect(screen.queryByText(DEAD_END)).toBeNull();
    expect(screen.getByText(HOME_PROMPT)).toBeTruthy(); // empty states, live app
  });
});
