import type { ReactNode } from 'react';
import type { IconName } from './manifest';

// The art. One entry per icon name in the manifest.
//
// House style, so 97 drawings read as one set:
//   · 24×24 viewBox, artwork kept inside 2…22 so nothing clips when rounded
//   · monoline: stroke only, NO fills — fills break `currentColor` inheritance
//     and would need a per-skin variant, which is exactly what this avoids
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

export const ICON_ART = {
  // ── The arcade roster ─────────────────────────────────────────────────────

  // Fun Facts — a bulb WITH a radiating burst. action.hint is the same bulb
  // without the burst, so the two never collapse into one drawing.
  'game.fun-facts': (
    <>
      <path d="M9 17h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z" />
    </>
  ),

  // Trivia — a brain in profile with a question mark. Not state.cpu's head.
  'game.trivia': (
    <>
      <path d="M12 5.5a3.5 3.5 0 0 0-6.6-1.6A3 3 0 0 0 4 9.4a3.5 3.5 0 0 0 1.6 5.9A3 3 0 0 0 11 17v-1" />
      <path d="M14.5 8.5a2.2 2.2 0 1 1 3 2c-.9.5-1.4 1-1.4 2M16 17h.01" />
      <path d="M12 5.5V12" />
    </>
  ),

  // Arcade Putt — a PUTTER HEAD addressing a ball. nav.golf is the pin flag;
  // this is the in-app mini-game, and the two were both ⛳️.
  'game.arcade-putt': (
    <>
      <path d="M16 3v9" />
      <path d="M16 12h3.5a.5.5 0 0 1 .5.5V15h-6v-2.5a.5.5 0 0 1 .5-.5z" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M3 21h18" />
    </>
  ),

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

  // Bowling — a BALL WITH FINGER HOLES and pins behind it. The other half of
  // the 🎳 split: ball-and-pins, no ramp, no rings.
  'game.bowling': (
    <>
      <circle cx="8" cy="15" r="6" />
      <path d="M6 12.5h.01M9.5 11.5h.01M7.5 16h.01" />
      <path d="M17 3c1.1 0 1.8 1.2 1.8 2.6 0 1-.5 1.7-.5 2.7 0 1.3 1 2.1 1 3.7 0 1.4-1 2.2-2.3 2.2s-2.3-.8-2.3-2.2c0-1.6 1-2.4 1-3.7 0-1-.5-1.7-.5-2.7C15.2 4.2 15.9 3 17 3z" />
    </>
  ),

  // Air hockey — a STRIKER (mallet with a knob) above a puck.
  'game.air-hockey': (
    <>
      <path d="M9 4v3" />
      <ellipse cx="9" cy="9.5" rx="5" ry="2.5" />
      <ellipse cx="16" cy="17.5" rx="4" ry="2" />
      <path d="M12 17.5v1.5a4 4 0 0 0 8 0v-1.5" />
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

  // Axe throwing — a hatchet IN FLIGHT toward a target edge.
  'game.axe-throwing': (
    <>
      <path d="M4 20L13 11" />
      <path d="M12 6.5a4.5 4.5 0 0 1 6.5 6.2c-1.6-2-3-2.6-4-2.6-1 0-1.7.5-2.5-.6-.8-1.1-.5-2.3 0-3z" />
      <path d="M19 20a5 5 0 0 0 0-8" />
    </>
  ),

  // Batting cages — a bat crossed behind a ball, with the cage mesh hinted.
  'game.batting-cages': (
    <>
      <path d="M4 20l7.5-7.5" />
      <path d="M12.5 11.5l5.5-5.5a2 2 0 0 0-2.8-2.8l-5.5 5.5z" />
      <circle cx="7" cy="8" r="3" />
      <path d="M5.2 5.6C6.4 6.5 7 7.6 7 9M8.8 5.6C7.6 6.5 7 7.6 7 9" />
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

  // Darts — a BOARD with a dart struck off-centre. award.hole-in-one also used
  // 🎯 but is a badge; this one is unmistakably a dartboard.
  'game.darts': (
    <>
      <circle cx="11" cy="13" r="8" />
      <circle cx="11" cy="13" r="3.5" />
      <path d="M11 13l9-9" />
      <path d="M17.5 3.5L20.5 3l-.5 3" />
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

  // Pop-a-Shot — a ball ARCING INTO a hoop with a net.
  'game.pop-a-shot': (
    <>
      <rect x="8" y="2.5" width="13" height="8" rx="1" />
      <path d="M10.5 11.5h8" />
      <path d="M11.5 11.5l1.3 4.5h3.4l1.3-4.5" />
      <circle cx="5" cy="17" r="3" />
    </>
  ),

  // Go-karts — a KART, with the chequered flag only as a motif behind it.
  // state.finish is the flag ALONE; both were 🏁.
  'game.go-karts': (
    <>
      <circle cx="13.5" cy="6" r="2.2" />
      <path d="M3 16h2.5l2.5-4.5h6L17 16h4" />
      <path d="M11 11.5l1.3-3.4" />
      <circle cx="6" cy="17.5" r="2.2" />
      <circle cx="18" cy="17.5" r="2.2" />
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

  // High striker — a LONG-HANDLED HAMMER beside a tower with a BELL on top.
  // The other 🔨, and also the other 🔔 (order.ready is a service bell).
  'game.high-striker': (
    <>
      <path d="M13 21V9" />
      <path d="M10 9h6" />
      <path d="M13 6.5a2.5 2.5 0 0 1 5 0" />
      <path d="M4 21l3.5-6" />
      <rect x="5.5" y="10.5" width="5" height="3" rx="1" transform="rotate(-35 8 12)" />
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

  // Coin pusher — a stack of coins with ONE TIPPING over the ledge.
  'game.coin-pusher': (
    <>
      <ellipse cx="9" cy="7" rx="5" ry="2" />
      <path d="M4 7v3c0 1.1 2.2 2 5 2s5-.9 5-2V7" />
      <path d="M4 12v3c0 1.1 2.2 2 5 2s5-.9 5-2v-3" />
      <path d="M3 20h18" />
      <ellipse cx="18" cy="18" rx="3" ry="1.2" transform="rotate(-25 18 18)" />
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

  // ── Shared furniture the arcade screens need ─────────────────────────────

  // Redemption ticket — perforated edge and notched ends.
  'award.ticket': (
    <>
      <path d="M3 8V6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5V8a2 2 0 0 0 0 4v1.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 13.5V12a2 2 0 0 0 0-4z" />
      <path d="M9 5v1.5M9 9v2M9 13.5V15" />
    </>
  ),
} satisfies Partial<Record<IconName, ReactNode>>;

/** The icon names that actually have art today. <Icon> accepts only these. */
export type DrawnIcon = keyof typeof ICON_ART;
