// The icon manifest — every icon the app needs, named for what it MEANS.
//
// Generated as a seed by `node scripts/icon-inventory.mjs --json`, then curated
// by hand. The inventory can tell you where a glyph is used; only a person can
// say what it was for. This file is that answer, and it is the contract the
// drawings are made against.
//
// ── Why names are semantic ──────────────────────────────────────────────────
//
// Icons are named `game.bowling`, not `bowling-ball`. The picture is expected
// to change — per skin today (six of them: unstyled, candy, blocky, uv, glass,
// chrome — see src/lib/skin.ts), per venue later. A name that describes the
// drawing would be a lie the first time the drawing changes.
//
// ── Why there are more icons than there were emoji ──────────────────────────
//
// 84 distinct emoji are doing 110 distinct jobs, because the emoji font simply
// has no separate picture for some of the things this app means. The vector set
// has no such shortage, so those jobs are pulled back apart here. Every `not:`
// note below marks a place where that happened, and each one is load-bearing —
// dropping it re-merges two icons that a player can tell apart:
//
//   🎳  game.bowling         the ball, finger holes and all
//       game.skee-ball       the alley, narrowing to a ringed target
//   🔨  game.whack-a-mole    a soft mallet, held over a hole
//       game.high-striker    a long-handled claw hammer
//   💦  game.water-gun-race  a jet of water, aimed
//       score.water-hazard   falling droplets — a stroke penalty on a hole
//   🎯  game.darts           a target's concentric rings
//       award.hole-in-one    a badge/medal for the achievement
//   🔔  order.ready          a still bell — your food is up
//       order.notify         a bell mid-ring — turn alerts ON
//   🏆  award.trophy         the object you won
//       action.leaderboard   a ranked list — where standings live
//
// ── What is deliberately NOT here ───────────────────────────────────────────
//
// Emoji inside sentences ('Strike! 🎳'), the ~136 editorial glyphs in
// src/data/funContent.ts, PhotoBooth's sticker sheet, and typographic marks
// (‹ › • ✓ ✗) all stay as they are. So does src/features/scorecard/shareImage.ts,
// which rasterises with canvas `fillText` and so cannot render a component at
// all — the one user-visible surface still showing emoji. The inventory script
// classifies and counts every one of these, so each exclusion is visible in the
// report rather than quietly assumed.

/** One icon's contract: what it means, and how to draw it so it stays distinct. */
export type IconSpec = {
  /** What this icon communicates. The reason it exists. */
  means: string;
  /** The drawing brief — enough for two illustrators to land in the same place. */
  draw: string;
  /** Icons this must NOT be confused with. Present wherever emoji merged them. */
  not?: string;
  /** The emoji it replaces, kept for provenance and for the migration check. */
  placeholder: string;
};

