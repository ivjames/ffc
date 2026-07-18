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

// Muted steel/slate blue — reads as blue without the vivid electric edge.
const BLUE: Ramp = {
  50: '#eef2f7',
  100: '#dbe3ee',
  200: '#bccbdd',
  300: '#97afc9',
  400: '#7091b0',
  500: '#5578a0',
  600: '#45638a',
  700: '#3a5273',
  800: '#324459',
  900: '#26344a',
  950: '#141d2b',
};

// Muted clay/brick rose — softened well back from a bold primary red.
const RED: Ramp = {
  50: '#f8ecea',
  100: '#f0d6d3',
  200: '#e3b5b0',
  300: '#d1908a',
  400: '#bd6f68',
  500: '#a95850',
  600: '#8f463f',
  700: '#763833',
  800: '#5e2d29',
  900: '#472220',
  950: '#2a1614',
};

// Dragon's Hollow — a lush, leafy forest green. The orange course accent
// (par / tags / top glow) rides on top as the fiery highlight.
const DRAGON: Ramp = {
  50: '#edf7f1',
  100: '#cfece0',
  200: '#a3d9bf',
  300: '#74c69d',
  400: '#52b788',
  500: '#40916c',
  600: '#2d6a4f',
  700: '#245741',
  800: '#1b4332',
  900: '#123024',
  950: '#0a1f14',
};

// Western — sun-bleached leather and tan; a warm, light dust-brown, not the
// near-black saddle it started as.
const WESTERN: Ramp = {
  50: '#faf6ec',
  100: '#f2e8d2',
  200: '#e6d5b0',
  300: '#d7bd87',
  400: '#c4a266',
  500: '#b08752',
  600: '#97703f',
  700: '#7c5d38',
  800: '#634a2d',
  900: '#4c3924',
  950: '#352819',
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
