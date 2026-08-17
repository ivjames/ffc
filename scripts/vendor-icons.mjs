#!/usr/bin/env node
// Vendors the non-bespoke part of the icon set: Lucide (ISC) for the generic
// vocabulary, Phosphor (MIT) for a few arcade subjects Lucide has no icon for.
//
//   node scripts/vendor-icons.mjs   → rewrites src/ui/icons/vendored.generated.tsx
//
// ── Both sets, for different jobs ────────────────────────────────────────────
//
// LUCIDE is the base. It is drawn on exactly the grid, stroke width, caps and
// joins this registry already specified, so its paths drop in untouched:
//
//   Lucide    viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  width 2
//   Phosphor  viewBox="0 0 256 256"  fill="currentColor"   (stroke baked in)
//
// PHOSPHOR is taken selectively, for the handful of arcade icons no general set
// has and Lucide does not: bowling-ball, golf, basketball, baseball, hockey,
// steering-wheel, flag-checkered. Those were the weakest hand-drawn entries in
// the set, and Phosphor's are simply better.
//
// Mixing costs something real, so it is worth being explicit about the price:
// Phosphor's weights are FILLED paths — the outline look is geometry, not a
// stroke — which means a Phosphor icon cannot take a stroke-width change. It
// still inherits `currentColor` and still takes any filter a skin applies.
// index.css restyles only the MATERIAL classes (body, .surface, .key, .tile,
// .btn-accent — background, border, box-shadow); no skin touches stroke width
// today, so the capability being given up is hypothetical rather than in use.
// Seven better icons for that is a good trade; if a skin ever does want to
// re-weight icons, these seven opt out of it and everything else follows.
//
// Weight matching matters when mixing. Phosphor `regular` is 16/256 ≈ 1.5px at
// 24 and reads visibly lighter than Lucide's 2. `bold` is 24/256 ≈ 2.25 and
// sits close enough to pass as one family, so the bold weight is the one taken.
//
// ── Why the SVGs are copied in rather than imported ─────────────────────────
//
// Vendoring puts ~75 elements in the tree instead of two icon packages (2,025 +
// 1,512 icons) in the PWA's bundle, and keeps both as devDependencies. Re-run
// this script to change a mapping or pick up upstream fixes.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(REPO, 'node_modules', 'lucide-static', 'icons');
const PH = join(REPO, 'node_modules', '@phosphor-icons', 'core', 'assets', 'bold');
const OUT = join(REPO, 'src', 'ui', 'icons', 'vendored.generated.tsx');

