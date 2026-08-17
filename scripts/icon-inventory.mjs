#!/usr/bin/env node
// Icon inventory — the machine-generated census of every emoji the app is
// currently using as an icon, and the seed for the vector icon library.
//
// Why a script and not a hand-kept list: StyleGuide §13 tried the hand-kept
// version and drifted — it lists ~40 glyphs in 5 categories and misses the
// food, hunt, photos, me/account, install, order-status and putt screens
// entirely. Re-run this instead of editing a list.
//
// THE POINT OF THIS FILE is that it keys on the CALL SITE, not on the glyph.
// One emoji does many different jobs across the app, and the vector set must
// pull those jobs apart rather than collapse them:
//
//   🎳  → Skee-Ball (FunZone tile + SkeeBall hero)  AND  Bowling (tile + hero)
//   🔨  → Whack-a-Mole's mallet             AND  High Striker's strongman hammer
//   💦  → the Water Gun Race                AND  a putt-putt water hazard
//   🎯  → Darts, Ring Toss, the Shooting Gallery, an achievement, a result card
//
// Emoji has a small vocabulary, so the app reuses glyphs it doesn't mean. A
// vector set has no such limit — each of those is its own drawing. Collapsing
// them back to one icon per glyph would bake the emoji font's shortage into
// the design system permanently, so the report below calls the reuse out
// explicitly (see the COLLISIONS section) for a human to resolve.
//
// Not every emoji in the tree is an icon. Occurrences are classified:
//
//   marker   a glyph standing alone as a UI element → NEEDS A VECTOR
//   prose    a glyph inside a sentence ('Strike! 🎳', 'Turkey time! 🦃') →
//            that is copy, not chrome. Leave it as emoji; a monoline icon
//            mid-sentence would read as a rendering bug.
//   sticker  PhotoBooth's STICKER_SHEET → user-placed content composited onto
//            a photo, deliberately emoji ("nothing to precache into the PWA",
//            PhotoBooth.tsx). Out of scope, not a UI icon.
//   content  editorial emoji carried by a data record — one per fun fact, one
//            per spinner challenge (src/data/funContent.ts). The set grows
//            every time someone writes a new fact, so it can never be a closed
//            icon library; it is illustration, and it stays emoji.
//   catalog  StyleGuide's own glyph display. The style guide EXHIBITS the
//            markers rather than using them, so counting its rows would double
//            every icon in the app. Once the registry lands, §13 should render
//            from the registry instead (and this exclusion goes away).
//   symbol   typographic marks the style guide lumps in with icons (‹ › • ✓ ✗
//            ± ↻). These are text and should stay text — reported separately
//            so the decision is visible rather than silent.
//
// Usage:
//   node scripts/icon-inventory.mjs            # report to stdout
//   node scripts/icon-inventory.mjs --json     # rewrite scripts/icon-inventory.json
//
// The JSON is the input to src/ui/icons/manifest.ts, where the roles below get
// their final semantic names.

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['src', 'admin'];
const OUT = join(REPO, 'scripts', 'icon-inventory.json');

// Typographic marks the style guide groups with the icons. They are text — a
// chevron is a character, not a drawing — so they are counted and reported but
// kept out of the vector set.
const SYMBOLS = new Set(['‹', '›', '•', '·', '✓', '✗', '↻', '−', '±', '➕', '▶', '⏸', '⏭']);

// Files whose every glyph is excluded from the vector set, with the reason
// recorded as the occurrence's kind. Both are deliberate, not oversights —
// see the header. `src/data/courses.ts` is NOT here: its per-course glyphs are
// real identity markers and the vector set owes a drawing for each.
const EXCLUDED_FILES = new Map([
  ['src/data/funContent.ts', 'content'],
  ['src/features/style/StyleGuide.tsx', 'catalog'],
  // The manifest records the emoji each icon REPLACES, so it necessarily
  // contains every placeholder in the app. Counting it would make the icon set
  // look like it had doubled the moment it was written down.
  ['src/ui/icons/manifest.ts', 'catalog'],
]);

// ── file walk ───────────────────────────────────────────────────────────────

/** Every .ts/.tsx under the given roots, minus tests (their glyphs are
 *  assertions about the real call sites, not call sites themselves). */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
  };
  for (const root of ROOTS) walk(join(REPO, root));
  return out.sort();
}

// ── glyph extraction ────────────────────────────────────────────────────────

// Grapheme segmentation, so a ZWJ sequence or an emoji carrying a variation
// selector (⛳️ = U+26F3 U+FE0F) comes out as ONE glyph. Splitting by code point
// instead would report ⛳ and an invisible U+FE0F as two separate icons.
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/** The emoji/symbol graphemes on a line, with their column offsets. */
function glyphsIn(line) {
  const found = [];
  let col = 0;
  for (const { segment } of segmenter.segment(line)) {
    if (PICTOGRAPHIC.test(segment) || SYMBOLS.has(segment)) {
      found.push({ glyph: segment, col });
    }
    col += segment.length;
  }
  return found;
}

