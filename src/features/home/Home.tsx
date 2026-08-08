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
import { isStandalone } from '../../lib/pwaInstall';
import { themeEmoji } from '../../lib/theme';
import { playClick, playCup } from '../../lib/sound';
import { fetchMe, type AppUser } from '../../lib/authApi';
import { usePos } from '../../lib/pos';
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

// §7 Home — start round, view maps/rules, resume an in-progress game.
export default function Home() {
  const navigate = useNavigate();
  const [resume, setResume] = useState<LocalRound | null>(null);
  const [me, setMe] = useState<AppUser | null>(null);
  const locationId = useCurrentLocationId();
  const location = locationById(locationId);
  const courses = coursesByLocation(locationId);
  const courseCount = courses.length;
  const pos = usePos();

  useEffect(() => {
    void getActiveRound().then((r) => setResume(r ?? null));
    // Best-effort session check — resolves null offline or signed out.
    void fetchMe().then(setMe);
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

  return (
    <Screen>
      <Content>
        {/* Home has no TopBar, so keep the light/dark + mute switches reachable
            from its top-right corner. */}
        <div className="mb-1 flex justify-end">
          <HeaderControls />
        </div>
        <div className="mb-4 text-center">
          <div className="animate-wiggle inline-block text-5xl leading-none drop-shadow">
            ⛳️
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-fairway-50">
            Mini Golf
          </h1>
          <p className="mt-0.5 text-sm text-fairway-100/70">
            {courseCount} {courseCount === 1 ? 'course' : 'courses'} · eighteen holes each
          </p>
        </div>

        {/* Venue specials / updates — live from Master Control, cached for
            offline. Renders nothing when there's nothing to announce. */}
        <AnnouncementBanner locationId={locationId} className="mb-3" />

        {/* Current location — tap to switch sites (or pick "Use my location"
            there). GPS still auto-detects the venue silently when permitted. */}
        <div className="mb-3">
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
              navigate(`/play/${resume.clientId}`);
            }}
            className="surface animate-glow-pulse mb-3 w-full rounded-2xl border border-fairway-500/40 p-3.5 text-left transition-transform active:translate-y-px"
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

        {/* Pick a course to play. Each tile opens that course's map, where a
            tap begins the round. */}
        {courses.length === 0 ? (
          <p className="mb-6 text-center text-sm text-fairway-100/70">
            No courses at this location yet.
          </p>
        ) : (
          <div className="mb-4 grid grid-cols-2 gap-2">
            {courses.map((c, i) => (
              <button
                key={c.id}
                onClick={() => {
                  playClick();
                  navigate(`/courses/${c.id}/map`);
                }}
                className="tile animate-pop-in group flex flex-col items-center justify-center gap-2.5 rounded-3xl px-3 py-4 text-center"
                style={{ '--i': i, '--tile-accent': c.accent } as CSSProperties}
              >
                {/* Domed emoji puck — a radial highlight + inner shade make the
                    disc read as a glossy 3D button cap in the course color. */}
                <span
                  className="course-puck flex h-14 w-14 items-center justify-center rounded-full text-3xl transition-transform duration-150 group-active:scale-110"
                  style={{ '--puck-accent': c.accent } as CSSProperties}
                >
                  <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]">
                    {themeEmoji(c.theme)}
                  </span>
                </span>
                <span className="text-sm font-black leading-tight text-fairway-50">
                  {c.name}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Food & drink (punchlist #7 tier 1) — deep links into the venue's
            menu / ordering system, set per location in Master Control. Hidden
            when the venue has no links; ordering needs a connection. */}
        <FoodDrinkCard
          menuUrl={location?.menuUrl}
          orderingUrl={location?.orderingUrl}
        />

        <div className="space-y-2">
          {/* The scavenger hunt is a play-time activity, reached from the
              scorecard during a round — it's intentionally not on Home. */}
          <Button variant="ghost" onClick={() => navigate('/join')}>
            📲 Join a friend's game
          </Button>
          <Button variant="ghost" onClick={() => navigate('/fun')}>
            🎡 While You Wait
          </Button>
          {/* Native in-app ordering + rewards — POS-integration add-ons,
              shown only when this venue's Master Control config enables the
              capability (src/lib/pos; DEV_MODE enables both against the local
              mock). Un-integrated venues keep the FoodDrinkCard deep links. */}
          {pos.ordering && (
            <Button variant="ghost" onClick={() => navigate('/food')}>
              🍕 Order food & drinks
            </Button>
          )}
          {pos.loyalty && (
            <Button variant="ghost" onClick={() => navigate('/rewards')}>
              🎟️ Rewards card
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate('/rules')}>
            Rules
          </Button>
          <Button variant="ghost" onClick={() => navigate('/tv')}>
            See the leaderboard
          </Button>
          <Button variant="ghost" onClick={() => navigate('/account')}>
            {me
              ? `👤 ${me.displayName || me.defaultTag || me.email}`
              : '👤 Sign in / register'}
          </Button>
          {/* Only worth showing when we're running in a browser tab, not the
              already-installed standalone app. */}
          {!isStandalone() && (
            <Button variant="ghost" onClick={() => navigate('/install')}>
              📲 Install app
            </Button>
          )}
        </div>
      </Content>
    </Screen>
  );
}
