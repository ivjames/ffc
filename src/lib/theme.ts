import type { DrawnIcon } from '../ui/icons/registry';
// Per-course visual theming.
//
// The environment (backgrounds, cards, borders) is a neutral ramp shared by
// every screen, defined in index.css with a dark and a light set (see
// src/lib/mode.ts). Per-course identity is carried entirely by the accent ink +
// glow layered on top of that neutral chrome.

// Themes that have a tuned accent ink; anything else uses `default`.
const INK_THEMES = new Set(['green', 'blue', 'red', 'western', 'dragon']);

// Themes that borrow another theme's tuned ink because they share its color
// family (e.g. the California-themed course is still visually blue). Keeps the
// ink table small — no need for a near-duplicate `--ink-california` in index.css.
const INK_ALIAS: Record<string, string> = {
  california: 'blue',
  classic: 'green',
};

/**
 * Accent color for TEXT on the neutral chrome (tags, par, rules headings) — the
 * per-course color identity. Returns a CSS variable (defined per mode in
 * index.css: `--ink-*`) so the ink automatically darkens in light mode to stay
 * WCAG-AA legible, without the caller re-rendering on a theme switch. The raw
 * course `accent` hex is left for decorative fills/glows.
 */
export function accentInk(theme: string): string {
  const key = INK_ALIAS[theme] ?? theme;
  return `var(--ink-${INK_THEMES.has(key) ? key : 'default'})`;
}

/**
 * Human-readable name for a course theme, shown as the tile subtitle. Falls back
 * to the raw theme key (capitalized by the caller) for themes without a label.
 */
export function themeLabel(theme: string): string {
  switch (theme) {
    case 'california':
      return 'California';
    case 'classic':
      return 'Classic mini golf';
    // Generic/color themes fall through to the raw key (the caller capitalizes).
    default:
      return theme;
  }
}

/**
 * Icon for a course theme (shared by every course tile/placeholder).
 *
 * Returns a NAME, not a picture — 'classic' and the default arm both used to
 * return ⛳️ and 'california'/'jungle' both returned 🌴, which quietly collapsed
 * four courses into two markers. Each arm now names its own icon, so the
 * courses stay distinguishable however the art is later redrawn.
 */
export function themeIcon(theme: string): DrawnIcon {
  switch (theme) {
    case 'blue':
      return 'course.blue';
    case 'green':
      return 'course.green';
    // Upland's individually themed Blue/Green courses.
    case 'california':
      return 'course.california';
    case 'classic':
      return 'course.classic';
    case 'red':
      return 'course.red';
    case 'dragon':
      return 'course.dragon';
    case 'western':
      return 'course.western';
    // Retained for any legacy themed courses.
    case 'jungle':
      return 'course.jungle';
    case 'pirate':
      return 'course.pirate';
    case 'space':
      return 'course.space';
    case 'haunted':
      return 'course.haunted';
    default:
      return 'course.default';
  }
}