// icon name → [lucide file, note]. The note is only present where the choice
// is load-bearing — almost always because two icons MUST stay distinguishable
// and the emoji set had merged them. Those pairings are the whole reason this
// library exists, so they are recorded at the point the art is chosen.
const VENDOR = {
  // Section navigation
  'nav.home': ['house'],
  'nav.golf': ['flag-triangle-right', 'a pennant on a pole — the pin. state.finish takes the chequered flag.'],
  'nav.arcade': ['gamepad-2'],
  'nav.food': ['utensils'],
  'nav.photos': ['camera', 'the device; action.take-photo takes the aperture, since 📸 served both.'],
  'nav.hunt': ['search'],
  'nav.me': ['user', 'the bare bust for the section; state.account takes the enclosed one.'],
  'nav.locations': ['map-pin', 'the plain pin switches venue; state.located takes the checked pin.'],
  'nav.install': ['download'],
  'nav.rewards': ['ticket'],

  // Arcade games Lucide actually covers. Everything else stays hand-drawn.
  'game.axe-throwing': ['axe'],
  'game.darts': ['target', 'concentric rings. award.hole-in-one shared 🎯 and stays a badge.'],
  'game.fun-facts': ['lightbulb', 'the bulb belongs to the fact deck; action.hint takes the question mark.'],
  'game.coin-pusher': ['coins'],
  'game.high-striker': ['hammer', 'the long-handled hammer. whack-a-mole shared 🔨 and keeps the bespoke mallet.'],
  'game.trivia': ['brain'],

  // Putting outcomes. Two sub-families, mirroring what the emoji did: the good
  // scores are objects (star, bird, feather), the bad ones are faces on a ramp.
  'score.hole-in-one': ['star', 'an ace — the exceptional result. award.hole-in-one is the BADGE for it.'],
  'score.eagle': ['feather', 'bird-family but not the perched bird, so eagle and birdie stay apart. A weak pick: neither set has a raptor, and it only works because the label sits beside it.'],
  'score.birdie': ['bird'],
  'score.par': ['circle-dot', 'the ball dead centre in the cup — exactly as expected.'],
  'score.bogey': ['annoyed', 'a wince — first step on the face ramp: annoyed → angry.'],
  'score.over-par': ['angry', 'the far end of the face ramp. state.lose takes the plain frown, so all three stay distinct.'],
  'score.endless': ['infinity'],
  'score.water-hazard': ['droplets', 'water as a hazard. game.water-gun-race shared 💦 and keeps the aimed jet.'],

  // Awards
  'award.trophy': ['trophy', 'the object won. action.leaderboard shared 🏆 and takes the ranked list.'],
  'award.medal': ['medal'],
  'award.hole-in-one': ['award', 'a badge on a ribbon — the achievement. score.hole-in-one is the SCORE, drawn as a star.'],
  'award.under-par': ['trending-down', 'a line trending down: below par is the good direction in golf.'],
  'award.ticket': ['ticket'],

  // Food order lifecycle — reads as a sequence, so all five come from one set.
  'order.received': ['receipt'],
  'order.sent-to-kitchen': ['send-horizontal'],
  'order.being-prepared': ['cooking-pot'],
  'order.ready': ['bell', 'the still bell. order.notify shared 🔔 and takes the ringing one.'],
  'order.notify': ['bell-ring', 'the bell mid-ring — an alert being armed, not food being ready.'],
  'order.picked-up': ['hand-platter', 'a plate handed over. state.celebrate shared 🎉 and keeps the popper.'],
  'order.cart': ['shopping-basket'],

  // Actions
  'action.take-photo': ['aperture', 'the shutter itself, so the booth’s action differs from nav.photos.'],
  'action.share': ['share-2'],
  'action.delete': ['trash-2'],
  'action.edit': ['pencil'],
  'action.hint': ['circle-help', 'asking for help. game.fun-facts shared 💡 and keeps the bulb.'],
  'action.refresh': ['refresh-cw'],
  'action.feedback': ['message-circle'],
  'action.play-together': ['smartphone'],
  'action.rules': ['book-open'],
  'action.scorecard': ['clipboard-list'],
  'action.leaderboard': ['list-ordered', 'a ranked list — where standings live, not the cup itself.'],

  // Controls. These ship in pairs and must read as one family, which is the
  // strongest argument for taking all four from a single set.
  'control.skin': ['palette'],
  'control.theme-light': ['sun'],
  'control.theme-dark': ['moon'],
  'control.sound-on': ['volume-2'],
  'control.sound-off': ['volume-x'],

  // States
  'state.done': ['circle-check'],
  'state.locked': ['lock'],
  'state.account': ['circle-user', 'the enclosed bust — signed in. nav.me keeps the bare one.'],
  'state.guest': ['sparkles'],
  'state.teams': ['users'],
  'state.located': ['map-pin-check', 'a confirmed pin — you are here. nav.locations keeps the plain pin.'],
  'state.no-venue': ['compass'],
  'state.announcement': ['megaphone'],
  'state.cpu': ['bot'],
  'state.timer': ['timer'],
  'state.celebrate': ['party-popper'],
  'state.win': ['balloon'],
  'state.lose': ['frown', 'a flat frown. score.bogey shared the idea and takes the wince.'],
  'brand.mark': ['ferris-wheel'],

  // Course identity
  'course.blue': ['circle', 'a bare ring; the course accent colour carries the identity.'],
  'course.green': ['circle'],
  'course.red': ['circle'],
  'course.california': ['tree-palm', 'a palm. course.jungle shared 🌴 and takes the broadleaf grove.'],
  'course.jungle': ['trees', 'a grove, so the two 🌴 courses stop being the same picture.'],
  'course.pirate': ['skull'],
  'course.space': ['rocket'],
  'course.haunted': ['ghost'],
};

// Taken from Phosphor (MIT), bold weight, for arcade subjects Lucide has no
// icon for at all. These render FILLED on a 256 grid — see the header — so they
// live in their own export and <Icon> switches coordinate system per icon.
//
// `crane` was evaluated for game.claw-machine and rejected: Phosphor's crane is
// a construction crane, which is a different machine from a prize claw. Better
// art losing to worse art on meaning is the correct outcome for this library.
const PHOSPHOR = {
  'game.bowling': ['bowling-ball', 'the ball with finger holes. game.skee-ball keeps the bespoke alley, so the pair is now BALL vs ALLEY.'],
  'game.arcade-putt': ['golf', 'a ball on a tee. nav.golf keeps the pennant, so the mini-game and the real course stay apart.'],
  'game.pop-a-shot': ['basketball', 'the ball rather than the hoop — it survives 24px, which my backboard-and-net did not.'],
  'game.batting-cages': ['baseball'],
  'game.air-hockey': ['hockey', 'crossed sticks. Not strictly an air-hockey striker, but it matches the 🏒 the app already chose and reads at size.'],
  'game.go-karts': ['steering-wheel', 'a wheel, which frees the chequered flag for state.finish — what 🏁 actually meant.'],
  'award.hunt-master': ['detective', 'the hat-and-magnifier silhouette — exactly the 🕵️ it replaces.'],
  'course.classic': ['windmill', 'the mini-golf windmill. course.default takes the generic pennant.'],
  'course.western': ['cowboy-hat'],
  'course.default': ['flag-pennant', 'a generic pennant for an unrecognised theme. A different flag shape from nav.golf, and the two never appear in the same context.'],
  'state.finish': ['flag-checkered', 'the chequered flag, back now that game.go-karts is a steering wheel and the two no longer collide.'],
};

