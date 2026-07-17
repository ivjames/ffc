import { Link, useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content } from '../../ui/components';
import { coursesByLocation, locationById } from '../../data/courses';
import { useCurrentLocationId } from '../../lib/location';
import { coursePar } from '../../lib/scoring';

// §5.2 Course maps — courses at the current location; tap to view map + pars.
export default function CourseList() {
  const navigate = useNavigate();
  const locationId = useCurrentLocationId();
  const location = locationById(locationId);
  const courses = coursesByLocation(locationId);
  return (
    <Screen>
      <TopBar title="Courses" back="/" />
      <Content>
        <Link
          to="/locations?next=/courses"
          className="mb-3 flex items-center justify-between rounded-xl border border-fairway-800 bg-fairway-900/40 px-3 py-2 text-sm active:bg-fairway-800/60"
        >
          <span className="text-fairway-100/70">
            📍 <span className="font-semibold text-fairway-100">{location?.name}</span>
          </span>
          <span className="font-semibold text-fairway-400">Change</span>
        </Link>

        {courses.length === 0 && (
          <p className="mt-6 text-center text-sm text-fairway-100/60">
            No courses at this location yet.
          </p>
        )}

        <div className="space-y-3">
          {courses.map((c) => (
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
