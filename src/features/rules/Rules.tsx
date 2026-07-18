import { Screen, TopBar, Content } from '../../ui/components';
import { coursesByLocation } from '../../data/courses';
import { useCurrentLocationId } from '../../lib/location';
import { accentInk, themeEmoji } from '../../lib/theme';
import type { CSSProperties } from 'react';
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
              <span className="font-mono text-sm text-fairway-400">{i + 1}.</span>
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
              {noted.map((c) => {
                const ink = accentInk(c.theme);
                // Tint the card to its course (`.course-tinted` reads
                // `--course-accent`) and add a soft accent glow in the corner —
                // the card surface (var(--color-fairway-900)) is already tinted.
                const cardStyle = {
                  '--course-accent': c.accent,
                  background: `radial-gradient(120% 80% at 0% 0%, ${c.accent}1f, transparent 60%), var(--color-fairway-900)`,
                } as CSSProperties;
                return (
                  <div
                    key={c.id}
                    style={cardStyle}
                    className="course-tinted rounded-2xl border border-fairway-700/60 p-4"
                  >
                    <div className="mb-3 flex items-center gap-2">
                      <span aria-hidden className="text-lg">
                        {themeEmoji(c.theme)}
                      </span>
                      <span className="font-bold" style={{ color: ink }}>
                        {c.name}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {c.rules!.map((r, i) => (
                        <li key={i} className="flex gap-2 text-sm text-fairway-100/85">
                          <span aria-hidden style={{ color: ink }}>
                            •
                          </span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Content>
    </Screen>
  );
}
