// @vitest-environment jsdom
// The update modal's loop guard: an API-build mismatch alone must NOT open the
// modal — mid-deploy, reloading just lands on the same mismatched pair and the
// modal reappears forever. The hook confirms against the served /version.json
// that a reload actually fetches a different bundle AND that bundle matches
// the live API, and keeps re-probing until the deploy converges.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useUpdateReady } from './useApiBuild';

vi.mock('../sync', () => ({ apiUrl: (p: string) => p }));

// The hook compares against the bundle's baked-in build id.
(globalThis as unknown as { __BUILD_ID__: string }).__BUILD_ID__ = 'oldsha';

const fetchMock = vi.fn();
const servedBuild = (build: string) =>
  Promise.resolve({ json: () => Promise.resolve({ build }) });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fetchMock.mockReset();
});

describe('useUpdateReady', () => {
  it('does not probe at all without an API mismatch', async () => {
    const { result } = renderHook(() => useUpdateReady('oldsha'));
    await act(() => Promise.resolve());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  it('stays quiet while the served bundle is still this one (deploy in flight)', async () => {
    fetchMock.mockImplementation(() => servedBuild('oldsha'));
    const { result } = renderHook(() => useUpdateReady('newsha'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(() => Promise.resolve());
    expect(result.current).toBe(false);
  });

  it('stays quiet while served and API builds disagree with each other', async () => {
    fetchMock.mockImplementation(() => servedBuild('somethirdsha'));
    const { result } = renderHook(() => useUpdateReady('newsha'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(() => Promise.resolve());
    expect(result.current).toBe(false);
  });

  it('fires once the served bundle differs from this one and matches the API', async () => {
    fetchMock.mockImplementation(() => servedBuild('newsha'));
    const { result } = renderHook(() => useUpdateReady('newsha'));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('re-probes on an interval and fires when the deploy converges', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockImplementationOnce(() => servedBuild('oldsha'))
      .mockImplementation(() => servedBuild('newsha'));
    const { result } = renderHook(() => useUpdateReady('newsha'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(result.current).toBe(true);
  });
});
