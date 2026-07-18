import type { CSSProperties, ReactNode } from 'react';

/**
 * Lays a course's soft accent glow over the neutral page so a play/summary
 * screen reads as more than plain chrome. The environment ramp itself is global
 * and mode-aware (index.css + src/lib/mode.ts), so this no longer re-points any
 * `--color-fairway-*` variables — `var(--color-fairway-950)` already resolves
 * to the current light/dark page color.
 *
 * Wrap a whole screen: `<CourseTheme accent={course.accent}><Screen>…</Screen></CourseTheme>`.
 */
export default function CourseTheme({
  accent,
  children,
}: {
  /** Retained for call-site symmetry with the course; no longer used here. */
  theme?: string;
  /** Course accent hex, used for the soft top glow that gives each course a feel. */
  accent?: string;
  children: ReactNode;
}) {
  const style: CSSProperties = {
    background: accent
      ? `radial-gradient(120% 55% at 50% -8%, ${accent}2e, transparent 62%), var(--color-fairway-950)`
      : 'var(--color-fairway-950)',
  };

  return (
    <div style={style} className="min-h-full">
      {children}
    </div>
  );
}
