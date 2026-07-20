import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, Content, Button, TagChip } from '../../ui/components';
import HeaderControls from '../../ui/HeaderControls';
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
import { getSkin, subscribeSkin } from '../../lib/skin';
import { getMode, subscribeMode } from '../../lib/mode';
import { courseArt } from '../../lib/skinAssets';
import { playClick, playCup } from '../../lib/sound';
import type { LocalRound } from '../../types';

// §7 Home — start round, view maps/rules, resume an in-progress game.
export default function Home() {
  const navigate = useNavigate();
  // Re-read on skin OR light/dark change so image-based skins (underwater,
  // fantasy) swap their course art per mode; non-image skins fall back to CSS.
  const skin = useSyncExternalStore(subscribeSkin, getSkin, getSkin);
  const mode = useSyncExternalStore(subscribeMode, getMode, getMode);
  const [resume, setResume] = useState<LocalRound | null>(null);
  const locationId = useCurrentLocationId();
  const location = locationById(locationId);
  const courses = coursesByLocation(locationId);
  const courseCount = courses.length;

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

  return (
    <Screen>
      <Content>
        {/* Home has no TopBar, so keep the light/dark + mute switches reachable
            from its top-right corner. */}
        <div className="mb-1 flex justify-end">
          <HeaderControls />
        </div>
        <div className="mb-4 text-center">
          {/* Themed title lockup (image skins swap in real art; hidden otherwise). */}
          <div className="hero-art" aria-hidden="true" />
          <div className="hero-glyph animate-wiggle inline-block text-5xl leading-none drop-shadow">
            ⛳️
          </div>
          <h1 className="hero-title mt-2 text-3xl font-black tracking-tight text-fairway-50">
            Mini Golf
          </h1>
          <p className="mt-0.5 text-sm text-fairway-100/70">
            {courseCount} {courseCount === 1 ? 'course' : 'courses'} · eighteen holes each
          </p>
        </div>

        {/* Current location — tap to switch sites (or pick "Use my location"
            there). GPS still auto-detects the venue silently when permitted. */}
        <div className="mb-3">
          <button
            onClick={() => navigate('/locations')}
            className="surface-1 flex w-full items-center justify-between rounded-2xl border border-fairway-800/60 px-4 py-2.5 text-left transition-transform active:translate-y-px"
          >
            <span className="flex items-center gap-2">
              <span className="loc-pin text-lg" aria-hidden="true">
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
            tap begins the round. (Artwork will eventually replace the emoji
            placeholders.) */}
        {courses.length === 0 ? (
          <p className="mb-6 text-center text-sm text-fairway-100/70">
            No courses at this location yet.
          </p>
        ) : (
          <div className="mb-4 grid grid-cols-2 gap-2">
            {courses.map((c, i) => {
              // Image-based skins supply a painted scene (tile) and/or crest
              // (puck) per course; CSS gates them by data-template. Non-image
              // skins get neither and fall back to the CSS tile/puck.
              const art = courseArt(skin, c.theme, mode);
              return (
              <button
                key={c.id}
                onClick={() => {
                  playClick();
                  navigate(`/courses/${c.id}/map`);
                }}
                className={`tile animate-pop-in group flex flex-col items-center justify-center gap-2.5 rounded-3xl px-3 py-4 text-center${
                  art.tile && !art.card ? ' tile-art' : ''
                }${art.puck ? ' puck-art' : ''}${art.card ? ' card-art' : ''}`}
                style={
                  {
                    '--i': i,
                    '--tile-accent': c.accent,
                    ...(art.tile ? { '--tile-img': `url(${art.tile})` } : {}),
                    ...(art.puck ? { '--puck-img': `url(${art.puck})` } : {}),
                  } as CSSProperties
                }
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
                <span className="tile-label text-sm font-black leading-tight text-fairway-50">
                  {c.name}
                </span>
              </button>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <Button variant="ghost" onClick={() => navigate('/hunt')}>
            <span className="menu-ico" data-ico="hunt" aria-hidden="true" />
            Scavenger hunt
          </Button>
          <Button variant="ghost" onClick={() => navigate('/fun')}>
            <span className="menu-ico" data-ico="wait" aria-hidden="true" />
            <span className="menu-emoji">🎡 </span>While You Wait
          </Button>
          <Button variant="ghost" onClick={() => navigate('/rules')}>
            <span className="menu-ico" data-ico="rules" aria-hidden="true" />
            Rules
          </Button>
          <Button variant="ghost" onClick={() => navigate('/tv')}>
            <span className="menu-ico" data-ico="leaderboard" aria-hidden="true" />
            See the leaderboard
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
