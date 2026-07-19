// Per-course visual theming.
//
// The environment (backgrounds, cards, borders) is a neutral ramp shared by
// every screen, defined in index.css with a dark and a light set (see
// src/lib/mode.ts). Per-course identity is carried entirely by the accent ink +
// glow layered on top of that neutral chrome.

// Themes that have a tuned accent ink; anything else uses `default`.
const INK_THEMES = new Set(['green', 'blue', 'red', 'western', 'dragon']);

/**
 * Accent color for TEXT on the neutral chrome (tags, par, rules headings) — the
 * per-course color identity. Returns a CSS variable (defined per mode in
 * index.css: `--ink-*`) so the ink automatically darkens in light mode to stay
 * WCAG-AA legible, without the caller re-rendering on a theme switch. The raw
 * course `accent` hex is left for decorative fills/glows.
 */
export function accentInk(theme: string): string {
  return `var(--ink-${INK_THEMES.has(theme) ? theme : 'default'})`;
}

/**
 * Human-readable name for a course theme, shown as the tile subtitle. Falls back
 * to the raw theme key (capitalized by the caller) for themes without a label.
 */
export function themeLabel(theme: string): string {
  switch (theme) {
    case 'blue':
      return 'California';
    case 'green':
      return 'Classic mini golf';
    default:
      return theme;
  }
}

/** Emoji marker for a course theme (shared by every course tile/placeholder). */
export function themeEmoji(theme: string): string {
  switch (theme) {
    // Blue Course — California themed (palm / coast).
    case 'blue':
      return '🌴';
    // Green Course — classic mini golf themed (flag in the cup).
    case 'green':
      return '⛳️';
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
