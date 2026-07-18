import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, Content, Button, TagChip } from '../../ui/components';
import { getActiveRound } from '../../db';
import { courseById, locationById, coursesByLocation } from '../../data/courses';
import { useCurrentLocationId, setCurrentLocationId, isLocationPinned } from '../../lib/location';
import {
  geolocationSupported,
  geoPermissionState,
  detectNearestLocation,
} from '../../lib/geolocate';
import { isStandalone } from '../../lib/pwaInstall';
import type { LocalRound } from '../../types';

// §7 Home — start round, view maps/rules, resume an in-progress game.
export default function Home() {
  const navigate = useNavigate();
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
        <div className="mb-4 mt-3 text-center">
          <div className="text-4xl">⛳️</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-fairway-50">Mini Golf</h1>
          <p className="mt-0.5 text-sm text-fairway-100/70">
            {courseCount} {courseCount === 1 ? 'course' : 'courses'} · eighteen holes each
          </p>
        </div>

        {/* Current location — tap to switch sites (or pick "Use my location"
            there). GPS still auto-detects the venue silently when permitted. */}
        <div className="mb-3">
          <button
            onClick={() => navigate('/locations')}
            className="flex w-full items-center justify-between rounded-2xl border border-fairway-800 bg-fairway-900/40 px-4 py-2.5 text-left active:bg-fairway-800/60"
          >
            <span className="flex items-center gap-2">
              <span className="text-lg">📍</span>
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
            onClick={() => navigate(`/play/${resume.clientId}`)}
            className="mb-3 w-full rounded-2xl border border-fairway-500/40 bg-fairway-900/60 p-3 text-left active:bg-fairway-800/60"
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
          <p className="mb-6 text-center text-sm text-fairway-100/60">
            No courses at this location yet.
          </p>
        ) : (
          <div className="mb-4 grid grid-cols-2 gap-2">
            {courses.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/courses/${c.id}/map`)}
                className="flex flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-center transition active:scale-[0.98]"
                style={{
                  background: `${c.accent}22`,
                  borderColor: `${c.accent}66`,
                }}
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl"
                  style={{ background: `${c.accent}33` }}
                >
                  {themeEmoji(c.theme)}
                </span>
                <span className="text-sm font-bold leading-tight text-fairway-50">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Button variant="ghost" onClick={() => navigate('/hunt')}>
            Scavenger hunt
          </Button>
          <Button variant="ghost" onClick={() => navigate('/putt')}>
            🕹️ Arcade Putt
          </Button>
          <Button variant="ghost" onClick={() => navigate('/rules')}>
            Rules
          </Button>
          <Button variant="ghost" onClick={() => navigate('/tv')}>
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

function themeEmoji(theme: string): string {
  switch (theme) {
    case 'blue':
      return '🔵';
    case 'green':
      return '🟢';
    case 'red':
      return '🔴';
    case 'dragon':
      return '🐉';
    case 'western':
      return '🤠';
    // Retained for any legacy themed courses.
    case 'jungle':
      return '🌴';
    case 'pirate':
      return '🏴‍☠️';
    case 'space':
      return '🚀';
    case 'haunted':
      return '👻';
    default:
      return '⛳️';
  }
}
