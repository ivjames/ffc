// Per-course visual theming.
//
// Every screen in the app is built from the `fairway-*` Tailwind utilities, and
// Tailwind v4 compiles each of those to `var(--color-fairway-N)`. That means a
// screen can be recolored wholesale — no markup changes — just by re-pointing
// the `--color-fairway-*` custom properties on a wrapping element. This module
// holds the ramps we point them at, one per course `theme` string.
//
// Each ramp mirrors the shape of the base venue-green ramp in index.css (dark
// 950 background → bright 50 text, mid-500 the primary accent) so the existing
// contrast relationships hold under every theme. The course's own `accent` hex
// (from the seed) is layered on top for tags / par / glows.

export type Ramp = Record<
  50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950,
  string
>;

// The base venue green — identical to the @theme defaults in index.css, so the
// green courses render exactly as before and it doubles as the fallback ramp.
const GREEN: Ramp = {
  50: '#f0fdf4',
  100: '#dcfce7',
  200: '#bbf7d0',
  300: '#86efac',
  400: '#4ade80',
  500: '#22c55e',
  600: '#16a34a',
  700: '#15803d',
  800: '#166534',
  900: '#14532d',
  950: '#052e16',
};

// Muted steel/slate blue — reads as blue without the vivid electric edge,
// kept light so the screen never sinks into a dark navy wash.
const BLUE: Ramp = {
  50: '#f1f5f9',
  100: '#e3eaf1',
  200: '#cdd9e6',
  300: '#b1c3d8',
  400: '#90a8c5',
  500: '#6f8bad',
  600: '#5f7a9e',
  700: '#506585',
  800: '#415471',
  900: '#334259',
  950: '#232f40',
};

// Muted clay/brick rose — softened well back from a bold primary red, and
// lifted to a warm, light clay rather than a dark maroon.
const RED: Ramp = {
  50: '#faeeec',
  100: '#f3ddda',
  200: '#e8c4c0',
  300: '#d7a49e',
  400: '#c5847d',
  500: '#b0655e',
  600: '#98544e',
  700: '#814440',
  800: '#6b3833',
  900: '#542c29',
  950: '#3d211e',
};

// Dragon's Hollow — a lush, leafy forest green (kept airy, not a dark pine).
// The orange course accent (par / tags / top glow) rides on top as the fiery
// highlight.
const DRAGON: Ramp = {
  50: '#eef8f2',
  100: '#d3ede1',
  200: '#aedcc4',
  300: '#86cca8',
  400: '#63b78e',
  500: '#4d9a75',
  600: '#3f8163',
  700: '#326b50',
  800: '#26543f',
  900: '#1d4230',
  950: '#14311f',
};

// Western — sun-bleached leather and tan; a warm, light dust-brown, well clear
// of the near-black saddle it started as.
const WESTERN: Ramp = {
  50: '#fbf7ee',
  100: '#f5ecd6',
  200: '#ebdcb8',
  300: '#dcc396',
  400: '#cba97a',
  500: '#b89563',
  600: '#9c8052',
  700: '#856b45',
  800: '#6f583a',
  900: '#5c4830',
  950: '#4a3925',
};

const RAMPS: Record<string, Ramp> = {
  green: GREEN,
  blue: BLUE,
  red: RED,
  dragon: DRAGON,
  western: WESTERN,
};

/** The color ramp for a course theme; unknown themes fall back to venue green. */
export function rampFor(theme: string): Ramp {
  return RAMPS[theme] ?? GREEN;
}

/**
 * Inline `--color-fairway-*` overrides for a theme, ready to spread onto a
 * wrapping element's `style`. Descendant `fairway-*` utilities pick these up.
 */
export function themeVars(theme: string): Record<string, string> {
  const ramp = rampFor(theme);
  const vars: Record<string, string> = {};
  for (const [shade, hex] of Object.entries(ramp)) {
    vars[`--color-fairway-${shade}`] = hex;
  }
  return vars;
}

/** The darkest ramp step — the page background for a themed screen. */
export function themeBackdrop(theme: string): string {
  return rampFor(theme)[950];
}

/** Emoji marker for a course theme (shared by every course tile/placeholder). */
export function themeEmoji(theme: string): string {
  switch (theme) {
    case 'blue':
      return '🔵';
    case 'green':
      return '🟢';
    case 'red':
      return '🔴';
    case 'dragon':
      return '🐉';
    case 'western':
      return '🤠';
    // Retained for any legacy themed courses.
    case 'jungle':
      return '🌴';
    case 'pirate':
      return '🏴‍☠️';
    case 'space':
      return '🚀';
    case 'haunted':
      return '👻';
    default:
      return '⛳️';
  }
}
