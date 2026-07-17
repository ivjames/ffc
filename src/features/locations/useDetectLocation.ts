import { useCallback, useState } from 'react';
import { detectNearestLocation } from '../../lib/geolocate';
import { kmToMiles } from '../../lib/geo';
import { setCurrentLocationId } from '../../lib/location';

// Shared "Use my location" behavior: run GPS detection and select the closest
// venue in the current-location store (as an auto/unpinned choice). When the
// device is inside a venue's geofence we treat it as an exact match and return
// true; when it's out of range we still select the nearest site but stay put,
// noting how far off it is (in miles). Other failures surface a message.
export function useDetectLocation() {
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const detect = useCallback(async (): Promise<boolean> => {
    setDetecting(true);
    setMessage(null);
    const res = await detectNearestLocation();
    setDetecting(false);
    switch (res.status) {
      case 'matched':
        setCurrentLocationId(res.locationId, 'auto');
        return true;
      case 'nomatch':
        // Out of range of every geofence, but still land on the closest venue
        // so the player has a sensible selection; note the distance in miles.
        setCurrentLocationId(res.nearestId, 'auto');
        setMessage(
          `Selected the closest venue — about ${Math.round(kmToMiles(res.distanceKm))} miles away.`,
        );
        return false;
      case 'denied':
        setMessage('Location is off. Enable it and retry, or pick a venue below.');
        return false;
      case 'timeout':
        setMessage('Locating timed out. Try again, or pick a venue below.');
        return false;
      case 'unavailable':
        setMessage('Location is unavailable on this device. Pick a venue below.');
        return false;
    }
  }, []);

  return { detect, detecting, message };
}
