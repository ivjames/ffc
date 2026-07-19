// Visual template / "skin".
//
// Orthogonal to light/dark (src/lib/mode.ts) and to the per-course accent
// (src/ui/CourseTheme.tsx). A skin swaps the *material* the shared surface
// classes are painted with — buttons, cards, tiles, the page background — by
// flipping a `data-template` attribute on <html>; index.css does the recoloring
// under `:root[data-template='…']`, so nothing has to re-render to change skin.
// Each skin keeps its panels dark in dark mode and light in light mode, so the
// app's `--color-fairway-*` text ramp stays legible either way; the skin's
// identity comes from structure (bevels, borders, glow, metal) + the accent.
//
// 'unstyled' is the DEFAULT — a plain, flat baseline with no gloss. 'candy' (the
// unscoped base styling in index.css) and the other looks are opt-in skins on
// top of it. The initial attribute is set by a tiny inline script in index.html
// BEFORE first paint (no flash of the wrong skin); this module reads it back and
// takes over.

export type Skin = 'unstyled' | 'candy' | 'blocky' | 'uv' | 'glass' | 'chrome';

/** The selectable skins, in picker order, with a label, one-liner, and a
 *  representative swatch color for the picker dot. */
export const SKINS: { id: Skin; label: string; blurb: string; dot: string }[] = [
  { id: 'unstyled', label: 'Unstyled', blurb: 'Plain & flat (default)', dot: '#9ca3af' },
  { id: 'candy', label: 'Candy', blurb: 'Glossy arcade keys', dot: '#22c55e' },
  { id: 'blocky', label: 'Quirky Blocky', blurb: 'Toybox neubrutalism', dot: '#ff5d5d' },
  { id: 'uv', label: 'UV Party', blurb: 'Blacklight neon', dot: '#16f2e3' },
  { id: 'glass', label: 'Glassy', blurb: 'Frosted glass', dot: '#7c9cff' },
  { id: 'chrome', label: 'Chrome', blurb: 'Liquid metal', dot: '#c9d2db' },
];

const KEY = 'ffc-skin';
const IDS: Skin[] = SKINS.map((s) => s.id);

function isSkin(v: unknown): v is Skin {
  return typeof v === 'string' && (IDS as string[]).includes(v);
}

// The user's saved choice, or null if they've never picked one (→ unstyled).
function storedSkin(): Skin | null {
  try {
    const s = localStorage.getItem(KEY);
    return isSkin(s) ? s : null;
  } catch {
    return null;
  }
}

function readInitial(): Skin {
  const attr = document.documentElement.dataset.template;
  if (isSkin(attr)) return attr;
  return storedSkin() ?? 'unstyled';
}

let current: Skin = readInitial();
const listeners = new Set<() => void>();

function apply(skin: Skin): void {
  document.documentElement.dataset.template = skin;
}

export function getSkin(): Skin {
  return current;
}

export function setSkin(skin: Skin): void {
  if (skin === current) return;
  current = skin;
  try {
    localStorage.setItem(KEY, skin);
  } catch {
    /* ignore persistence failures */
  }
  apply(skin);
  listeners.forEach((l) => l());
}

export function subscribeSkin(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Sync the attribute to whatever the inline script already applied (a no-op in
// practice, but keeps the DOM authoritative if this module loads first).
apply(current);
