import { describe, it, expect } from 'vitest';
import { presenceFromDetect } from './presence';

// The gate's decision logic: only a confirmed in-geofence match counts as
// on-site; everything else blocks (off-site or unconfirmed).

describe('presenceFromDetect', () => {
  it('maps a geofence match to on-site with the venue id', () => {
    expect(presenceFromDetect({ status: 'matched', locationId: 'v1', distanceKm: 0.2 })).toEqual({
      status: 'on-site',
      locationId: 'v1',
    });
  });

  it('maps a located-but-outside result to off-site', () => {
    expect(presenceFromDetect({ status: 'nomatch', nearestId: 'v1', distanceKm: 80 })).toEqual({
      status: 'off-site',
    });
  });

  it('maps every no-fix result to unconfirmed (gate blocks, not allows)', () => {
    expect(presenceFromDetect({ status: 'denied' })).toEqual({
      status: 'unconfirmed',
      reason: 'denied',
    });
    expect(presenceFromDetect({ status: 'unavailable' })).toEqual({
      status: 'unconfirmed',
      reason: 'unavailable',
    });
    expect(presenceFromDetect({ status: 'timeout' })).toEqual({
      status: 'unconfirmed',
      reason: 'timeout',
    });
  });
});
