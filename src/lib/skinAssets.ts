// Per-skin illustrative art, keyed to a course's theme AND the active mode.
//
// Some skins go beyond CSS materials and use real image assets (see
// docs/art-spec.md): a painted scene behind each course tile (`tile`), a
// crest/marker on it (`puck`), or a fully composed course card (`card` — frame,
// artwork, crest, and name baked in; the tile then hides its own label/puck).
// index.css gates these by `data-template`/`data-theme`, and Home re-reads them
// for the active skin + mode, so switching either swaps the art.
//
// Upland's Blue/Green courses use the theme keys `california` / `classic`; the
// plain `blue` / `green` aliases cover the other locations' Blue/Green courses.

export type Mode = 'light' | 'dark';
export type CourseArt = { tile?: string; puck?: string; card?: boolean };

// theme key -> (scene name, crest name)
const FANTASY_MAP: Record<string, { scene: string; crest: string }> = {
  california: { scene: 'castle', crest: 'blue' },
  blue: { scene: 'castle', crest: 'blue' },
  classic: { scene: 'garden', crest: 'green' },
  green: { scene: 'garden', crest: 'green' },
  dragon: { scene: 'forge', crest: 'dragon' },
  western: { scene: 'town', crest: 'western' },
};

const UNDERWATER: Record<string, string> = {
  california: 'blue',
  blue: 'blue',
  classic: 'green',
  green: 'green',
  dragon: 'dragon',
  western: 'western',
};

/** Image art for a course under a skin + mode (empty if the skin ships none). */
export function courseArt(skin: string, theme: string, mode: Mode): CourseArt {
  if (skin === 'fantasy') {
    const m = FANTASY_MAP[theme];
    if (!m) return {};
    // Light mode ships fully-composed course cards; dark composites a painted
    // scene + heraldic crest over a frame.
    if (mode === 'light') return { tile: `/themes/fantasy/card-${m.scene}.webp`, card: true };
    return { tile: `/themes/fantasy/tile-${m.scene}.webp`, puck: `/themes/fantasy/crest-${m.crest}.webp` };
  }
  if (skin === 'cyberpunk') {
    // Fully-composed neon cards in both modes: the dark neon "billboards" read
    // over the night skyline (dark) and pop against the day street (light).
    const n = UNDERWATER[theme]; // same theme→blue/green/dragon/western keys
    return n ? { tile: `/themes/cyberpunk/card-${n}.webp`, card: true } : {};
  }
  if (skin === 'forest') {
    // Fully-composed enchanted-forest cards (frame + scene + crest + name baked
    // in) in both modes; light is the daytime kit, dark reuses the same art.
    const n = UNDERWATER[theme]; // same theme→blue/green/dragon/western keys
    return n ? { tile: `/themes/forest/card-${n}.webp`, card: true } : {};
  }
  if (skin === 'nautical') {
    // Fully-composed pirate-cove cards (wood frame + scene + crest + name baked
    // in) in both modes; light is the daytime kit, dark reuses the same art.
    const n = UNDERWATER[theme]; // same theme→blue/green/dragon/western keys
    return n ? { tile: `/themes/nautical/card-${n}.webp`, card: true } : {};
  }
  if (skin === 'space') {
    // Fully-composed space-colony cards (metal frame + scene + hex crest + name
    // baked in) in both modes; dark is the native look, light reuses the art.
    const n = UNDERWATER[theme]; // same theme→blue/green/dragon/western keys
    return n ? { tile: `/themes/space/card-${n}.webp`, card: true } : {};
  }
  if (skin === 'zen') {
    // Fully-composed zen-garden cards (fret-corner frame + scene + crest + name
    // baked in) in both modes; light is the daytime kit, dark reuses the art.
    const n = UNDERWATER[theme]; // same theme→blue/green/dragon/western keys
    return n ? { tile: `/themes/zen/card-${n}.webp`, card: true } : {};
  }
  if (skin === 'steampunk') {
    // Fully-composed Victorian-city cards (brass frame + scene + crest + name
    // baked in) in both modes; dark is the native look, light reuses the art.
    const n = UNDERWATER[theme]; // same theme→blue/green/dragon/western keys
    return n ? { tile: `/themes/steampunk/card-${n}.webp`, card: true } : {};
  }
  if (skin === 'underwater') {
    const n = UNDERWATER[theme];
    return n ? { tile: `/themes/underwater/tile-${n}.webp` } : {};
  }
  return {};
}
