import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, Content, Button, TagChip } from '../../ui/components';
import HeaderControls from '../../ui/HeaderControls';
import AnnouncementBanner from '../../ui/AnnouncementBanner';
import { getActiveRound } from '../../db';
import { courseById, locationById, coursesByLocation } from '../../data/courses';
import { useCurrentLocationId, setCurrentLocationId, isLocationPinned } from '../../lib/location';
import {
  geolocationSupported,
  geoPermissionState,
  detectNearestLocation,
} from '../../lib/geolocate';
import { playClick, playCup } from '../../lib/sound';
import { fetchSession, type AppUser } from '../../lib/authApi';
import { usePos } from '../../lib/pos';
import ActiveOrdersCard from '../food/ActiveOrdersCard';
import AdoptionNudge from '../../ui/AdoptionNudge';
import AdoptionBonusToast from '../../ui/AdoptionBonusToast';
import type { LocalRound } from '../../types';

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
  const link = (url: string, label: string) => (
    <a
      href={online ? url : undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!online}
      className={`flex-1 rounded-xl py-2.5 text-center text-sm font-bold ${
        online
          ? 'btn-accent text-fairway-50 transition-transform active:translate-y-px'
          : 'surface-sunk cursor-not-allowed text-fairway-100/50'
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
        <span className="text-lg" aria-hidden="true">
          🌭
        </span>
        <span className="text-sm font-bold text-fairway-50">Food &amp; Drink</span>
        {!online && (
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-fairway-400">
            needs connection
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {menuUrl && link(menuUrl, 'See the menu')}
        {orderingUrl && link(orderingUrl, '🛒 Order food')}
      </div>
    </div>
  );
}

// A top-level section tile for the dashboard grid. Big, glossy, tappable — the
// launcher into each part of the app.
type SectionTile = { to: string; emoji: string; title: string; accent: string };

// Home — the FEC venue dashboard. This used to be the Mini Golf course picker;
// in the restructure it becomes a launcher for the whole family-fun-center:
// what's happening at this venue (announcements, resume, active orders) plus a
// grid into the top-level sections. Mini golf is now one tile among many.
export default function Home() {
  const navigate = useNavigate();
  const [resume, setResume] = useState<LocalRound | null>(null);
  const [me, setMe] = useState<AppUser | null>(null);
  const [meChecked, setMeChecked] = useState(false);
  const locationId = useCurrentLocationId();
  const location = locationById(locationId);
  const courses = coursesByLocation(locationId);
  const hasGolf = courses.length > 0;
  const pos = usePos();

  useEffect(() => {
    void getActiveRound().then((r) => setResume(r ?? null));
    // Session check that distinguishes signed-out from unreachable: only mark
    // it "checked" on an authoritative answer, so the sign-in nudge never
    // shows to an already-signed-in player whose /me call just failed offline.
    void fetchSession().then((s) => {
      setMe(s.user);
      if (s.known) setMeChecked(true);
    });
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

  // The section grid — top-level destinations only. Golf-specific features
  // (leaderboard, scavenger hunt) live inside the Mini Golf hub, not here. Mini
  // Golf leads only when this venue actually has courses; Food gets a native
  // tile only for POS-integrated venues (others use the deep-link card below).
  const sections: SectionTile[] = [
    ...(hasGolf
      ? [{ to: '/golf', emoji: '⛳️', title: 'Mini Golf', accent: '#16a34a' } as SectionTile]
      : []),
    { to: '/arcade', emoji: '🎮', title: 'Arcade', accent: '#a855f7' },
    { to: '/photos', emoji: '📸', title: 'Photo Booth', accent: '#ec4899' },
    ...(pos.ordering
      ? [{ to: '/food', emoji: '🌭', title: 'Food & Drink', accent: '#ef4444' } as SectionTile]
      : []),
  ];

  return (
    <Screen>
      <Content>
        {/* Home has no TopBar, so keep the header cluster (menu + light/dark +
            mute) reachable from its top-right corner. */}
        <div className="mb-1 flex justify-end">
          <HeaderControls />
        </div>
        <div className="mb-3 text-center">
          <div className="animate-wiggle inline-block text-4xl leading-none drop-shadow">🎡</div>
          <h1 className="mt-1.5 text-2xl font-black tracking-tight text-fairway-50">
            {location?.name ?? 'Family Fun Center'}
          </h1>
          <p className="mt-0.5 text-sm text-fairway-100/70">What do you want to do?</p>
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

        {/* Current location — tap to switch sites (or pick "Use my location"
            there). GPS still auto-detects the venue silently when permitted. */}
        <div className="mb-2.5">
          <button
            onClick={() => navigate('/locations')}
            className="surface-1 flex w-full items-center justify-between rounded-2xl border border-fairway-800/60 px-4 py-2.5 text-left transition-transform active:translate-y-px"
          >
            <span className="flex items-center gap-2">
              <span className="text-lg" aria-hidden="true">
                📍
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-fairway-400">
                  Location
                </span>
                <span className="block truncate font-bold text-fairway-50">
                  {location?.name ?? 'Choose a location'}
                </span>
              </span>
            </span>
            <span className="text-sm font-semibold text-fairway-400">Change</span>
          </button>
        </div>

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
                <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]">{s.emoji}</span>
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
            {me ? `👤 ${me.displayName || me.defaultTag || me.email}` : '👤 Sign in / register'}
          </Button>
        </div>
      </Content>
    </Screen>
  );
}
