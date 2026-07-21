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
    {/* Anchored to the viewport rather than the shared <Screen>: the "tap
        anywhere to begin" button below fills this column via flex-1, and
        Screen's `min-h-full` doesn't resolve to a real height under CourseTheme,
        which would collapse the button to its content and leave the lower area
        an unresponsive dead zone. Local to this screen so other pages are
        untouched. Subtract the safe-area insets the body already pads with, so
        on notched iPhones the column doesn't exceed the visible area and push
        the bottom prompt/tap zone below the fold. */}
    <div className="mx-auto flex min-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-md flex-col">
      <TopBar title={course.name} back="/" />
      {/* Tap anywhere on the opening screen to begin the round. */}
      {/* The map fills the whole area below the bar; tapping anywhere begins.
          Edge-to-edge (no inner frame) per the layout spec — the prompt is
          overlaid on the map rather than sitting below it. */}
      <button
        onClick={begin}
        aria-label={`Begin a round on ${course.name}`}
        className="animate-page-in relative flex flex-1 cursor-pointer flex-col overflow-hidden text-left"
      >
        {course.mapAsset ? (
          <img
            src={course.mapAsset}
            alt={`${course.name} course map`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div
            className="flex flex-1 items-center justify-center text-7xl"
            style={{ background: `${course.accent}22` }}
          >
            {themeEmoji(course.theme)}
          </div>
        )}

        {/* Prompt overlay — a bottom scrim keeps it legible over any map art in
            both light and dark. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-4 pb-8 pt-16 text-center">
          <div className="animate-pulse text-2xl font-black uppercase tracking-wide text-white">
            Tap anywhere to begin
          </div>
          <div className="mt-1 text-sm text-white/80">
            {course.holeCount} holes · {course.name}
          </div>
        </div>
      </button>
    </div>
    </CourseTheme>
  );
}