/** Lucide's inner elements, as JSX. The wrapper is dropped — <Icon> supplies
 *  the viewBox, stroke, caps and joins, so a vendored icon is styled by exactly
 *  the same rules as a hand-drawn one. */
function extract(file, dir = SRC, suffix = '') {
  const svg = readFileSync(join(dir, `${file}${suffix}.svg`), 'utf8');
  const inner = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
  const elements = inner.match(/<(?:path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*\/>/g);
  if (!elements) throw new Error(`no drawable elements in ${file}.svg`);
  return elements
    .map((el) =>
      el
        // SVG's kebab attributes are camelCase in JSX. Lucide's inner elements
        // rarely carry them, but a fill-rule slips through on a few.
        .replace(/\b([a-z]+)-([a-z])/g, (_, a, b) => `${a}${b.toUpperCase()}`)
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join('\n      ');
}

const phosphorEntries = Object.entries(PHOSPHOR)
  .map(([name, [file, note]]) => {
    const comment = note ? `      {/* ${note} */}\n` : '';
    return `  '${name}': (\n    <>\n      {/* phosphor/${file} (bold) */}\n${comment}      ${extract(file, PH, '-bold')}\n    </>\n  ),`;
  })
  .join('\n');

const entries = Object.entries(VENDOR)
  .map(([name, [file, note]]) => {
    // Inside JSX a `//` comment is just text that renders. Both the provenance
    // and the note have to go in `{/* … */}` braces.
    const comment = note ? `      {/* ${note} */}\n` : '';
    return `  '${name}': (\n    <>\n      {/* lucide/${file} */}\n${comment}      ${extract(file)}\n    </>\n  ),`;
  })
  .join('\n');

writeFileSync(
  OUT,
  `// GENERATED by scripts/vendor-icons.mjs — do not edit by hand.
// Re-run the script to change the mapping or pick up upstream fixes.
//
// Artwork from two sources, both copied in rather than imported, so only the
// icons the app actually uses ship and both packages stay devDependencies:
//
//   ${Object.keys(VENDOR).length} from Lucide (https://lucide.dev), ISC licence. Copyright (c) for
//   portions Lucide are held by Lucide Contributors 2022, and copyright for
//   portions of Feather are held by Cole Bemis 2013-2022.
//
//   ${Object.keys(PHOSPHOR).length} from Phosphor Icons (https://phosphoricons.com), MIT licence,
//   copyright (c) 2023 Phosphor Icons. Bold weight, for arcade subjects Lucide
//   has no icon for. These are FILLED on a 256 grid — see FILLED_ART below.
//
// The stroke spec lives on <Icon>, not here, so these are restyled per skin by
// the same \`.ffc-icon\` rules as the hand-drawn arcade icons in registry.tsx.

import type { ReactNode } from 'react';
import type { IconName } from './manifest';

export const VENDORED_ART = {
${entries}
} satisfies Partial<Record<IconName, ReactNode>>;

/** Which upstream icon each drawing came from — provenance for the licence
 *  note above, and what a redraw or an upstream bump has to be checked against. */
export const VENDORED_SOURCE: Partial<Record<IconName, string>> = {
${Object.entries(VENDOR)
  .map(([name, [file]]) => `  '${name}': 'lucide/${file}',`)
  .join('\n')}
${Object.entries(PHOSPHOR)
  .map(([name, [file]]) => `  '${name}': 'phosphor-bold/${file}',`)
  .join('\n')}
};

/**
 * Phosphor, bold weight. FILLED paths on a 256 grid, so <Icon> renders these
 * with fill=currentColor and no stroke — a different coordinate system and a
 * different rendering mode from everything above, which is why they are a
 * separate export rather than more entries in VENDORED_ART.
 *
 * The trade is in scripts/vendor-icons.mjs: these seven cannot take a
 * stroke-width change, which no skin does today.
 */
export const FILLED_ART = {
${phosphorEntries}
} satisfies Partial<Record<IconName, ReactNode>>;
`,
);

console.log(`wrote ${Object.keys(VENDOR).length} vendored icons → src/ui/icons/vendored.generated.tsx`);
