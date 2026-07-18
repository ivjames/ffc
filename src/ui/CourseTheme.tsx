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
  /** Course accent hex — feeds the surface tint, the accent glow, and buttons. */
  accent?: string;
  children: ReactNode;
}) {
  // With an accent, tint the subtree to the course (`.course-tinted` reads
  // `--course-accent`) and lay the soft glow on top; `--color-fairway-950` is
  // already the tinted, mode-aware page color.
  const style = {
    ...(accent ? { '--course-accent': accent } : {}),
    background: accent
      ? `radial-gradient(120% 55% at 50% -8%, ${accent}2e, transparent 62%), var(--color-fairway-950)`
      : 'var(--color-fairway-950)',
  } as CSSProperties;

  return (
    <div style={style} className={`min-h-full${accent ? ' course-tinted' : ''}`}>
      {children}
    </div>
  );
}
