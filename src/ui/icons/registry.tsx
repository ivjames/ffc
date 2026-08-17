import type { ReactNode } from 'react';
import type { IconName } from './manifest';
import { VENDORED_ART, FILLED_ART } from './vendored.generated';

// The art, from three sources, chosen per icon rather than per library.
//
//   LUCIDE (68)   the generic vocabulary — house, camera, bell, lock, trophy,
//                 sun/moon, the whole food-order rail. Stroked on a 24 grid,
//                 which is exactly the spec below, so it drops in untouched.
//   PHOSPHOR (7)  arcade subjects no other set has: bowling-ball, golf,
//                 basketball, baseball, hockey, steering-wheel, flag-checkered.
//                 FILLED on a 256 grid — a different rendering mode, taken
//                 anyway because these were the weakest drawings in the set.
//   BESPOKE (11)  what remains here. A skee-ball alley, a claw machine, a
//                 milk-bottle pyramid, a high striker — nobody draws these.
//                 They want a real illustrator; manifest.ts holds the briefs.
//
// Both vendored sets come in through scripts/vendor-icons.mjs, which records
// why each pick was made and what the Phosphor mix costs.
//
// House style for anything hand-drawn here, so the three read as one set:
//   · 24×24 viewBox, artwork kept inside 2…22 so nothing clips when rounded
//   · monoline: stroke only, no fills. The Phosphor icons are the deliberate
//     exception and are isolated in FILLED_ART; do not start filling paths in
//     this file, because a fill here would ignore <Icon>'s stroke spec silently
//   · stroke width, caps and joins come from <Icon>, never from a path here
//   · one idea per icon; if it needs three elements to read, it is too busy
//
// Each entry's comment records the DISTINCTION it is carrying — what this icon
// must not be mistaken for. Those notes are the reason the set exists: 84 emoji
// were doing 121 jobs, and the merges they forced (bowling/skee-ball,
// mallet/hammer, water-jet/splash) are invisible once the art is drawn. Delete a
// note and the next person redraws the collision back in.
//
// Coverage is deliberately partial while the set is being drawn, and the type
// makes that safe: `DrawnIcon` is the keys of THIS object, so <Icon> accepts
// only names that have art. Referencing a manifest name nobody has drawn yet is
// a typecheck failure, not a blank square shipped to a player.

