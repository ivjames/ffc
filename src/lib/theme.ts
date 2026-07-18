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

const BLUE: Ramp = {
  50: '#eff6ff',
  100: '#dbeafe',
  200: '#bfdbfe',
  300: '#93c5fd',
  400: '#60a5fa',
  500: '#3b82f6',
  600: '#2563eb',
  700: '#1d4ed8',
  800: '#1e40af',
  900: '#172554',
  950: '#0b1533',
};

const RED: Ramp = {
  50: '#fef2f2',
  100: '#fee2e2',
  200: '#fecaca',
  300: '#fca5a5',
  400: '#f87171',
  500: '#ef4444',
  600: '#dc2626',
  700: '#b91c1c',
  800: '#991b1b',
  900: '#7f1d1d',
  950: '#340606',
};

// Dragon's Hollow — fiery embers, deep charred background.
const DRAGON: Ramp = {
  50: '#fff7ed',
  100: '#ffedd5',
  200: '#fed7aa',
  300: '#fdba74',
  400: '#fb923c',
  500: '#f97316',
  600: '#ea580c',
  700: '#c2410c',
  800: '#9a3412',
  900: '#7c2d12',
  950: '#26120a',
};

// Western — warm leather, desert amber, dark saddle-brown background.
const WESTERN: Ramp = {
  50: '#fffbeb',
  100: '#fef3c7',
  200: '#fde68a',
  300: '#fcd34d',
  400: '#fbbf24',
  500: '#f59e0b',
  600: '#d97706',
  700: '#b45309',
  800: '#92400e',
  900: '#78350f',
  950: '#2a1404',
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
