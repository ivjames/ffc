// @vitest-environment jsdom
// The reviewer-commentary client. The point of this module is that a note
// arrives with the context the reviewer never has to type — so the test that
// matters is "what actually goes on the wire".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Build stamp is a vite `define` (src/build-info.d.ts); tests run without it.
(globalThis as unknown as { __BUILD_ID__: string }).__BUILD_ID__ = 'testsha';

// Downscaling is canvas work jsdom can't do — the encode path has its own
// coverage through the booth. Here we only care that a chosen file is handed
// to it and that its output lands in the payload.
vi.mock('./image', () => ({
  fileToUpload: vi.fn(async () => ({ base64: 'ZmFrZQ==', mediaType: 'image/jpeg' })),
}));
vi.mock('./deviceId', () => ({ getDeviceId: () => 'device-under-test' }));
vi.mock('./location', () => ({ getCurrentLocationId: () => 'loc-under-test' }));

const { submitFeedback, getReviewerName, setReviewerName } = await import('./feedbackApi');
const { fileToUpload } = await import('./image');

function mockFetch(response: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => response,
  })) as unknown as typeof fetch;
  globalThis.fetch = fn;
  return fn as unknown as ReturnType<typeof vi.fn>;
}

function sentBody(fn: ReturnType<typeof vi.fn>) {
  return JSON.parse(fn.mock.calls[0][1].body);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.mocked(fileToUpload).mockClear();
});

describe('submitFeedback', () => {
  it('stamps the screen, build, device and venue alongside the comment', async () => {
    const fetchMock = mockFetch({ ok: true, id: 'fb-1', createdAt: 'now', hasScreenshot: false });

    await submitFeedback({
      body: 'the hole numbers are hard to read',
      screenPath: '/golf/play',
      reviewer: 'Sam',
    });

    const body = sentBody(fetchMock);
    expect(body.body).toBe('the hole numbers are hard to read');
    expect(body.screenPath).toBe('/golf/play');
    expect(body.reviewer).toBe('Sam');
    expect(body.appBuild).toBe('testsha');
    expect(body.deviceId).toBe('device-under-test');
    expect(body.locationId).toBe('loc-under-test');
    expect(body.userAgent).toBe(navigator.userAgent);
    // No file chosen -> no image keys at all, rather than nulls the server
    // would have to special-case.
    expect(body.imageBase64).toBeUndefined();
    expect(body.mediaType).toBeUndefined();
  });

  it('downscales a chosen screenshot before sending it', async () => {
    const fetchMock = mockFetch({ ok: true, id: 'fb-2', createdAt: 'now', hasScreenshot: true });
    const file = new File(['bytes'], 'shot.png', { type: 'image/png' });

    await submitFeedback({ body: 'see attached', screenPath: '/me', screenshot: file });

    expect(fileToUpload).toHaveBeenCalledWith(file);
    const body = sentBody(fetchMock);
    expect(body.imageBase64).toBe('ZmFrZQ==');
    expect(body.mediaType).toBe('image/jpeg');
  });

  it('surfaces the server error message rather than a bare status', async () => {
    mockFetch({ ok: false, error: 'feedback limit exceeded' }, false, 429);
    await expect(submitFeedback({ body: 'hi', screenPath: '/' })).rejects.toThrow(
      'feedback limit exceeded'
    );
  });

  it('omits an empty reviewer name instead of sending a blank one', async () => {
    const fetchMock = mockFetch({ ok: true, id: 'fb-3', createdAt: 'now', hasScreenshot: false });
    await submitFeedback({ body: 'anonymous note', screenPath: '/', reviewer: '' });
    expect(sentBody(fetchMock).reviewer).toBeUndefined();
  });
});

describe('reviewer name memory', () => {
  it('round-trips, trims, and forgets on clear — so a reviewer types it once', () => {
    expect(getReviewerName()).toBe('');
    setReviewerName('  Sam  ');
    expect(getReviewerName()).toBe('Sam');
    setReviewerName('   ');
    expect(getReviewerName()).toBe('');
  });
});
