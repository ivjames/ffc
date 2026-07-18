// Per-course visual theming.
//
// Every screen in the app is built from the `fairway-*` Tailwind utilities, and
// Tailwind v4 compiles each of those to `var(--color-fairway-N)`. That means a
// screen can be recolored wholesale — no markup changes — just by re-pointing
// the `--color-fairway-*` custom properties on a wrapping element.
//
// The environment ramp is neutral grayscale, shared by every screen and every
// course. Per-course identity is carried entirely by the accent ink + glow
// (see `accentInk` below and the accent glow in CourseTheme) layered on top of
// this neutral chrome — the backgrounds/cards/borders themselves stay gray.

export type Ramp = Record<
  50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950,
  string
>;

// The neutral grayscale environment — identical to the @theme defaults in
// index.css. Every theme resolves to this ramp; only the accent ink/glow
// differ per course. Each step's gray matches the LIGHTNESS of the old venue-
// green step it replaced, so the UI keeps its former depth (e.g. 950 is a dark
// gray page, not near-black) — just desaturated.
const GRAY: Ramp = {
  50: '#f7f7f7',
  100: '#ececec',
  200: '#d9d9d9',
  300: '#bbbbbb',
  400: '#949494',
  500: '#747474',
  600: '#5d5d5d',
  700: '#4b4b4b',
  800: '#3e3e3e',
  900: '#343434',
  950: '#1a1a1a',
};

/** The environment ramp — neutral grayscale for every theme. */
export function rampFor(_theme: string): Ramp {
  return GRAY;
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

// Contrast-safe accent for TEXT on the neutral chrome (tags, par, rules
// headings) — this is the per-course color identity now that the environment
// ramp is grayscale. The raw course `accent` is a mid-tone brand hex; these are
// lifted light steps so accent text clears WCAG AA (4.5:1) on both the near-
// black page background and the slightly lighter gray cards. Dragon keeps a
// warm orange to match its fiery highlight.
const ACCENT_INK: Record<string, string> = {
  green: '#85e0a5',
  blue: '#b1c3d8',
  red: '#d7a49e',
  western: '#dcc396',
  dragon: '#fdba74',
};

/**
 * Accent color to use for text on the neutral chrome — WCAG-AA legible, unlike
 * the raw course `accent` (which stays for decorative fills/glows). Unknown
 * themes fall back to a light green step.
 */
export function accentInk(theme: string): string {
  return ACCENT_INK[theme] ?? '#86efac';
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