/** The hand-drawn half — arcade attractions no general icon set covers. */
const BESPOKE_ART = {
  // ── The arcade roster ─────────────────────────────────────────────────────

  // Skee-Ball — an UP-RAMP into CONCENTRIC RINGS. Shared 🎳 with bowling; the
  // ramp-and-rings is the half that makes it skee-ball and not a lane game.
  'game.skee-ball': (
    <>
      <path d="M3 21l4.5-13h9L21 21" />
      <circle cx="12" cy="10.5" r="2.6" />
      <circle cx="12" cy="10.5" r="0.6" />
      <circle cx="12" cy="17.5" r="2" />
    </>
  ),

  // Bumper cars — a tub car with a BUMPER SKIRT and the ceiling-grid pole.
  // Shares its bumper ring with bumper boats; the pole and wheels are the tell.
  'game.bumper-cars': (
    <>
      <path d="M3 3h18" />
      <path d="M13 3v6" />
      <path d="M7 15v-3a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v3" />
      <rect x="3" y="15" width="18" height="4.5" rx="2.25" />
    </>
  ),

  // Bumper boats — the same bumper ring, but ON WATER. No pole, no wheels.
  'game.bumper-boats': (
    <>
      <path d="M8 12V8a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4" />
      <rect x="4" y="12" width="16" height="4" rx="2" />
      <path d="M3 20c1.5 0 1.5-1.2 3-1.2s1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2" />
    </>
  ),

  // Milk bottles — three bottles in a pyramid.
  'game.milk-bottles': (
    <>
      <path d="M10 3h1.6v1.8c0 .7.7 1.1.7 2V11h-3V6.8c0-.9.7-1.3.7-2V3z" />
      <path d="M5.6 13h1.6v1.8c0 .7.7 1.1.7 2V21h-3v-4.2c0-.9.7-1.3.7-2V13z" />
      <path d="M14.6 13h1.6v1.8c0 .7.7 1.1.7 2V21h-3v-4.2c0-.9.7-1.3.7-2V13z" />
    </>
  ),

  // Claw machine — a THREE-PRONG CLAW descending over a prize.
  'game.claw-machine': (
    <>
      <path d="M12 3v4" />
      <path d="M8 9h8" />
      <path d="M8 9v3c0 1 .6 2 1.6 2.6M16 9v3c0 1-.6 2-1.6 2.6M12 9v4" />
      <circle cx="12" cy="18.5" r="2.5" />
    </>
  ),

  // Shooting gallery — a carnival duck ON A RAIL.
  'game.shooting-gallery': (
    <>
      <circle cx="14" cy="6.5" r="2.5" />
      <path d="M16.5 6h3l-2 2" />
      <path d="M12 8.6c-3 .7-6 1.9-6 4.2C6 15 8.2 16 11 16h1.5c3 0 5-1.6 5-4" />
      <path d="M11.5 16v3" />
      <path d="M4 19h16" />
    </>
  ),

  // Whack-a-Mole — a SOFT-HEADED MALLET over a hole. The 🔨 split: this is the
  // wide mallet head and a hole; high striker is a long-handled hammer.
  'game.whack-a-mole': (
    <>
      <rect x="9" y="3" width="11" height="5" rx="1.5" />
      <path d="M14.5 8v3" />
      <ellipse cx="8" cy="18" rx="6" ry="2.5" />
      <path d="M5.5 18c0-1.6 1.1-2.5 2.5-2.5s2.5.9 2.5 2.5" />
    </>
  ),

  // Ring toss — a ring MID-AIR over an upright peg.
  'game.ring-toss': (
    <>
      <ellipse cx="12" cy="9" rx="6" ry="2.5" />
      <path d="M12 4v13" />
      <path d="M7 20h10" />
      <path d="M12 17c-2 0-3 1.3-3 3h6c0-1.7-1-3-3-3z" />
    </>
  ),

  // Water gun race — a pistol with an AIMED JET. score.water-hazard is the
  // splash-in-a-pond; both were 💦 and they mean opposite things.
  'game.water-gun-race': (
    <>
      <path d="M3 8h9v4H8l-2 4H4l1.5-4H3z" />
      <path d="M12 9.5h3" />
      <path d="M17 7.5c1 .8 1 1.7 0 2.5M20 6c2 1.8 2 4.2 0 6" />
    </>
  ),

  // Pinball — TWO FLIPPERS with the ball between them.
  'game.pinball': (
    <>
      <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
      <circle cx="9.5" cy="8" r="1.8" />
      <circle cx="15" cy="12" r="1" />
      <path d="M7.5 16.5l2.5 2.5M16.5 16.5L14 19" />
    </>
  ),

  // Challenge spinner — a segmented wheel with a POINTER at the top.
  'game.challenge-spinner': (
    <>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 6.5v14M5 13.5h14M7.1 8.6l9.8 9.8M16.9 8.6l-9.8 9.8" />
      <path d="M10 2.5h4l-2 3z" />
    </>
  ),

} satisfies Partial<Record<IconName, ReactNode>>;

/**
 * Every icon that has art today. Bespoke last, so a hand-drawn entry
 * deliberately overrides a vendored one of the same name rather than the merge
 * order deciding it silently.
 */
export const ICON_ART = { ...VENDORED_ART, ...FILLED_ART, ...BESPOKE_ART };

/**
 * The icons that paint as fills on a 256 grid instead of strokes on a 24 one.
 * <Icon> reads this to pick the coordinate system and paint mode; it is derived
 * from FILLED_ART rather than hand-listed so it cannot fall out of step with
 * what was actually vendored.
 */
export const FILLED_ICONS = new Set<string>(Object.keys(FILLED_ART));

/** The icon names that actually have art today. <Icon> accepts only these. */
export type DrawnIcon = keyof typeof ICON_ART;
