import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Screen, TopBar, Content } from '../../ui/components';
import { locationById, useContentRevision } from '../../data/courses';
import { useCurrentLocationId } from '../../lib/location';
import Hunt from './Hunt';

// What `/hunt` means depends on the venue, so this picks.
//
// `/hunt` predates the course-free hunt: it was the on-course hunt's original
// path and has since been renamespaced to /golf/hunt, with a redirect keeping
// printed QRs, shared links and muscle memory alive. The venue hunt now wants
// that same path — it's the natural one for a standalone activity, and the only
// one worth putting on a sign at a site with no mini golf.
//
// Both can have it. A venue running the course-free hunt serves it here; every
// other venue forwards to /golf/hunt exactly as before, so no existing link
// breaks. The choice is made per venue rather than once at build time, since one
// tenant can have sites of both kinds.

// How long to wait for the catalog before giving up and forwarding. Matches
// hydrateContent's own fetch timeout — past that, no answer is coming.
const CATALOG_WAIT_MS = 6000;

export default function HuntEntry() {
  // Re-render when the catalog hydrates: this component's whole job is a
  // decision made FROM that catalog.
  useContentRevision();
  const locationId = useCurrentLocationId();
  const venue = locationById(locationId);
  const [waitedOut, setWaitedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setWaitedOut(true), CATALOG_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  // A cold start with no cached catalog boots LOCATIONS empty, so the venue
  // doesn't resolve for the first moment of this render — and deciding from an
  // empty catalog would forward a hunt-only venue's own QR code to the golf
  // hunt, which is exactly the link most likely to be scanned cold. Hold
  // instead, until the catalog arrives or the wait runs out (offline with no
  // cache), and only then fall through to the redirect.
  if (!venue && !waitedOut) {
    return (
      <Screen>
        <TopBar title="Scavenger hunt" back="/" />
        <Content>
          <p className="mt-10 text-center text-sm text-fairway-100/70">Loading…</p>
        </Content>
      </Screen>
    );
  }

  if (venue?.venueHunt === true) return <Hunt mode="venue" />;
  return <Navigate to="/golf/hunt" replace />;
}
