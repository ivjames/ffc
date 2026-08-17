// @vitest-environment jsdom
// The course-free hunt's local group state. The finds themselves live on the
// server keyed by the session's clientId, so what matters here is that the
// stored pointer only comes back for the RIGHT venue and the RIGHT visit —
// anything else would silently append a new group's finds to an old tally.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  endVenueHuntSession,
  getVenueHuntSession,
  startVenueHuntSession,
} from './venueSession';

const VENUE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VENUE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('venue hunt session', () => {
  it('round-trips a started session for its own venue', () => {
    const started = startVenueHuntSession(VENUE_A, ['ABC', 'XYZ']);
    expect(started.clientId).toBeTruthy();
    const read = getVenueHuntSession(VENUE_A);
    expect(read).not.toBeNull();
    expect(read!.clientId).toBe(started.clientId);
    expect(read!.playerTags).toEqual(['ABC', 'XYZ']);
  });

  it('mints an unguessable key per session — it is the group’s bearer secret', () => {
    const first = startVenueHuntSession(VENUE_A, ['ABC']);
    const second = startVenueHuntSession(VENUE_A, ['ABC']);
    expect(second.clientId).not.toBe(first.clientId);
    expect(first.clientId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("doesn't return another venue's session", () => {
    startVenueHuntSession(VENUE_A, ['ABC']);
    expect(getVenueHuntSession(VENUE_B)).toBeNull();
    // ...and the group that drives to venue B starts a fresh hunt there.
    const atB = startVenueHuntSession(VENUE_B, ['ABC']);
    expect(getVenueHuntSession(VENUE_B)!.clientId).toBe(atB.clientId);
  });

  it('ages out a stale session so next week is a new hunt', () => {
    startVenueHuntSession(VENUE_A, ['ABC']);
    expect(getVenueHuntSession(VENUE_A)).not.toBeNull();
    // 13h later — past the 12h visit window.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
    expect(getVenueHuntSession(VENUE_A)).toBeNull();
  });

  it('"finish hunt" forgets the session', () => {
    startVenueHuntSession(VENUE_A, ['ABC']);
    endVenueHuntSession();
    expect(getVenueHuntSession(VENUE_A)).toBeNull();
  });

  it('drops a corrupt or half-written entry instead of throwing', () => {
    for (const bad of ['not json', '{}', '[]', 'null', JSON.stringify({ clientId: '' })]) {
      localStorage.setItem('ffc.huntSession', bad);
      expect(getVenueHuntSession(VENUE_A)).toBeNull();
    }
  });
});
