import { Screen, TopBar, Content } from '../../ui/components';
import { coursesByLocation } from '../../data/courses';
import { useCurrentLocationId } from '../../lib/location';
import { STROKE_CAP } from '../../lib/scoring';

// §5.3 Rules — general rules + optional per-course notes. Static bundled
// content, works offline.
const GENERAL_RULES = [
  'Play holes in order, 1 through 18. Lowest total strokes wins.',
  'Count one stroke each time you hit the ball. If you miss, that still counts.',
  `Maximum ${STROKE_CAP} strokes per hole — pick up and record ${STROKE_CAP} if you reach the cap.`,
  'A ball knocked off the course is replayed from where it left, with a one-stroke penalty.',
  'Honesty system: record your own strokes. Ties share the position.',
  'Be quick and courteous — let faster groups play through.',
];

export default function Rules() {
  const courses = coursesByLocation(useCurrentLocationId());
  const noted = courses.filter((c) => c.rules && c.rules.length > 0);
  return (
    <Screen>
      <TopBar title="Rules" back="/" />
      <Content>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fairway-400">
          General
        </h2>
        <ul className="space-y-3">
          {GENERAL_RULES.map((r, i) => (
            <li key={i} className="flex gap-3 text-fairway-100/90">
              <span className="font-mono text-sm text-fairway-500">{i + 1}.</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>

        {noted.length > 0 && (
          <>
            <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-fairway-400">
              Course notes
            </h2>
            <div className="space-y-4">
              {noted.map((c) => (
                <div
                  key={c.id}
                  className="rounded-2xl border border-fairway-800 bg-fairway-900/40 p-4"
                >
                  <div className="mb-2 font-bold" style={{ color: c.accent }}>
                    {c.name}
                  </div>
                  <ul className="space-y-2">
                    {c.rules!.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm text-fairway-100/80">
                        <span style={{ color: c.accent }}>•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </Content>
    </Screen>
  );
}
