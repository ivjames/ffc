#!/usr/bin/env node
// Vendors the generic half of the icon set from Lucide (ISC).
//
//   node scripts/vendor-icons.mjs   → rewrites src/ui/icons/vendored.generated.tsx
//
// ── Why Lucide and not Phosphor ─────────────────────────────────────────────
//
// Phosphor has far better ARCADE vocabulary — it ships bowling-ball, golf,
// basketball, baseball, hockey, steering-wheel, flag-checkered and crane, none
// of which Lucide has. It still lost, on one structural fact:
//
//   Lucide    viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  width 2
//   Phosphor  viewBox="0 0 256 256"  fill="currentColor"   (stroke baked in)
//
// Phosphor's weights are FILLED paths — the outline look is geometry, not a
// stroke. Adopting it would mean giving up the two things the set is built on:
// <Icon> passing one stroke spec to every drawing, and skins restyling stroke
// weight from CSS (index.css, `.ffc-icon`) with no re-render and no second set
// of art. That is what keeps this 97 drawings rather than 97 × 6.
//
// Lucide is drawn on exactly the grid, stroke width, caps and joins this
// registry already specified, so its paths drop in untouched — and the ~25
// arcade-specific icons no general set has stay hand-drawn in registry.tsx.
//
// ── Why the SVGs are copied in rather than imported ─────────────────────────
//
// Vendoring keeps ~55 elements in the tree instead of a 2,025-icon dependency
// in the PWA's bundle, and keeps `lucide-static` a devDependency. Re-run this
// script to pick up upstream fixes.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(REPO, 'node_modules', 'lucide-static', 'icons');
const OUT = join(REPO, 'src', 'ui', 'icons', 'vendored.generated.tsx');

// icon name → [lucide file, note]. The note is only present where the choice
// is load-bearing — almost always because two icons MUST stay distinguishable
// and the emoji set had merged them. Those pairings are the whole reason this
// library exists, so they are recorded at the point the art is chosen.
const VENDOR = {
  // Section navigation
  'nav.home': ['house'],
  'nav.golf': ['flag-triangle-right', 'a pennant on a pole — the pin. state.finish takes the plain flag.'],
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

  // Putting outcomes
  'score.birdie': ['bird'],
  'score.bogey': ['annoyed', 'a wince. state.lose shared the idea and takes the frown.'],
  'score.endless': ['infinity'],
  'score.water-hazard': ['droplets', 'water as a hazard. game.water-gun-race shared 💦 and keeps the aimed jet.'],

  // Awards
  'award.trophy': ['trophy', 'the object won. action.leaderboard shared 🏆 and takes the ranked list.'],
  'award.medal': ['medal'],
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
  'state.finish': ['flag', 'the plain flag. nav.golf keeps the pennant, game.go-karts keeps the kart.'],
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

/** Lucide's inner elements, as JSX. The wrapper is dropped — <Icon> supplies
 *  the viewBox, stroke, caps and joins, so a vendored icon is styled by exactly
 *  the same rules as a hand-drawn one. */
function extract(file) {
  const svg = readFileSync(join(SRC, `${file}.svg`), 'utf8');
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
// Artwork from Lucide (https://lucide.dev), ISC licence, copyright (c) for
// portions Lucide are held by Lucide Contributors 2022, and copyright for
// portions of Feather are held by Cole Bemis 2013-2022. Only the ${Object.keys(VENDOR).length} icons the
// app actually uses are copied in; \`lucide-static\` stays a devDependency so
// none of its other 2,000 icons reach the PWA bundle.
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
};
`,
);

console.log(`wrote ${Object.keys(VENDOR).length} vendored icons → src/ui/icons/vendored.generated.tsx`);
