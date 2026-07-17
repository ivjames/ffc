import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content } from '../../ui/components';
import { COURSES } from '../../data/courses';
import { coursePar } from '../../lib/scoring';

// §5.1 step 1 — pick one of the four courses (one round = one course).
export default function CoursePicker() {
  const navigate = useNavigate();
  return (
    <Screen>
      <TopBar title="Pick a course" back="/" />
      <Content>
        <div className="space-y-3">
          {COURSES.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/new/setup?courseId=${c.id}`)}
              className="flex w-full items-center gap-4 rounded-2xl border border-fairway-800 bg-fairway-900/40 p-4 text-left active:bg-fairway-800/60"
            >
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
                style={{ background: `${c.accent}22`, border: `1px solid ${c.accent}55` }}
              >
                {themeEmoji(c.theme)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold text-fairway-50">{c.name}</span>
                <span className="block text-sm text-fairway-100/60">
                  {c.holeCount} holes · par {coursePar(c.pars)}
                </span>
              </span>
              <span className="text-xl text-fairway-400">›</span>
            </button>
          ))}
        </div>
      </Content>
    </Screen>
  );
}

function themeEmoji(theme: string): string {
  switch (theme) {
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
