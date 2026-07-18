import { useLayoutEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { themeVars, themeBackdrop } from '../lib/theme';

// Keep the browser/PWA chrome color in step with the themed screen, restoring
// the previous value when we leave. Multiple themed screens can mount in a row
// (scorecard → summary); each records the value it found and puts it back, so
// the chrome always ends up at whatever the last un-themed screen wants.
function setMetaThemeColor(color: string): string | null {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!(meta instanceof HTMLMetaElement)) return null;
  const prev = meta.content;
  meta.content = color;
  return prev;
}

/**
 * Recolors its subtree — and the surrounding page — to a course's theme while
 * mounted. Overriding the `--color-fairway-*` variables on the wrapper cascades
 * to every `fairway-*` utility inside it (see src/lib/theme.ts); the body
 * backdrop and the PWA theme-color meta are synced so the effect reaches the
 * safe-area padding and the OS status bar too, not just the card area.
 *
 * Wrap a whole screen: `<CourseTheme theme={course.theme}><Screen>…</Screen></CourseTheme>`.
 */
export default function CourseTheme({
  theme,
  accent,
  children,
}: {
  theme: string;
  /** Course accent hex, used for the soft top glow that gives each course a feel. */
  accent?: string;
  children: ReactNode;
}) {
  const backdrop = themeBackdrop(theme);

  // Sync the parts outside this subtree: the <body> backdrop (shows through the
  // PWA safe-area padding) and the status-bar color. useLayoutEffect so the swap
  // lands before paint, avoiding a flash of the previous theme.
  useLayoutEffect(() => {
    const prevBg = document.body.style.background;
    document.body.style.background = backdrop;
    const prevMeta = setMetaThemeColor(backdrop);
    return () => {
      document.body.style.background = prevBg;
      if (prevMeta != null) setMetaThemeColor(prevMeta);
    };
  }, [backdrop]);

  // The variable overrides, plus a subtle accent glow bled into the background
  // so a course reads as more than a recolored green.
  const style: CSSProperties = {
    ...(themeVars(theme) as CSSProperties),
    background: accent
      ? `radial-gradient(120% 55% at 50% -8%, ${accent}2e, transparent 62%), ${backdrop}`
      : backdrop,
  };

  return (
    <div style={style} className="min-h-full">
      {children}
    </div>
  );
}