// ── classification ──────────────────────────────────────────────────────────

/** The line with any trailing `//` comment removed, so a glyph that only ever
 *  appears in an explanatory aside — `// loudest coin↔coin closing speed` —
 *  is not billed as an icon the design system owes. Quote-aware, so a `//`
 *  inside a string literal (a URL) does not truncate the line. */
function stripTrailingComment(line) {
  let quote = null;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (line[i - 1] === '\\') continue;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

/** What precedes the glyph inside its own run of text — the span bounded by
 *  quotes, JSX tag brackets, or an interpolation. Used to tell an icon from
 *  decoration, and POSITION is the signal that separates them:
 *
 *    marker   `📲 Join a friend's game`   glyph leads a label
 *    marker   `+{tickets} 🎟️`             glyph leads its own run
 *    prose    `Look for the ⛳️ icon…`     glyph sits mid-sentence
 *    prose    `'Strike! 🎳'`               glyph closes a sentence
 *
 *  Word-counting the whole run gets this wrong in both directions: a leading
 *  icon can carry a five-word label, and a sentence can be three words long. */
function precedingText(line, col) {
  let start = 0;
  for (let i = 0; i < col; i++) {
    if (`"'\`<>{}`.includes(line[i]) && line[i - 1] !== '\\') start = i + 1;
  }
  return line.slice(start, col);
}

/** Line ranges of PhotoBooth's sticker sheet, so its ~35 glyphs are excluded
 *  as content rather than counted as 35 icons the design system owes. */
function stickerRange(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /const STICKER_SHEET\s*=/.test(l));
  if (start === -1) return null;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*\];/.test(lines[i])) return [start + 1, i + 1];
  }
  return null;
}

// ── role derivation ─────────────────────────────────────────────────────────

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** The feature area a file belongs to — `fun`, `golf`, `ui`, `admin`. Becomes
 *  the icon-name prefix so roles read `arcade.bowling`, `nav.home`. */
