// The shared session store. The behaviour under test is the one the account
// gate depends on: an inconclusive check (offline, 5xx) must leave the last
// authoritative answer standing rather than downgrading a signed-in player to
// signed-out, and concurrent callers must share one request.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionCheck } from './authApi';

const fetchSession = vi.fn<() => Promise<SessionCheck>>();
vi.mock('./authApi', () => ({ fetchSession: () => fetchSession() }));

const USER = {
  id: 'u1',
  email: 'sam@example.com',
  displayName: 'Sam',
  defaultTag: 'SAM',
  emailVerifiedAt: '2026-01-01T00:00:00Z',
};

// The store caches at module scope, so each test needs a fresh graph.
async function freshStore() {
  vi.resetModules();
  return import('./session');
}

describe('session store', () => {
  beforeEach(() => {
    fetchSession.mockReset();
  });

  it('records an authoritative signed-in answer', async () => {
    const store = await freshStore();
    fetchSession.mockResolvedValue({ user: USER, known: true });
    const state = await store.refreshSession();
    expect(state.user?.email).toBe('sam@example.com');
    expect(state.known).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('records an authoritative signed-out answer', async () => {
    const store = await freshStore();
    fetchSession.mockResolvedValue({ user: null, known: true });
    const state = await store.refreshSession();
    expect(state.user).toBeNull();
    expect(state.known).toBe(true);
  });

  it('keeps a known-good user when a later check is inconclusive', async () => {
    const store = await freshStore();
    fetchSession.mockResolvedValue({ user: USER, known: true });
    await store.refreshSession();

    // Now the network drops: `known` false, no user. The signed-in player must
    // stay signed in — this is what stops the gate flashing a sign-in wall.
    fetchSession.mockResolvedValue({ user: null, known: false });
    const state = await store.refreshSession();
    expect(state.user?.email).toBe('sam@example.com');
    expect(state.known).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('leaves the session unknown when the very first check is inconclusive', async () => {
    const store = await freshStore();
    fetchSession.mockResolvedValue({ user: null, known: false });
    const state = await store.refreshSession();
    expect(state.user).toBeNull();
    expect(state.known).toBe(false);
    expect(state.loading).toBe(false);
  });

  it('de-duplicates concurrent refreshes onto one request', async () => {
    const store = await freshStore();
    fetchSession.mockResolvedValue({ user: USER, known: true });
    await Promise.all([store.refreshSession(), store.refreshSession(), store.refreshSession()]);
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });

  it('setSessionUser publishes a known answer without a round-trip', async () => {
    const store = await freshStore();
    store.setSessionUser(USER);
    expect(store.getSession()).toEqual({ user: USER, known: true, loading: false });
    store.setSessionUser(null);
    expect(store.getSession()).toEqual({ user: null, known: true, loading: false });
    expect(fetchSession).not.toHaveBeenCalled();
  });
});
