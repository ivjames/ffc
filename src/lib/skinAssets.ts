// Per-skin illustrative art, keyed to a course's theme.
//
// Some skins go beyond CSS materials and use real image assets (see
// docs/art-spec.md). The 'underwater' skin ships a painted scene per course as
// the tile background. index.css gates these by `data-template`, so the value
// is set on the element unconditionally and simply ignored under other skins —
// that keeps live skin-switching a pure-CSS operation (no React re-render).
//
// This is a prototype registry (one skin). Generalize to `art(skin, theme)`
// when more skins ship image assets.

// Keyed by course `theme`. Upland's Blue/Green courses use the theme keys
// `california` / `classic`; the plain `blue` / `green` aliases cover the other
// locations' Blue/Green courses so they get the same scenes.
const UNDERWATER_TILE: Record<string, string> = {
  california: '/themes/underwater/tile-blue.webp',
  blue: '/themes/underwater/tile-blue.webp',
  classic: '/themes/underwater/tile-green.webp',
  green: '/themes/underwater/tile-green.webp',
  dragon: '/themes/underwater/tile-dragon.webp',
  western: '/themes/underwater/tile-western.webp',
};

/** The tile scene art for a course theme, or undefined if none exists. */
export function tileArt(theme: string): string | undefined {
  return UNDERWATER_TILE[theme];
}