export const ICONS = {
  // ── Section navigation ────────────────────────────────────────────────────
  'nav.home': { means: 'The app home screen.', draw: 'A simple house: gable roof over a square body.', placeholder: '🏠' },
  'nav.golf': { means: 'The mini-golf section.', draw: 'A pennant on a tall pole — the pin. No ball, no cup; state.finish takes the chequered flag.', not: 'game.arcade-putt — a ball on a tee for the mini-game; this pennant is the real course.', placeholder: '⛳️' },
  'nav.arcade': { means: 'The arcade section.', draw: 'A gamepad seen head-on: D-pad left, two buttons right.', placeholder: '🎮' },
  'nav.food': { means: 'Food & drink ordering.', draw: 'Crossed fork and knife — the section, not any one menu item (the 🌭 was never about hot dogs specifically).', placeholder: '🌭' },
  'nav.photos': { means: 'The photo booth section.', draw: 'A camera body with a lens circle and a flash bump.', not: 'action.take-photo — the shutter action inside the booth.', placeholder: '📸' },
  'nav.hunt': { means: 'The scavenger hunt.', draw: 'A plain magnifier. The hunt is the only magnifier in the set, so it needs no qualifier.', placeholder: '🔍' },
  'nav.me': { means: 'The player’s own profile section.', draw: 'A head-and-shoulders bust in outline.', not: 'state.account — bare bust for the section, bust-in-a-circle for the signed-in state.', placeholder: '👤' },
  'nav.locations': { means: 'Switch venue / pick a location.', draw: 'A map pin with a hollow centre.', not: 'state.located — plain pin switches venue, checked pin means you are here.', placeholder: '📍' },
  'nav.install': { means: 'Install the app to the home screen.', draw: 'A downward arrow into an open tray.', placeholder: '⬇️' },
  'nav.rewards': { means: 'The rewards / loyalty card.', draw: 'An arcade ticket: rounded rectangle, perforated edge, notch.', not: 'award.ticket — the card section, not the ticket currency.', placeholder: '🎟️' },

  // ── The arcade roster ─────────────────────────────────────────────────────
  // One icon per attraction. These are the app's densest naming problem: the
  // FunZone tile and the game's own screen used the same emoji, and several
  // games shared one glyph with each other.
  'game.air-hockey': { means: 'Air hockey.', draw: 'Crossed hockey sticks over a puck. Not literally an air-hockey striker, but it matches the 🏒 the app already chose and it reads at size.', placeholder: '🏒' },
  'game.axe-throwing': { means: 'Axe throwing.', draw: 'A hatchet in flight, blade forward, toward a target edge.', placeholder: '🪓' },
  'game.batting-cages': { means: 'Batting cages.', draw: 'A baseball with its stitching.', placeholder: '⚾️' },
  'game.bumper-boats': { means: 'Bumper boats.', draw: 'A round boat with a bumper ring, on two water lines.', not: 'game.bumper-cars — same bumper ring, but wheels, not water.', placeholder: '🚤' },
  'game.bumper-cars': { means: 'Bumper cars.', draw: 'A tub car on a wide bumper skirt, pole running up to the ceiling grid line.', not: 'game.bumper-boats.', placeholder: '🚗' },
  'game.milk-bottles': { means: 'Milk-bottle toss.', draw: 'Three stacked bottles in a pyramid, ball incoming.', placeholder: '🥛' },
  'game.bowling': { means: 'Ten-pin bowling.', draw: 'A bowling ball with three finger holes. No pins needed — game.skee-ball is an alley, so the pair reads as BALL vs ALLEY.', not: 'game.skee-ball — 🎳 covered both; bowling is the BALL, skee-ball the ALLEY.', placeholder: '🎳' },
  'game.claw-machine': { means: 'The claw / prize crane.', draw: 'A three-prong claw descending over a plush shape.', placeholder: '🧸' },
  'game.darts': { means: 'Darts.', draw: 'Concentric rings with a centre dot — a target seen head-on. No dart; the rings alone read as darts at 24px.', not: 'award.hole-in-one — 🎯 covered both; that one is a badge.', placeholder: '🎯' },
  'game.fun-facts': { means: 'Fun Facts — the bite-size fact deck.', draw: 'A plain lightbulb with its filament base — an idea. action.hint takes the question mark instead.', not: 'action.hint — the hunt’s hint is a question mark, not a second bulb.', placeholder: '💡' },
  'game.shooting-gallery': { means: 'The shooting gallery.', draw: 'A carnival duck in profile — round head, beak, plump body — on a post above a rail.', placeholder: '🦆' },
  'game.pop-a-shot': { means: 'Pop-a-Shot basketball.', draw: 'A basketball with its seam lines. The ball rather than the hoop, because a backboard-and-net does not survive 24px.', placeholder: '🏀' },
  'game.go-karts': { means: 'Go-karts.', draw: 'A steering wheel, head-on. Not the kart itself: a wheel survives 24px where a chassis-and-wheels profile read as an abstract diagram.', not: 'state.finish — the chequered flag; go-karts is the wheel, so the two no longer compete for 🏁.', placeholder: '🏁' },
  'game.whack-a-mole': { means: 'Whack-a-Mole.', draw: 'A soft-headed MALLET raised over a hole with a mole snout.', not: 'game.high-striker — 🔨 covered both; this one is the mallet + hole.', placeholder: '🔨' },
  'game.pinball': { means: 'Pinball.', draw: 'The cabinet in plan: tall rounded rect, a bumper circle, the ball, and two flippers angled up from the bottom corners.', placeholder: '🕹️' },
  'game.arcade-putt': { means: 'Arcade Putt — the in-app putting mini-game.', draw: 'A golf ball on a tee. nav.golf keeps the pennant, so the mini-game and the real course stay apart.', not: 'nav.golf — the real course section, drawn as a pin flag.', placeholder: '⛳️' },
  'game.ring-toss': { means: 'Ring toss.', draw: 'A ring mid-air over an upright peg.', placeholder: '🎪' },
  'game.skee-ball': { means: 'Skee-Ball.', draw: 'The alley in perspective — a trapezoid narrowing upward to the ringed target hole, ball rolling at the near end.', not: 'game.bowling — 🎳 covered both; skee-ball is RAMP + RINGS.', placeholder: '🎳' },
  'game.high-striker': { means: 'High striker — the strongman bell.', draw: 'A claw hammer, head raised. The long handle is what separates it from whack-a-mole’s wide mallet.', not: 'game.whack-a-mole, order.ready — 🔨 and 🔔 both collided here.', placeholder: '🔔' },
  'game.trivia': { means: 'Trivia.', draw: 'A brain in plan, two lobes.', placeholder: '🧠' },
  'game.water-gun-race': { means: 'The water gun race.', draw: 'A water pistol with a JET aimed at a rising target.', not: 'score.water-hazard — 💦 covered both; that one is a splash.', placeholder: '💦' },
  'game.challenge-spinner': { means: 'The challenge spinner wheel.', draw: 'A segmented wheel with a pointer at the top.', placeholder: '🔻' },

  // ── Putting outcomes ──────────────────────────────────────────────────────
  // The per-hole result reactions in PuttGolf (holeResult()). These are scores,
  // not achievements — award.* below is the badge family.
  'score.hole-in-one': { means: 'Sank it in one.', draw: 'A star — the exceptional result, the one score that is not measured against par.', not: 'award.hole-in-one — the earned BADGE; this is the score itself.', placeholder: '🏌️' },
  'score.eagle': { means: 'Two under par.', draw: 'A single feather. Bird-family so it groups with score.birdie, but not the perched bird, so the two stay apart. A weak pick — neither library has a raptor — and it leans on the “Eagle” label beside it.', placeholder: '🦅' },
  'score.birdie': { means: 'One under par.', draw: 'A small bird in profile, or one chevron down.', placeholder: '🐦' },
  'score.par': { means: 'Level par.', draw: 'A dot dead centre in a ring — the ball in the cup, exactly as expected.', not: 'course.default, nav.golf — ⛳️ served all three; this one is a SCORE.', placeholder: '⛳️' },
  'score.bogey': { means: 'One over par.', draw: 'A face with a flat mouth and one raised brow — a wince, not a frown; state.lose takes the frown.', placeholder: '😬' },
  'score.over-par': { means: 'Two or more over par.', draw: 'The far end of the face ramp: par is neutral, bogey winces, this one scowls. state.lose keeps the plain frown so all three read apart.', placeholder: '😵' },
  'score.water-hazard': { means: 'Ball in the water — one stroke penalty.', draw: 'Two falling droplets — water as a hazard, no aim and no jet.', not: 'game.water-gun-race — 💦 covered both.', placeholder: '💦' },
  'score.endless': { means: 'Endless (procedural) mode.', draw: 'A lemniscate — a clean infinity loop.', placeholder: '♾️' },

  // ── Awards & achievements ─────────────────────────────────────────────────
  'award.trophy': { means: 'A win, or an earned award.', draw: 'A two-handled cup on a plinth.', not: 'action.leaderboard — 🏆 covered both; that is a ranked list.', placeholder: '🏆' },
  'award.medal': { means: 'An achievement medal.', draw: 'A disc on a short ribbon.', placeholder: '🏅' },
  'award.ticket': { means: 'Redemption tickets.', draw: 'An arcade ticket: perforated edge, notched ends.', not: 'nav.rewards — the currency, not the section that holds it.', placeholder: '🎟️' },
  'award.hole-in-one': { means: 'The “hole in one” achievement badge.', draw: 'A rosette badge on a ribbon. score.hole-in-one is the star; this is the award you keep.', not: 'game.darts, score.hole-in-one — 🎯 and 🏌️ both collided here.', placeholder: '🎯' },
  'award.under-par': { means: 'The “under par” achievement badge.', draw: 'A line trending downward — below par is the good direction in golf, so the icon says the thing the name does.', placeholder: '⛳' },
  'award.hunt-master': { means: 'The “hunt master” achievement badge.', draw: 'The detective silhouette — brimmed hat over a magnifier, exactly the 🕵️ it replaces.', placeholder: '🕵️' },

  // ── Food order lifecycle ──────────────────────────────────────────────────
  // OrderStatus renders these as an ordered progress rail, so they must read as
  // a sequence — keep a consistent weight and baseline across all five.
  'order.received': { means: 'Order received.', draw: 'A receipt with a torn lower edge.', placeholder: '🧾' },
  'order.sent-to-kitchen': { means: 'Sent to the kitchen.', draw: 'A paper plane, nose up.', placeholder: '📨' },
  'order.being-prepared': { means: 'Being prepared.', draw: 'A pan with an egg, one heat curl above.', placeholder: '🍳' },
  'order.ready': { means: 'Ready for pickup.', draw: 'A service bell (dome + plunger), still.', not: 'order.notify — same bell, opposite meaning.', placeholder: '🔔' },
  'order.picked-up': { means: 'Picked up — enjoy.', draw: 'A hand holding out a platter — your order, handed over. Better than a second confetti burst next to state.celebrate.', not: 'state.celebrate — the popper stays with celebration; this is the handover.', placeholder: '🎉' },
  'order.notify': { means: 'Turn on “tell me when it’s ready”.', draw: 'A bell with motion ticks — an ALERT being armed.', not: 'order.ready — 🔔 covered both; this one is the toggle.', placeholder: '🔔' },
  'order.cart': { means: 'The food cart / basket.', draw: 'A shopping basket in outline.', placeholder: '🛒' },

  // ── Actions ───────────────────────────────────────────────────────────────
  'action.take-photo': { means: 'Take a photo.', draw: 'An aperture iris — the shutter itself, so the booth’s ACTION reads differently from nav.photos’ device.', not: 'nav.photos — the section, not the shutter.', placeholder: '📸' },
  'action.share': { means: 'Share this.', draw: 'A box with an arrow leaving through the top.', placeholder: '📤' },
  'action.delete': { means: 'Delete / remove.', draw: 'A waste bin with a lid line.', placeholder: '🗑️' },
  'action.edit': { means: 'Edit.', draw: 'A pencil at 45°, tip lower-left.', placeholder: '✏️' },
  'action.hint': { means: 'Reveal a hint.', draw: 'A question mark in a circle — asking for help. The bulb belongs to game.fun-facts.', not: 'game.fun-facts.', placeholder: '💡' },
  'action.refresh': { means: 'Reload — a new version is available.', draw: 'Two arrows chasing in a circle.', placeholder: '🔄' },
  'action.feedback': { means: 'Send feedback.', draw: 'A speech bubble with a tail.', placeholder: '💬' },
  'action.play-together': { means: 'Play together — everyone on their own phone.', draw: 'A phone with a small radiating arc.', placeholder: '📲' },
  'action.rules': { means: 'Read the rules.', draw: 'An open book, two pages.', placeholder: '📖' },
  'action.scorecard': { means: 'View the scorecard.', draw: 'A clipboard with three ruled lines.', placeholder: '📋' },
  'action.leaderboard': { means: 'View the leaderboard.', draw: 'A numbered list — ranked standings. Distinct from award.trophy, which is the object won.', not: 'award.trophy — 🏆 covered both.', placeholder: '🏆' },

  // ── Controls ──────────────────────────────────────────────────────────────
  // The bottom-left control cluster. These ship in PAIRS and must read as one
  // family: identical optical weight, so a toggle does not jump when it flips.
  'control.skin': { means: 'Open the theme (skin) picker.', draw: 'An artist’s palette with a thumb hole.', placeholder: '🎨' },
  'control.theme-light': { means: 'Switch to light mode.', draw: 'A sun: disc plus eight short rays.', placeholder: '☀️' },
  'control.theme-dark': { means: 'Switch to dark mode.', draw: 'A crescent moon, same optical size as the sun disc.', placeholder: '🌙' },
  'control.sound-on': { means: 'Sound is on.', draw: 'A speaker with two arcs.', placeholder: '🔊' },
  'control.sound-off': { means: 'Sound is muted.', draw: 'The same speaker with a cross — same body, so only the state changes.', placeholder: '🔇' },

  // ── States & markers ──────────────────────────────────────────────────────
  'state.done': { means: 'Step complete / confirmed.', draw: 'A check inside a circle.', placeholder: '✅' },
  'state.locked': { means: 'Private or locked.', draw: 'A closed padlock, shackle down.', placeholder: '🔒' },
  'state.account': { means: 'A signed-in player.', draw: 'A bust enclosed in a circle — an account. nav.me keeps the bare bust for the section.', not: 'nav.me — bust-in-a-circle for the state, bare bust for the section.', placeholder: '👤' },
  'state.guest': { means: 'A guest / not yet signed in.', draw: 'A four-point sparkle.', placeholder: '✨' },
  'state.teams': { means: 'Teams / group play.', draw: 'Two overlapping busts.', placeholder: '👥' },
  'state.located': { means: 'You are at the venue.', draw: 'A map pin with a check inside — presence confirmed. nav.locations keeps the plain pin for switching venue.', not: 'nav.locations — the plain pin is the switcher; this one is checked.', placeholder: '📍' },
  'state.no-venue': { means: 'No venue found / out of range.', draw: 'A compass rose with a tilted needle.', placeholder: '🧭' },
  'state.announcement': { means: 'A venue announcement.', draw: 'A megaphone, mouth right.', placeholder: '📣' },
  'state.cpu': { means: 'The CPU opponent.', draw: 'A blocky robot head with two eyes and an antenna.', placeholder: '🤖' },
  'state.timer': { means: 'Time remaining.', draw: 'A stopwatch with a crown button.', placeholder: '⏱' },
  'state.finish': { means: 'Finished / start a round.', draw: 'A chequered flag on a staff — what 🏁 actually meant. It was only given up while game.go-karts was a kart carrying one; now that go-karts is a steering wheel, the flag comes back here.', not: 'game.go-karts — the steering wheel; neither needs to borrow the other’s motif now.', placeholder: '🏁' },
  'state.celebrate': { means: 'Celebration — a win, an accepted invite.', draw: 'A confetti burst, no container.', not: 'order.picked-up — 🎉 served both; that one belongs to the order rail.', placeholder: '🎉' },
  'state.win': { means: 'You won this round.', draw: 'A balloon on a string.', placeholder: '🎈' },
  'state.lose': { means: 'You lost this round.', draw: 'A frowning face. score.bogey takes the wince, so the two losing states stay apart.', placeholder: '🤡' },
  'brand.mark': { means: 'Venue brand fallback when no logo is uploaded.', draw: 'A ferris wheel: hub, spokes, gondolas.', placeholder: '🎡' },

  // ── Course identity ───────────────────────────────────────────────────────
  // src/lib/theme.ts maps a course theme to a glyph. Multi-tenant: a venue can
  // add themes, so these need to stay open-ended and `course.default` must
  // always render.
  'course.default': { means: 'A course with no specific theme.', draw: 'A plain pennant on a staff — a course whose theme we do not recognise. A different flag shape from nav.golf, and the two never share a screen.', not: 'course.classic — this is the fallback arm, not the themed classic course.', placeholder: '⛳️' },
  'course.classic': { means: 'The classic mini-golf course.', draw: 'A windmill — the mini-golf obstacle everyone pictures, and the one thing that makes “classic” a picture rather than a word.', not: 'course.default — ⛳️ came from both a case and the default arm.', placeholder: '⛳️' },
  'course.blue': { means: 'The Blue course.', draw: 'A plain ring, stroked in the course accent. The colour is the identity, so the shape stays neutral across all three.', placeholder: '🔵' },
  'course.green': { means: 'The Green course.', draw: 'A plain ring, stroked in the course accent — identical to course.blue but for the colour.', placeholder: '🟢' },
  'course.red': { means: 'The Red course.', draw: 'A plain ring, stroked in the course accent — identical to course.blue but for the colour.', placeholder: '🔴' },
  'course.california': { means: 'The California / tropical course.', draw: 'A single palm with a leaning trunk. course.jungle takes the grove.', not: 'course.jungle — both were 🌴; a single palm here, a grove there.', placeholder: '🌴' },
  'course.jungle': { means: 'The Jungle Run course.', draw: 'A grove of round-canopy trees — deliberately not a palm, so the two 🌴 courses read apart.', not: 'course.california — both were 🌴.', placeholder: '🌴' },
  'course.dragon': { means: 'The Dragon course.', draw: 'A dragon head in profile with a horn.', placeholder: '🐉' },
  'course.western': { means: 'The Western course.', draw: 'A cowboy hat, brim curling up at the sides.', placeholder: '🤠' },
  'course.pirate': { means: 'The Pirate’s Cove course.', draw: 'A skull-and-crossbones flag on a staff.', placeholder: '🏴‍☠️' },
  'course.space': { means: 'The Space Odyssey course.', draw: 'A rocket, nose up, two fins.', placeholder: '🚀' },
  'course.haunted': { means: 'The Haunted Manor course.', draw: 'A ghost with a wavy hem.', placeholder: '👻' },
} as const satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICONS;

