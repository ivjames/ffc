import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Screen, Content, Button, TagChip } from '../../ui/components';
import { BuildStamp } from '../../ui/BuildStamp';
import { getActiveRound } from '../../db';
import { courseById } from '../../data/courses';
import type { LocalRound } from '../../types';

// §7 Home — start round, view maps/rules, resume an in-progress game.
export default function Home() {
  const navigate = useNavigate();
  const [resume, setResume] = useState<LocalRound | null>(null);

  useEffect(() => {
    void getActiveRound().then((r) => setResume(r ?? null));
  }, []);

  const resumeCourse = resume ? courseById(resume.courseId) : undefined;

  return (
    <Screen>
      <Content>
        <div className="mb-8 mt-6 text-center">
          <div className="text-5xl">⛳️</div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-fairway-50">Mini Golf</h1>
          <p className="mt-1 text-sm text-fairway-100/70">Four courses. Eighteen holes each.</p>
        </div>

        {resume && resumeCourse && (
          <button
            onClick={() => navigate(`/play/${resume.clientId}`)}
            className="mb-4 w-full rounded-2xl border border-fairway-500/40 bg-fairway-900/60 p-4 text-left active:bg-fairway-800/60"
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

        <div className="space-y-3">
          <Button onClick={() => navigate('/new')}>Start new round</Button>
          <Button variant="ghost" onClick={() => navigate('/courses')}>
            Courses &amp; maps
          </Button>
          <Button variant="ghost" onClick={() => navigate('/rules')}>
            Rules
          </Button>
          <Button variant="ghost" onClick={() => navigate('/hunt')}>
            Scavenger hunt
          </Button>
        </div>

        <div className="mt-10 text-center text-xs text-fairway-100/40">
          <Link to="/tv" className="underline">
            See the leaderboard
          </Link>
        </div>

        <div className="mt-6 text-center">
          <BuildStamp />
        </div>
      </Content>
    </Screen>
  );
}
