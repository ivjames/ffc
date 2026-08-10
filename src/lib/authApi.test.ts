import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSession } from './authApi';

// fetchSession must tell "definitively signed out" (401) apart from "couldn't
// tell" (offline / 5xx), so an unreachable check never looks like signed-out.

function mockFetch(status: number, body: unknown = {}): void {
  globalThis.fetch = vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSession', () => {
  it('treats 401 as an authoritative signed-out', async () => {
    mockFetch(401, { ok: false });
    expect(await fetchSession()).toEqual({ user: null, known: true });
  });

  it('treats 200 with a user as an authoritative signed-in', async () => {
    const user = { id: 'u1', email: 'a@b.c', displayName: null, defaultTag: null, emailVerifiedAt: null };
    const s = await (mockFetch(200, { ok: true, user }), fetchSession());
    expect(s.known).toBe(true);
    expect(s.user?.id).toBe('u1');
  });

  it('treats a 5xx as inconclusive (not signed out)', async () => {
    mockFetch(500);
    expect(await fetchSession()).toEqual({ user: null, known: false });
  });

  it('treats a network error as inconclusive (not signed out)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchSession()).toEqual({ user: null, known: false });
  });
});
