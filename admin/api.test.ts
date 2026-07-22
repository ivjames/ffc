// Unit tests for the api.ts fetch wrapper — specifically the 401 handling
// that had a real bug (masked the server's actual error message behind a
// generic "unauthorized", and fired the global sign-out event for a normal
// failed login attempt), caught only by manual browser testing. These tests
// exercise that logic directly, with a mocked fetch, so it doesn't need a
// real server or a browser to catch a regression.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, getToken, setToken, clearToken, AuthError, ApiError } from './api';

function mockFetchOnce(status: number, body: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      text: () => Promise.resolve(text),
    })
  );
}

beforeEach(() => {
  clearToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request auth headers', () => {
  test('sends the sessionStorage token as x-app-token, empty string when unset', async () => {
    mockFetchOnce(200, { ok: true, totals: {}, perLocation: [] });
    await api.overview();
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['x-app-token']).toBe('');
  });

  test('sends the current token once set', async () => {
    setToken('my-token');
    mockFetchOnce(200, { ok: true, totals: {}, perLocation: [] });
    await api.overview();
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['x-app-token']).toBe('my-token');
  });

  test('sends credentials: same-origin so the session cookie round-trips', async () => {
    mockFetchOnce(200, { ok: true, totals: {}, perLocation: [] });
    await api.overview();
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.credentials).toBe('same-origin');
  });

  test('requests hit /api/admin<path>', async () => {
    mockFetchOnce(200, { ok: true, totals: {}, perLocation: [] });
    await api.overview();
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/admin/overview');
  });
});

describe('401 handling (default — NOT quiet)', () => {
  test('a normal 401 dispatches the global sign-out event', async () => {
    const onUnauthorized = vi.fn();
    window.addEventListener('ffc-admin-unauthorized', onUnauthorized);
    mockFetchOnce(401, { ok: false, error: 'unauthorized' });
    await expect(api.overview()).rejects.toThrow(AuthError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    window.removeEventListener('ffc-admin-unauthorized', onUnauthorized);
  });

  test('AuthError carries the real server message, not a generic one', async () => {
    mockFetchOnce(401, { ok: false, error: 'token expired' });
    await expect(api.overview()).rejects.toThrow('token expired');
  });

  test('falls back to a generic message when the server sends no error field', async () => {
    mockFetchOnce(401, undefined);
    await expect(api.overview()).rejects.toThrow('unauthorized');
  });
});

describe('401 handling for login/me (quiet401 — the bug this regresses)', () => {
  test('login: a wrong-password 401 does NOT dispatch the global sign-out event', async () => {
    const onUnauthorized = vi.fn();
    window.addEventListener('ffc-admin-unauthorized', onUnauthorized);
    mockFetchOnce(401, { ok: false, error: 'invalid email or password' });
    await expect(api.login('a@b.com', 'wrong')).rejects.toThrow(AuthError);
    expect(onUnauthorized).not.toHaveBeenCalled();
    window.removeEventListener('ffc-admin-unauthorized', onUnauthorized);
  });

  test('login: the real "invalid email or password" message surfaces, not "unauthorized"', async () => {
    mockFetchOnce(401, { ok: false, error: 'invalid email or password' });
    await expect(api.login('a@b.com', 'wrong')).rejects.toThrow('invalid email or password');
  });

  test('me: a 401 (not logged in) does not dispatch the global event either', async () => {
    const onUnauthorized = vi.fn();
    window.addEventListener('ffc-admin-unauthorized', onUnauthorized);
    mockFetchOnce(401, { ok: false, error: 'unauthorized' });
    await expect(api.me()).rejects.toThrow(AuthError);
    expect(onUnauthorized).not.toHaveBeenCalled();
    window.removeEventListener('ffc-admin-unauthorized', onUnauthorized);
  });
});

describe('non-401 errors', () => {
  test('a 403 throws ApiError with the server message', async () => {
    mockFetchOnce(403, { ok: false, error: 'super_admin only' });
    await expect(api.saveOrg({ name: 'x', slug: 'x' })).rejects.toThrow(ApiError);
    await expect(api.saveOrg({ name: 'x', slug: 'x' })).rejects.toThrow('super_admin only');
  });

  test('a 500 with no error field falls back to "HTTP 500"', async () => {
    mockFetchOnce(500, undefined);
    await expect(api.overview()).rejects.toThrow('HTTP 500');
  });
});

describe('success path', () => {
  test('returns the parsed JSON body', async () => {
    const payload = { ok: true, totals: { orgs: 3 }, perLocation: [] };
    mockFetchOnce(200, payload);
    await expect(api.overview()).resolves.toEqual(payload);
  });
});

describe('token helpers', () => {
  test('getToken/setToken/clearToken round-trip through sessionStorage', () => {
    expect(getToken()).toBe('');
    setToken('abc');
    expect(getToken()).toBe('abc');
    clearToken();
    expect(getToken()).toBe('');
  });
});
