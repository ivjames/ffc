import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content } from '../../ui/components';
import { COURSES } from '../../data/courses';
import { coursePar } from '../../lib/scoring';

// §5.2 Course maps — list of courses; tap to view the bundled map + pars.
export default function CourseList() {
  const navigate = useNavigate();
  return (
    <Screen>
      <TopBar title="Courses" back="/" />
      <Content>
        <div className="space-y-3">
          {COURSES.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/courses/${c.id}/map`)}
              className="flex w-full items-center gap-4 rounded-2xl border border-fairway-800 bg-fairway-900/40 p-4 text-left active:bg-fairway-800/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold text-fairway-50">{c.name}</span>
                <span className="block text-sm capitalize text-fairway-100/60">
                  {c.theme} · {c.holeCount} holes · par {coursePar(c.pars)}
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