/**
 * Inventory role + placeholder emoji → icon name.
 *
 * The migration's audit trail: every `(role, glyph)` pair the inventory finds
 * has exactly one entry, so `scripts/icon-inventory.mjs` output and this file
 * can be diffed and neither can drift silently. Keys are `"<role> <glyph>"`,
 * matching the pair list the script prints.
 *
 * Where one key maps somewhere surprising, the surprise IS the point — those
 * are the sites where an emoji was standing in for something it did not mean.
 */
export const ROLE_ICONS: Record<string, IconName> = {
  // Section nav (Home tiles + NavDrawer)
  'nav.ui 🏠': 'nav.home',
  'nav.golf ⛳️': 'nav.golf',
  'nav.arcade 🎮': 'nav.arcade',
  'nav.food 🌭': 'nav.food',
  'nav.photos 📸': 'nav.photos',
  'nav.hunt 🔍': 'nav.hunt',
  'nav.me 👤': 'nav.me',
  'nav.locations 📍': 'nav.locations',
  'nav.install ⬇️': 'nav.install',
  'me.rewards 🎟️': 'nav.rewards',

  // FunZone tiles → the game roster
  'arcade.airhockey 🏒': 'game.air-hockey',
  'arcade.axe 🪓': 'game.axe-throwing',
  'arcade.batting ⚾️': 'game.batting-cages',
  'arcade.boats 🚤': 'game.bumper-boats',
  'arcade.bottles 🥛': 'game.milk-bottles',
  'arcade.bowling 🎳': 'game.bowling',
  'arcade.bumper 🚗': 'game.bumper-cars',
  'arcade.claw 🧸': 'game.claw-machine',
  'arcade.darts 🎯': 'game.darts',
  'arcade.facts 💡': 'game.fun-facts',
  'arcade.gallery 🦆': 'game.shooting-gallery',
  'arcade.hoops 🏀': 'game.pop-a-shot',
  'arcade.karts 🏁': 'game.go-karts',
  'arcade.mole 🔨': 'game.whack-a-mole',
  'arcade.pinball 🕹️': 'game.pinball',
  'arcade.putt ⛳️': 'game.arcade-putt',
  'arcade.rings 🎪': 'game.ring-toss',
  'arcade.skeeball 🎳': 'game.skee-ball',
  'arcade.striker 🔔': 'game.high-striker',
  'arcade.trivia 🧠': 'game.trivia',
  'arcade.watergun 💦': 'game.water-gun-race',

  // Game screens — the hero glyph and the "play again" furniture. These merge
  // onto the same icons as the tiles above; that merge is the whole reason the
  // tile and the screen must not be named after the file they live in.
  'fun.airhockey 🏒': 'game.air-hockey',
  'fun.airhockey 🏆': 'award.trophy',
  'fun.airhockey 🤖': 'state.cpu',
  'fun.axethrow 🪓': 'game.axe-throwing',
  'fun.battingcages ⚾️': 'game.batting-cages',
  'fun.bowling 🎳': 'game.bowling',
  'fun.bumper-boats 🚤': 'game.bumper-boats',
  'fun.bumper-cars 🚗': 'game.bumper-cars',
  'fun.bumperarena ⏱': 'state.timer',
  'fun.clawmachine 🧸': 'game.claw-machine',
  'fun.darts 🎯': 'game.darts',
  'fun.gokarts 🏁': 'game.go-karts',
  'fun.highstriker 🔨': 'game.high-striker',
  'fun.milkbottle 🥎': 'game.milk-bottles',
  'fun.pinball 🕹️': 'game.pinball',
  'fun.popashot 🏀': 'game.pop-a-shot',
  'fun.popashot ⏱': 'state.timer',
  'fun.ringtoss 🎪': 'game.ring-toss',
  'fun.shootinggallery 🦆': 'game.shooting-gallery',
  'fun.skeeball 🎳': 'game.skee-ball',
  'fun.trivia 🧠': 'game.trivia',
  'fun.whackamole 🔨': 'game.whack-a-mole',
  'fun.watergunrace 🔫': 'game.water-gun-race',
  'fun.watergunrace 🎈': 'state.win',
  'fun.watergunrace 🤡': 'state.lose',
  'fun.spinner 🔻': 'game.challenge-spinner',
  'fun.spinner ⛳️': 'nav.golf',
  'fun.spinner 🎉': 'state.celebrate',
  'fun.earns-tickets 🎟️': 'award.ticket',
  'fun.gameticketaward 🎟️': 'award.ticket',

  // Putting outcomes
  'putt.hole-in-one 🏌️': 'score.hole-in-one',
  'putt.eagle 🦅': 'score.eagle',
  'putt.birdie 🐦': 'score.birdie',
  'putt.par ⛳️': 'score.par',
  'putt.bogey 😬': 'score.bogey',
  'putt.hole-in-one 😵': 'score.over-par',
  'putt.puttgolf 💦': 'score.water-hazard',
  'putt.puttgolf ♾️': 'score.endless',
  'putt.puttgolf ⛳️': 'game.arcade-putt',
  'putt.puttgolf 🏁': 'state.finish',
  'putt.puttgolf 🏆': 'award.trophy',

  // Achievements
  'me.hole-in-one 🎯': 'award.hole-in-one',
  'scorecard.hole-in-one 🎯': 'award.hole-in-one',
  'me.under-par ⛳': 'award.under-par',
  'scorecard.under-par ⛳': 'award.under-par',
  'me.hunt-master 🕵️': 'award.hunt-master',
  'scorecard.hunt-master 🕵️': 'award.hunt-master',

  // Food
  'food.food 🛒': 'order.cart',
  'food.order-received 🧾': 'order.received',
  'food.sent-to-the-kitchen 📨': 'order.sent-to-kitchen',
  'food.being-prepared 🍳': 'order.being-prepared',
  'food.activeorderscard 🍳': 'order.being-prepared',
  'food.ready-for-pickup 🔔': 'order.ready',
  'food.picked-up-enjoy 🎉': 'order.picked-up',
  'food.orderstatus 🔔': 'order.notify',
  'food.orderstatus ✅': 'state.done',

  // Photo booth
  'photos.photobooth 📸': 'action.take-photo',
  'photos.photobooth 📤': 'action.share',
  'photos.photobooth 🗑️': 'action.delete',
  'photos.photobooth ✏️': 'action.edit',
  'photos.photobooth ✅': 'state.done',

  // Hunt
  'hunt.hunt 🔍': 'nav.hunt',
  'hunt.venuehuntstart 🔍': 'nav.hunt',
  'scorecard.scavenger-hunt 🔍': 'nav.hunt',
  'golf.golfhome 🔍': 'nav.hunt',
  'hunt.hunt 💡': 'action.hint',
  'hunt.hunt 📷': 'action.take-photo',
  'hunt.hunt 📤': 'action.share',

  // Golf home / scorecard / summary
  'golf.golfhome 📲': 'action.play-together',
  'golf.golfhome 🏆': 'action.leaderboard',
  'golf.golfhome 📖': 'action.rules',
  'scorecard.playersetup 📲': 'action.play-together',
  'scorecard.playersetup 🏅': 'award.medal',
  'scorecard.challenge-spinner 🎡': 'game.challenge-spinner',
  // Summary renders 🏆 three times and the role+glyph key cannot tell them
  // apart: two are "view leaderboard" buttons, the third is REWARD_META's
  // fallback badge for an achievement the client does not know the name of.
  // That third one is award.trophy at the call site — the limit of deriving a
  // role from the component when one component means several things.
  'scorecard.summary 🏆': 'action.leaderboard',
  'scorecard.summary 📋': 'action.scorecard',
  'scorecard.summary 📸': 'action.take-photo',
  'scorecard.summary 🎟️': 'award.ticket',
  'scorecard.coursepicker 📍': 'state.located',
  'courses.courselist 📍': 'state.located',

  // Me / account / teams
  'me.mehome 👤': 'state.account',
  'me.mehome ✨': 'state.guest',
  'me.mehome 🏅': 'award.medal',
  'me.mehome 👥': 'state.teams',
  'me.mehome 🎟️': 'nav.rewards',
  'me.mehome ⬇️': 'nav.install',
  'me.mehome 🔒': 'state.locked',
  'shared.accountgate 👤': 'state.account',
  'shared.accountgate ✨': 'state.guest',
  'account.account 👥': 'state.teams',
  'account.account 🏌️': 'score.hole-in-one',
  'account.account 🎟️': 'award.ticket',

  // Rewards
  'rewards.rewards 🎟️': 'award.ticket',
  'rewards.rewards 🕹️': 'nav.arcade',
  'ui.adoptionbonustoast 🎟️': 'award.ticket',

  // Home
  'home.home 🌭': 'nav.food',
  'home.home 🛒': 'order.cart',
  'home.home 👤': 'state.account',
  'home.home 🎡': 'brand.mark',

  // Location / venue gating
  'locations.locationpicker 🧭': 'state.no-venue',
  'locations.locationpicker 📍': 'state.located',
  'shared.geofencegate 📍': 'state.located',
  'shared.tenantunavailable 🧭': 'state.no-venue',

  // Install
  'install.install ⛳️': 'nav.golf',
  'install.install ✅': 'state.done',
  'ui.adoptionnudge 📲': 'action.play-together',
  'ui.adoptionnudge 🏆': 'award.trophy',

  // Chrome & controls
  'ui.choose-a-theme 🎨': 'control.skin',
  'ui.themetoggle ☀️': 'control.theme-light',
  'ui.themetoggle 🌙': 'control.theme-dark',
  'ui.navdrawer 🌙': 'control.theme-dark',
  'ui.soundtoggle 🔊': 'control.sound-on',
  'ui.soundtoggle 🔇': 'control.sound-off',
  'ui.navdrawer 🔊': 'control.sound-on',
  'ui.updatemodal 🔄': 'action.refresh',
  'ui.announcementbanner 📣': 'state.announcement',
  'ui.feedbackbutton 💬': 'action.feedback',
  'ui.feedbackbutton 📸': 'action.take-photo',

  // TV / signage
  'tv.tvwall ⛳️': 'nav.golf',
  'tv.tvleaderboard 🏅': 'award.medal',

  // Course identity (src/lib/theme.ts). Keyed on the switch arm, not the glyph:
  // 'classic' and the default arm both return ⛳️, and 'california' and 'jungle'
  // both return 🌴, but all four are different courses and get their own art.
  'theme.default ⛳️': 'course.default',
  'theme.classic ⛳️': 'course.classic',
  'theme.blue 🔵': 'course.blue',
  'theme.green 🟢': 'course.green',
  'theme.red 🔴': 'course.red',
  'theme.california 🌴': 'course.california',
  'theme.jungle 🌴': 'course.jungle',
  'theme.dragon 🐉': 'course.dragon',
  'theme.western 🤠': 'course.western',
  'theme.pirate 🏴‍☠️': 'course.pirate',
  'theme.space 🚀': 'course.space',
  'theme.haunted 👻': 'course.haunted',
};
