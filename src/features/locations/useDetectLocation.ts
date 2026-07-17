import { useCallback, useState } from 'react';
import { detectNearestLocation } from '../../lib/geolocate';
import { setCurrentLocationId } from '../../lib/location';

// Shared "Use my location" behavior: run GPS detection, apply a match to the
// current-location store (as an auto/unpinned choice), and surface a
// user-facing message for every non-match outcome. Returns true on a match.
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
        setMessage(
          `No venue within range — the nearest is about ${Math.round(res.distanceKm)} km away. Pick one below.`,
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