function areaOf(file) {
  const rel = relative(REPO, file);
  const m = rel.match(/^src\/features\/([^/]+)\//);
  if (m) return m[1];
  if (rel.startsWith('src/ui/')) return 'ui';
  if (rel.startsWith('admin/')) return 'admin';
  return 'app';
}

/** A best-effort semantic role for a marker glyph — what the icon MEANS, which
 *  is what the vector set gets named after.
 *
 *  The strongest signal is a tile object: `emoji: '🎳'` sitting beside
 *  `to: '/arcade/bowling'` and `title: 'Bowling'` (FunZone.tsx, NavDrawer.tsx).
 *  That route is a stable, already-unique identifier, and it separates the two
 *  🎳s for free. Failing that, a sibling title/label; failing that, the
 *  component name, which is why SkeeBall.tsx's bare hero glyph still lands on
 *  `skeeball` rather than on `bowling`.
 *
 *  Anything this can't resolve confidently is marked `needsReview` so it shows
 *  up in the report instead of being quietly mis-named. */
function roleFor(lines, i, area, component) {
  const fromRoute = (path) => {
    const parts = path.split('/').filter(Boolean);
    // A single-segment route is a top-level section, and its glyph is the nav
    // icon for that section (NavDrawer, Home). `/golf` → `nav.golf`, not
    // `golf.index` — otherwise every section collapses onto the tail "index".
    return parts.length < 2 ? `nav.${slug(parts[0] ?? area)}` : `${parts[0]}.${slug(parts.slice(1).join('-'))}`;
  };

  // Same line first. Single-line records — `{ label: 'Eagle', emoji: '🦅' }` in
  // PuttGolf — put the name right next to the glyph, and a multi-line scan
  // would happily attach every reaction below it to the first label above.
  const here = lines[i];
  const hereRoute = here.match(/to:\s*['"]([^'"]+)['"]/);
  if (hereRoute) return { role: fromRoute(hereRoute[1]), from: 'route' };
  const hereTitle = here.match(/(?:title|label):\s*['"]([^'"]+)['"]/);
  if (hereTitle) return { role: `${area}.${slug(hereTitle[1])}`, from: 'title' };

  // Then the enclosing object literal, bounded by its own braces so the scan
  // cannot walk into the neighbouring record (FunZone's tile array).
  if (/emoji:/.test(here)) {
    let top = i;
    while (top > 0 && !/^\s*\{/.test(lines[top])) top--;
    let bottom = i;
    while (bottom < lines.length - 1 && !/^\s*\},?\s*$/.test(lines[bottom])) bottom++;
    const block = lines.slice(top, bottom + 1).join('\n');

    const route = block.match(/to:\s*['"]([^'"]+)['"]/);
    if (route) return { role: fromRoute(route[1]), from: 'route' };
    const title = block.match(/(?:title|label):\s*['"]([^'"]+)['"]/);
    if (title) return { role: `${area}.${slug(title[1])}`, from: 'title' };
  }

  // A glyph returned from a `switch` arm is named by its case label, not by
  // the glyph. src/lib/theme.ts is the whole reason: it returns ⛳️ for BOTH
  // `case 'classic'` and `default`, and 🌴 for BOTH 'california' and 'jungle'.
  // Keyed on the glyph those collapse to one icon and two courses lose their
  // identity; keyed on the case they stay four separate drawings.
  if (/^\s*return\s+['"]/.test(here)) {
    for (let up = i - 1; up >= 0 && i - up < 12; up--) {
      const arm = lines[up].match(/^\s*case\s+['"]([^'"]+)['"]\s*:/);
      if (arm) return { role: `${slug(component)}.${slug(arm[1])}`, from: 'switch-case' };
      if (/^\s*default\s*:/.test(lines[up])) return { role: `${slug(component)}.default`, from: 'switch-case' };
    }
  }

  // A glyph rendered as a button's only child gets its meaning from the
  // element's own accessible name, which sits on the opening tag several lines
  // up (`<button aria-label="Scavenger hunt">…🔍…`). That is the single best
  // signal in the codebase — it is the meaning, already written down — so scan
  // back to the enclosing element open before falling back to the file name.
  let open = i;
  while (open > 0 && !/^\s*<[A-Za-z]/.test(lines[open])) open--;
  const attrs = lines.slice(open, i + 1).join('\n');
  const aria = attrs.match(/(?:aria-label|title)=["']([^"']+)["']/);
  if (aria) return { role: `${area}.${slug(aria[1])}`, from: 'aria-label' };

  return { role: `${area}.${slug(component)}`, from: 'component', needsReview: true };
}

// ── sweep ───────────────────────────────────────────────────────────────────

const occurrences = [];

for (const file of sourceFiles()) {
  const text = readFileSync(file, 'utf8');
  if (!PICTOGRAPHIC.test(text) && ![...SYMBOLS].some((s) => text.includes(s))) continue;

  const rel = relative(REPO, file);
  const lines = text.split('\n');
  const component = basename(file).replace(/\.tsx?$/, '');
  const area = areaOf(file);
  const stickers = /PhotoBooth\.tsx$/.test(file) ? stickerRange(text) : null;

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    // Comments describe the glyphs, they don't render them.
    if (/^\s*(\/\/|\*|\/\*)/.test(rawLine)) return;
    const line = stripTrailingComment(rawLine);

    for (const { glyph, col } of glyphsIn(line)) {
      let kind;
      if (EXCLUDED_FILES.has(rel)) {
        kind = EXCLUDED_FILES.get(rel);
      } else if (stickers && lineNo >= stickers[0] && lineNo <= stickers[1]) {
        kind = 'sticker';
      } else if (SYMBOLS.has(glyph)) {
        kind = 'symbol';
      } else {
        // Words BEFORE the glyph in its own run mean the glyph is decorating a
        // sentence rather than labelling one.
        kind = /[A-Za-z]{2}/.test(precedingText(line, col)) ? 'prose' : 'marker';
      }

      const { role, from, needsReview } =
        kind === 'marker' ? roleFor(lines, i, area, component) : { role: null, from: null };

      occurrences.push({
        glyph,
        kind,
        role,
        roleFrom: from,
        needsReview: Boolean(needsReview),
        area,
        component,
        file: rel,
        line: lineNo,
        context: line.trim().slice(0, 120),
      });
    }
  });
}

// ── report ──────────────────────────────────────────────────────────────────

const markers = occurrences.filter((o) => o.kind === 'marker');
const byKind = (k) => occurrences.filter((o) => o.kind === k);
const uniq = (xs) => [...new Set(xs)];

/** glyph → the distinct roles it is being asked to carry. Anything with more
 *  than one role is a glyph the emoji font made the app overload, and each
 *  role in the list is a separate drawing in the vector set. */
const collisions = new Map();
for (const m of markers) {
  if (!collisions.has(m.glyph)) collisions.set(m.glyph, new Set());
  collisions.get(m.glyph).add(m.role);
}

/** role → the distinct glyphs used for it. More than one means the app is
 *  already inconsistent about the same idea and the vector set gets to pick
 *  one drawing (e.g. SkeeBall's hero is 🎳 but its tile emoji is also 🎳,
 *  while its win copy reaches for 🎯 and 🧙). */
const synonyms = new Map();
for (const m of markers) {
  if (!synonyms.has(m.role)) synonyms.set(m.role, new Set());
  synonyms.get(m.role).add(m.glyph);
}

