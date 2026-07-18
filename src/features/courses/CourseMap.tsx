import { useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content } from '../../ui/components';
import CourseTheme from '../../ui/CourseTheme';
import { themeEmoji } from '../../lib/theme';
import { courseById } from '../../data/courses';

// §5.2 Opening course screen — the map (bundled asset) plus a "tap anywhere to
// begin" prompt. Reached by picking a course on the home page; tapping starts
// the round (player setup → scorecard).
export default function CourseMap() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const course = courseById(id);

  if (!course) {
    return (
      <Screen>
        <TopBar title="Map" back="/" />
        <Content>
          <p className="text-fairway-100/70">Course not found.</p>
        </Content>
      </Screen>
    );
  }

  const begin = () => navigate(`/new/setup?courseId=${course.id}`);

  return (
    <CourseTheme theme={course.theme} accent={course.accent}>
    <Screen>
      <TopBar title={course.name} back="/" />
      {/* Tap anywhere on the opening screen to begin the round. */}
      <button
        onClick={begin}
        aria-label={`Begin a round on ${course.name}`}
        className="animate-page-in flex flex-1 cursor-pointer flex-col px-4 py-4 text-left"
      >
        {course.mapAsset ? (
          <div className="overflow-hidden rounded-2xl border border-fairway-800 bg-fairway-900/40">
            <img
              src={course.mapAsset}
              alt={`${course.name} course map`}
              className="mx-auto block h-auto w-full"
            />
          </div>
        ) : (
          <div
            className="flex flex-1 items-center justify-center rounded-2xl border text-7xl"
            style={{
              background: `${course.accent}22`,
              borderColor: `${course.accent}66`,
            }}
          >
            {themeEmoji(course.theme)}
          </div>
        )}

        <div className="mt-8 mb-6 text-center">
          <div className="animate-pulse text-2xl font-black uppercase tracking-wide text-fairway-50">
            Tap anywhere to begin
          </div>
          <div className="mt-1 text-sm text-fairway-100/60">
            {course.holeCount} holes · {course.name}
          </div>
        </div>
      </button>
    </Screen>
    </CourseTheme>
  );
}
