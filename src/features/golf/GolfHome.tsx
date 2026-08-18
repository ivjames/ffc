import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button, TagChip } from '../../ui/components';
import { getActiveRound } from '../../db';
import { courseById, coursesByLocation } from '../../data/courses';
import { useCurrentLocationId } from '../../lib/location';
import { themeIcon } from '../../lib/theme';
import { playClick, playCup } from '../../lib/sound';
import type { LocalRound } from '../../types';
import Icon from '../../ui/Icon';

// Mini Golf section hub. Golf used to BE the app's home screen; in the FEC
// restructure it becomes one section among several, reached from the drawer or
// the Home dashboard. Everything golf now lives behind this single entry: pick a
// course to play, resume an in-progress round, and reach the golf leaderboard,
// scavenger hunt, and rules. The course-tile grid and resume card moved here
// verbatim from the old Home so the walk-up flow is unchanged — just relocated.
export default function GolfHome() {
  const navigate = useNavigate();
  const [resume, setResume] = useState<LocalRound | null>(null);
  const locationId = useCurrentLocationId();
  const courses = coursesByLocation(locationId);

  useEffect(() => {
    void getActiveRound().then((r) => setResume(r ?? null));
  }, []);

  const resumeCourse = resume ? courseById(resume.courseId) : undefined;

  return (
    <Screen>
      <TopBar title="Mini Golf" back="/" />
      <Content>
        <p className="mb-3 text-center text-sm text-fairway-100/70">
          {courses.length} {courses.length === 1 ? 'course' : 'courses'} · eighteen holes each
        </p>

        {resume && resumeCourse && (
          <button
            onClick={() => {
              playCup();
              navigate(`/golf/play/${resume.clientId}`);
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
                  navigate(`/golf/courses/${c.id}/map`);
                }}
                className="tile animate-pop-in group flex flex-col items-center justify-center gap-2 rounded-2xl px-3 py-3.5 text-center"
                style={{ '--i': i, '--tile-accent': c.accent } as CSSProperties}
              >
                <span
                  className="course-puck flex h-12 w-12 items-center justify-center rounded-full text-2xl transition-transform duration-150 group-active:scale-110"
                  style={{ '--puck-accent': c.accent } as CSSProperties}
                >
                  <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]">
                    <Icon name={themeIcon(c.theme)} />
                  </span>
                </span>
                <span className="text-sm font-black leading-tight text-fairway-50">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {/* Guest side of a shared multi-device round — the host's QR deep-links
              here too; this is the manual "enter a code" path. */}
          <Button variant="ghost" onClick={() => navigate('/join')}>
            <Icon name="action.play-together" /> Join a friend's game
          </Button>
          <Button variant="ghost" onClick={() => navigate('/golf/leaderboard')}>
            <Icon name="action.leaderboard" /> Leaderboard
          </Button>
          <Button variant="ghost" onClick={() => navigate('/golf/hunt')}>
            <Icon name="nav.hunt" /> Scavenger hunt
          </Button>
          <Button variant="ghost" onClick={() => navigate('/golf/rules')}>
            <Icon name="action.rules" /> Rules
          </Button>
        </div>
      </Content>
    </Screen>
  );
}
