import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, Content, Button, TagChip } from '../../ui/components';
import HeaderControls from '../../ui/HeaderControls';
import AnnouncementBanner from '../../ui/AnnouncementBanner';
import BrandLogo from '../../ui/BrandLogo';
import { VenueOpenLine } from '../../ui/VenueHoursInfo';
import { getActiveRound } from '../../db';
import { courseById, locationById, coursesByLocation } from '../../data/courses';
import { useCurrentLocationId, setCurrentLocationId, isLocationPinned } from '../../lib/location';
import {
  geolocationSupported,
  geoPermissionState,
  detectNearestLocation,
} from '../../lib/geolocate';
import { playClick, playCup } from '../../lib/sound';
import { useSession } from '../../lib/session';
import { usePos } from '../../lib/pos';
import { useModules } from '../../lib/modules';
import ActiveOrdersCard from '../food/ActiveOrdersCard';
import AdoptionNudge from '../../ui/AdoptionNudge';
import AdoptionBonusToast from '../../ui/AdoptionBonusToast';
import type { LocalRound } from '../../types';
import Icon from '../../ui/Icon';
import type { DrawnIcon } from '../../ui/icons/registry';
import type { ReactNode } from 'react';

// Food & drink deep links for the current venue. External links, so they open
// in a new tab and need a connection — offline the card stays visible (the
// venue still serves food!) but says so instead of dead-linking.
function FoodDrinkCard({ menuUrl, orderingUrl }: { menuUrl?: string; orderingUrl?: string }) {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (!menuUrl && !orderingUrl) return null;
  const link = (url: string, label: ReactNode) => (
    <a
      href={online ? url : undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!online}
      className={`flex-1 rounded-xl py-2.5 text-center text-sm font-bold ${
        online
          ? 'btn-accent text-fairway-50 transition-transform active:translate-y-px'
          : // Keeps `fairway-100/50` where the rest of the app moved to /80 for
            // AA — the offline state is an inactive control (`aria-disabled`),
            // which WCAG 1.4.3 exempts, and the dimming IS the affordance.
            'surface-sunk cursor-not-allowed text-fairway-100/50'
      }`}
      onClick={(e) => {
        if (!online) e.preventDefault();
      }}
    >
      {label}
    </a>
  );
  return (
    <div className="surface-1 mb-3 rounded-2xl border border-fairway-800/60 p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="nav.food" className="text-lg" />
        <span className="text-sm font-bold text-fairway-50">Food &amp; Drink</span>
        {!online && (
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-fairway-400">
            needs connection
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {menuUrl && link(menuUrl, 'See the menu')}
        {orderingUrl && (
            <>
              {link(
                orderingUrl,
                <>
                  <Icon name="order.cart" /> Order food
                </>,
              )}
            </>
          )}
      </div>
    </div>
  );
}

// A top-level section tile for the dashboard grid. Big, glossy, tappable — the
// launcher into each part of the app.
type SectionTile = { to: string; icon: DrawnIcon; title: string; accent: string };

// Home — the FEC venue dashboard. This used to be the Mini Golf course picker;
// in the restructure it becomes a launcher for the whole family-fun-center:
// what's happening at this venue (announcements, resume, active orders) plus a
// grid into the top-level sections. Mini golf is now one tile among many.
export default function Home() {
  const navigate = useNavigate();
  const [resume, setResume] = useState<LocalRound | null>(null);
  const { user: me, known: meChecked } = useSession();
  const locationId = useCurrentLocationId();
  const location = locationById(locationId);
  const courses = coursesByLocation(locationId);
  const hasGolf = courses.length > 0;
  // The course-free scavenger hunt, when this venue runs one. Derived
  // server-side (/api/content) from venueMode + a non-empty active list, so
  // the tile never opens an empty hunt.
  // Both halves must hold: the venue runs a course-free hunt AND the hunt
  // module is part of its plan (src/lib/modules.ts).
  const modules = useModules();
  const hasVenueHunt = location?.venueHunt === true && modules.hunt;
  const pos = usePos();

  useEffect(() => {
    void getActiveRound().then((r) => setResume(r ?? null));
  }, []);

  // Silent GPS auto-detect: only when location is already granted (so we never
  // fire an unsolicited permission prompt on load) and the player hasn't pinned
  // a site by hand. The explicit "Use my location" button covers the first
  // permission grant via a user gesture.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (isLocationPinned() || !geolocationSupported()) return;
      if ((await geoPermissionState()) !== 'granted') return;
      const res = await detectNearestLocation();
      if (!cancelled && res.status === 'matched') {
        setCurrentLocationId(res.locationId, 'auto');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resumeCourse = resume ? courseById(resume.courseId) : undefined;

  // The section grid — top-level destinations only. The ON-COURSE scavenger
  // hunt stays inside the Mini Golf hub (it needs a round), but the
  // course-free VENUE hunt is a standalone activity and belongs here — that's
  // the whole point of it for sites with no mini golf. Mini Golf leads only
  // when this venue actually has courses; Food gets a native tile only for
  // POS-integrated venues (others use the deep-link card below).
  const sections: SectionTile[] = [
    ...(hasGolf
      ? [{ to: '/golf', icon: 'nav.golf', title: 'Mini Golf', accent: '#16a34a' } as SectionTile]
      : []),
    ...(hasVenueHunt
      ? [{ to: '/hunt', icon: 'nav.hunt', title: 'Scavenger Hunt', accent: '#0ea5e9' } as SectionTile]
      : []),
    ...(modules.arcade
      ? [{ to: '/arcade', icon: 'nav.arcade', title: 'Arcade', accent: '#a855f7' } as SectionTile]
      : []),
    { to: '/photos', icon: 'nav.photos', title: 'Photo Booth', accent: '#ec4899' },
    ...(pos.ordering
      ? [{ to: '/food', icon: 'nav.food', title: 'Food & Drink', accent: '#ef4444' } as SectionTile]
      : []),
  ];

  return (
    <Screen>
      <Content>
        {/* Home has no TopBar, so keep the menu button reachable from its
            top-right corner (light/dark + mute now live in the drawer). */}
        <div className="mb-1 flex justify-end">
          <HeaderControls />
        </div>
        <div className="mb-3 text-center">
          {/* Hero mark: the tenant's uploaded logo when their branding sets one
              EXPLICITLY (BrandLogo enforces the raw-key rule); the ferris wheel
              is the neutral no-logo / load-failure fallback. Height-capped so
              an oversized upload can't reflow the dashboard. */}
          <BrandLogo
            className="mx-auto h-14 w-auto max-w-[75%] object-contain drop-shadow"
            fallback={
              <Icon name="brand.mark" className="animate-wiggle inline-block text-4xl leading-none drop-shadow" />
            }
          />
          <h1 className="mt-1.5 text-2xl font-black tracking-tight text-fairway-50">
            {location?.name ?? 'Family Fun Center'}
          </h1>
          <p className="mt-0.5 text-sm text-fairway-100/70">What do you want to do?</p>
          <VenueOpenLine
            hours={location?.hours}
            tz={location?.tz}
            className="mt-1.5 justify-center"
          />
        </div>

        {/* Venue specials / updates — live from Master Control, cached for
            offline. Renders nothing when there's nothing to announce. */}
        <AnnouncementBanner locationId={locationId} className="mb-2.5" />

        {/* Proactive, dismissible adoption nudge — install / sign-in, with
            escalating back-off so it never nags. Self-gates once installed or
            signed in. */}
        <AdoptionNudge signedIn={!!me} authChecked={meChecked} className="mb-2.5" />

        {/* Collects the one-time install/sign-in bonuses once the milestone is
            reached + a card is linked (or invites linking a card to collect). */}
        <AdoptionBonusToast signedIn={!!me} />

        {/* Current location + "change location" live in the nav drawer (it
            shows the venue name and links to /locations). GPS still
            auto-detects the venue silently when permitted. */}

        {resume && resumeCourse && (
          <button
            onClick={() => {
              playCup();
              navigate(`/golf/play/${resume.clientId}`);
            }}
            className="surface animate-glow-pulse mb-2.5 w-full rounded-2xl border border-fairway-500/40 p-3.5 text-left transition-transform active:translate-y-px"
            style={{ '--glow': resumeCourse.accent } as CSSProperties}
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
              Resume round
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-lg font-bold text-fairway-50">{resumeCourse.name}</span>
              <span className="flex gap-1">
                {resume.playerTags.map((t, i) => (
                  <TagChip key={i} tag={t} color={resumeCourse.accent} />
                ))}
              </span>
            </div>
          </button>
        )}

        {/* An order this device placed that's still in the kitchen — link
            back to its status screen (self-gating, usually renders nothing). */}
        <ActiveOrdersCard />

        {/* The section launcher — the heart of the dashboard. Each tile opens a
            top-level part of the app. Compact horizontal cards keep the grid
            dense so the whole launcher fits with little scrolling. */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          {sections.map((s, i) => (
            <button
              key={s.to}
              onClick={() => {
                playClick();
                navigate(s.to);
              }}
              className="tile animate-pop-in group flex items-center gap-2.5 rounded-2xl px-3 py-3 text-left"
              style={{ '--i': i, '--tile-accent': s.accent } as CSSProperties}
            >
              <span
                className="course-puck flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl transition-transform duration-150 group-active:scale-110"
                style={{ '--puck-accent': s.accent } as CSSProperties}
              >
                <Icon name={s.icon} className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]" />
              </span>
              <span className="min-w-0 text-sm font-black leading-tight text-fairway-50">
                {s.title}
              </span>
            </button>
          ))}
        </div>

        {/* Food & drink (punchlist #7 tier 1) — deep links into the venue's
            menu / ordering system, set per location in Master Control. Hidden
            when the venue has no links; the native ordering tile above covers
            POS-integrated venues instead. */}
        {!pos.ordering && (
          <FoodDrinkCard menuUrl={location?.menuUrl} orderingUrl={location?.orderingUrl} />
        )}

        <div className="space-y-2">
          <Button variant="ghost" onClick={() => navigate('/me')}>
            <Icon name="state.account" />
            {me ? me.displayName || me.defaultTag || me.email : 'Sign in / register'}
          </Button>
        </div>
      </Content>
    </Screen>
  );
}
