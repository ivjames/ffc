// Per-skin illustrative art, keyed to a course's theme.
//
// Some skins go beyond CSS materials and use real image assets (see
// docs/art-spec.md): a painted scene behind each course tile (`tile`) and/or a
// crest/marker on it (`puck`). index.css gates these by `data-template`, and
// Home re-reads them for the active skin, so switching skins swaps art without
// touching anything else.
//
// Upland's Blue/Green courses use the theme keys `california` / `classic`; the
// plain `blue` / `green` aliases cover the other locations' Blue/Green courses.

export type CourseArt = { tile?: string; puck?: string };

const UNDERWATER: Record<string, CourseArt> = {
  california: { tile: '/themes/underwater/tile-blue.webp' },
  blue: { tile: '/themes/underwater/tile-blue.webp' },
  classic: { tile: '/themes/underwater/tile-green.webp' },
  green: { tile: '/themes/underwater/tile-green.webp' },
  dragon: { tile: '/themes/underwater/tile-dragon.webp' },
  western: { tile: '/themes/underwater/tile-western.webp' },
};

const FANTASY: Record<string, CourseArt> = {
  california: { tile: '/themes/fantasy/tile-castle.webp', puck: '/themes/fantasy/crest-blue.webp' },
  blue: { tile: '/themes/fantasy/tile-castle.webp', puck: '/themes/fantasy/crest-blue.webp' },
  classic: { tile: '/themes/fantasy/tile-garden.webp', puck: '/themes/fantasy/crest-green.webp' },
  green: { tile: '/themes/fantasy/tile-garden.webp', puck: '/themes/fantasy/crest-green.webp' },
  dragon: { tile: '/themes/fantasy/tile-forge.webp', puck: '/themes/fantasy/crest-dragon.webp' },
  western: { tile: '/themes/fantasy/tile-town.webp', puck: '/themes/fantasy/crest-western.webp' },
};

const BY_SKIN: Record<string, Record<string, CourseArt>> = {
  underwater: UNDERWATER,
  fantasy: FANTASY,
};

/** Image art for a course under a skin (empty if the skin ships none). */
export function courseArt(skin: string, theme: string): CourseArt {
  return BY_SKIN[skin]?.[theme] ?? {};
}