const overloaded = [...collisions].filter(([, roles]) => roles.size > 1);
const inconsistent = [...synonyms].filter(([, glyphs]) => glyphs.size > 1);

const lines = [];
const say = (s = '') => lines.push(s);

say('ICON INVENTORY');
say('='.repeat(72));
say();
say(`  markers   ${String(byKind('marker').length).padStart(4)} occurrences · ${uniq(markers.map((m) => m.role)).length} distinct roles → THE VECTOR SET`);
say(`  prose     ${String(byKind('prose').length).padStart(4)} occurrences  (emoji inside copy — stays emoji)`);
say(`  content   ${String(byKind('content').length).padStart(4)} occurrences  (funContent editorial — stays emoji)`);
say(`  catalog   ${String(byKind('catalog').length).padStart(4)} occurrences  (StyleGuide exhibit — renders the set)`);
say(`  sticker   ${String(byKind('sticker').length).padStart(4)} occurrences  (PhotoBooth content — out of scope)`);
say(`  symbol    ${String(byKind('symbol').length).padStart(4)} occurrences  (typographic marks — stay text)`);
say();
say(`  distinct glyphs in markers: ${uniq(markers.map((m) => m.glyph)).length}`);
say(`  → distinct icons to draw:   ${uniq(markers.map((m) => m.role)).length}`);
say();

say('OVERLOADED GLYPHS — one emoji, several meanings; each becomes its own icon');
say('-'.repeat(72));
for (const [glyph, roles] of overloaded.sort((a, b) => b[1].size - a[1].size)) {
  say(`  ${glyph}  ${[...roles].sort().join('  ·  ')}`);
}
say();

say('INCONSISTENT ROLES — one meaning drawn with several emoji today');
say('-'.repeat(72));
for (const [role, glyphs] of inconsistent.sort((a, b) => b[1].size - a[1].size)) {
  say(`  ${role.padEnd(34)} ${[...glyphs].join(' ')}`);
}
say();

// A game reachable from a tile AND owning a screen shows up twice: once as the
// route-derived role from the FunZone tile (`arcade.bowling`) and once as the
// component-derived role from its own hero glyph (`fun.bowling`). Those are one
// icon, and merging them is a naming decision, so surface the candidates rather
// than guessing. Containment rather than equality, because the route slug and
// the component name rarely agree exactly (`arcade.mole` ↔ `fun.whackamole`).
const tail = (role) => role.split('.').slice(1).join('.').replace(/[^a-z0-9]/g, '');
const roles = uniq(markers.map((m) => m.role)).sort();
const merges = [];
for (let i = 0; i < roles.length; i++) {
  for (let j = i + 1; j < roles.length; j++) {
    const [a, b] = [tail(roles[i]), tail(roles[j])];
    if (a.length < 4 || b.length < 4) continue;
    if (a.includes(b) || b.includes(a)) merges.push([roles[i], roles[j]]);
  }
}

say('PROBABLE MERGES — two roles, almost certainly one icon');
say('-'.repeat(72));
for (const [a, b] of merges) {
  const glyphs = uniq(markers.filter((m) => m.role === a || m.role === b).map((m) => m.glyph));
  say(`  ${a.padEnd(26)} ↔ ${b.padEnd(26)} ${glyphs.join('')}`);
}
say();

say('ROLES BY AREA');
say('-'.repeat(72));
for (const area of uniq(markers.map((m) => m.area)).sort()) {
  const inArea = markers.filter((m) => m.area === area);
  say(`  ${area}  (${uniq(inArea.map((m) => m.role)).length} icons)`);
  for (const role of uniq(inArea.map((m) => m.role)).sort()) {
    const sites = inArea.filter((m) => m.role === role);
    const flag = sites.some((s) => s.needsReview) ? ' ⚠' : '';
    say(`    ${uniq(sites.map((s) => s.glyph)).join('')}  ${role.padEnd(30)} ${sites.length} site${sites.length > 1 ? 's' : ''}${flag}`);
  }
  say();
}

say('⚠ = role inferred from the component name; confirm the name by hand.');

console.log(lines.join('\n'));

if (process.argv.includes('--json')) {
  const payload = {
    generated: 'scripts/icon-inventory.mjs',
    totals: {
      marker: byKind('marker').length,
      prose: byKind('prose').length,
      sticker: byKind('sticker').length,
      symbol: byKind('symbol').length,
      roles: uniq(markers.map((m) => m.role)).length,
    },
    overloaded: Object.fromEntries(overloaded.map(([g, r]) => [g, [...r].sort()])),
    inconsistent: Object.fromEntries(inconsistent.map(([r, g]) => [r, [...g]])),
    occurrences,
  };
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nwrote ${relative(REPO, OUT)}`);
}
