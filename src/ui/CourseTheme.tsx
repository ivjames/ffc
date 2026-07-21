import type { CSSProperties, ReactNode } from 'react';

/**
 * Lays a course's soft accent glow over the page so a play/summary screen reads
 * as more than plain chrome. Both the environment ramp and the active skin's
 * page background are global and mode-aware (index.css + src/lib/mode.ts +
 * src/lib/skin.ts, keyed on the `data-theme`/`data-template` attributes on
 * <html>), so this only layers the accent glow — the base stays TRANSPARENT so
 * the current skin's decorative background (candy gradient, blocky dots, UV
 * grid, glass aurora, chrome metal) shows through here too. Painting an opaque
 * `var(--color-fairway-950)` fill instead covered that skin background, so the
 * chosen skin visually vanished on every CourseTheme screen (scorecard, summary,
 * setup, map) even though the attribute persisted.
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
  // `--course-accent`) and lay the soft glow on top. The base is left
  // transparent so the active skin's page background (painted on <body> in
  // index.css) shows through instead of being masked by a flat fill.
  const style = {
    ...(accent ? { '--course-accent': accent } : {}),
    ...(accent
      ? { background: `radial-gradient(120% 55% at 50% -8%, ${accent}2e, transparent 62%)` }
      : {}),
  } as CSSProperties;

  return (
    <div style={style} className={`min-h-full${accent ? ' course-tinted' : ''}`}>
      {children}
    </div>
  );
}
