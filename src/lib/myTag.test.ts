// @vitest-environment jsdom
import { describe, test, expect, beforeEach } from 'vitest';
import { getMyTag, ownerSeatFor, rememberMyTag } from './myTag';

beforeEach(() => localStorage.clear());

describe('the remembered holder tag', () => {
  test('round-trips a valid tag', () => {
    expect(getMyTag()).toBeNull();
    rememberMyTag('JIM');
    expect(getMyTag()).toBe('JIM');
    rememberMyTag('AVA'); // latest statement wins
    expect(getMyTag()).toBe('AVA');
  });

  test('never stores an invalid tag over a good one', () => {
    rememberMyTag('JIM');
    rememberMyTag('J'); // too short
    rememberMyTag('j!m'); // bad charset
    expect(getMyTag()).toBe('JIM');
  });

  test('a stored value that fails validation reads as nothing', () => {
    // The blocklist can grow between visits; validate on the way out too.
    localStorage.setItem('ffc.myTag', 'ASS');
    expect(getMyTag()).toBeNull();
    localStorage.setItem('ffc.myTag', 'garbage');
    expect(getMyTag()).toBeNull();
  });
});

describe('ownerSeatFor', () => {
  test('finds the holder on the roster', () => {
    expect(ownerSeatFor(['AVA', 'JIM'], 'JIM')).toBe(1);
  });

  test('a known holder missing from the roster is just keeping score', () => {
    expect(ownerSeatFor(['AVA', 'TOM'], 'JIM')).toBe('none');
  });

  test('an unknown holder defaults to player 1', () => {
    expect(ownerSeatFor(['AVA', 'TOM'], null)).toBe(0);
  });
});
