// The challenge client's invite path. The endpoint is the only way a challenge
// code reaches someone who isn't in the room, so what matters is what goes on
// the wire — and that a failed send arrives as a failure the screen can act on
// rather than a silent success (the code is still on screen; the player needs
// to know to read it out instead).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inviteToChallenge } from './challengesApi';

function mockFetch(response: unknown, { ok = true, status = 200 } = {}) {
  const fn = vi.fn(async () => ({ ok, status, json: async () => response }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('inviteToChallenge', () => {
  it('POSTs the address to the challenge it belongs to', async () => {
    const fetchMock = mockFetch({ ok: true });

    const res = await inviteToChallenge('chal-1', 'rival@example.com');

    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/challenges/chal-1/invite');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'rival@example.com' });
    // The session cookie is what proves this caller is the challenger.
    expect(init.credentials).toBe('include');
  });

  it("surfaces the server's reason and status so the screen can offer the fallback", async () => {
    mockFetch({ ok: false, error: 'someone already took this challenge' }, { ok: false, status: 409 });

    const res = await inviteToChallenge('chal-1', 'rival@example.com');

    expect(res).toMatchObject({ ok: false, status: 409, error: 'someone already took this challenge' });
  });

  it('reports being offline distinctly, since the code can still be read aloud', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;

    const res = await inviteToChallenge('chal-1', 'rival@example.com');

    expect(res).toMatchObject({ ok: false, status: 0, error: 'offline' });
  });
});
