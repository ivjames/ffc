import { Link, useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content } from '../../ui/components';
import { coursesByLocation, locationById } from '../../data/courses';
import { useCurrentLocationId } from '../../lib/location';
import { coursePar } from '../../lib/scoring';
import { themeEmoji } from '../../lib/theme';

// §5.1 step 1 — pick a course at the current location (one round = one course).
export default function CoursePicker() {
  const navigate = useNavigate();
  const locationId = useCurrentLocationId();
  const location = locationById(locationId);
  const courses = coursesByLocation(locationId);
  return (
    <Screen>
      <TopBar title="Pick a course" back="/" />
      <Content>
        {/* Which site these courses belong to — tap to switch. Raised row
            material (`.surface-1`), matching Home's location bar. */}
        <Link
          to="/locations?next=/new"
          className="surface-1 mb-3 flex items-center justify-between rounded-2xl border border-fairway-800/60 px-4 py-2.5 text-sm transition-transform active:translate-y-px"
        >
          <span className="text-fairway-100/70">
            📍 <span className="font-semibold text-fairway-100">{location?.name}</span>
          </span>
          <span className="font-semibold text-fairway-400">Change</span>
        </Link>

        {courses.length === 0 && (
          <p className="mt-6 text-center text-sm text-fairway-100/70">
            No courses at this location yet.
          </p>
        )}

        <div className="space-y-3">
          {courses.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/new/setup?courseId=${c.id}`)}
              className="surface-1 flex w-full items-center gap-4 rounded-2xl border border-fairway-800/60 p-4 text-left transition-transform active:translate-y-px"
            >
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
                style={{ background: `${c.accent}22`, border: `1px solid ${c.accent}55` }}
              >
                {themeEmoji(c.theme)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold text-fairway-50">{c.name}</span>
                <span className="block text-sm text-fairway-100/70">
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
