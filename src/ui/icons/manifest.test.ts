import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ICONS, ROLE_ICONS, type IconName, type IconSpec } from './manifest';
import { ICON_ART } from './registry';

// Keeps the three moving parts honest about each other:
//
//   scripts/icon-inventory.json   what the app actually uses  (generated)
//   manifest.ts                   what each of those means    (hand-curated)
//   registry.tsx                  what it looks like          (hand-drawn)
//
// The failure this guards against is silent: someone adds an emoji to a screen,
// nobody re-runs the inventory, and the icon set quietly stops describing the
// app — which is exactly how StyleGuide §13 drifted. Regenerate with
// `node scripts/icon-inventory.mjs --json` and add the mapping when this fails.

type Inventory = {
  occurrences: { kind: string; role: string; glyph: string; file: string; line: number }[];
};

const inventory: Inventory = JSON.parse(
  readFileSync(new URL('../../../scripts/icon-inventory.json', import.meta.url), 'utf8'),
);

/** Every distinct `"<role> <glyph>"` the app renders as a UI marker. */
const pairs = [
  ...new Map(
    inventory.occurrences
      .filter((o) => o.kind === 'marker')
      .map((o) => [`${o.role} ${o.glyph}`, o] as const),
  ),
];

describe('icon manifest', () => {
  it('names every marker the inventory found', () => {
    const unmapped = pairs
      .filter(([key]) => !(key in ROLE_ICONS))
      .map(([key, o]) => `${key}  (${o.file}:${o.line})`);
    expect(unmapped).toEqual([]);
  });

  // Deliberately NOT the reverse of the check above. ROLE_ICONS is a migration
  // ledger, and a mapping outliving its emoji is the SUCCESS case: once a call
  // site renders <Icon>, its glyph leaves the inventory but the record of what
  // that glyph used to mean is the thing you need when the art is questioned
  // later. Asserting "no mapping without a live marker" would have failed on
  // every screen the moment it was migrated.
  //
  // The forward direction above is the one that catches drift — a new emoji
  // appearing on a screen with nobody deciding what it means.
  it('maps every ledger entry to a real icon', () => {
    const bad = Object.entries(ROLE_ICONS).filter(([, icon]) => !(icon in ICONS));
    expect(bad).toEqual([]);
  });

  it('maps every role to an icon that is actually defined', () => {
    const undefinedTargets = [...new Set(Object.values(ROLE_ICONS))].filter((n) => !(n in ICONS));
    expect(undefinedTargets).toEqual([]);
  });

  it('defines no icon that nothing uses', () => {
    const used = new Set<IconName>(Object.values(ROLE_ICONS));
    expect(Object.keys(ICONS).filter((n) => !used.has(n as IconName))).toEqual([]);
  });

  // `means` can be as short as "Darts." — the name carries it. `draw` cannot:
  // it is the brief an illustrator works from, and a one-word brief guarantees
  // two people draw two different things.
  it('gives every icon a meaning and a usable drawing brief', () => {
    const thin = Object.entries(ICONS)
      .filter(([, spec]) => !spec.means.trim() || spec.draw.trim().length < 20)
      .map(([name]) => name);
    expect(thin).toEqual([]);
  });

  // The reason the library exists. Where one emoji carried several meanings the
  // icons that replaced it must stay separate, and each must say what it is not
  // — otherwise the next person to touch the art re-merges them by accident.
  it('records the distinction wherever one emoji served several icons', () => {
    const specs = Object.entries(ICONS) as [IconName, IconSpec][];
    const byPlaceholder = new Map<string, [IconName, IconSpec][]>();
    for (const entry of specs) {
      byPlaceholder.set(entry[1].placeholder, [...(byPlaceholder.get(entry[1].placeholder) ?? []), entry]);
    }

    const silentlyMerged = [...byPlaceholder]
      .filter(([, sharing]) => sharing.length > 1)
      .flatMap(([glyph, sharing]) =>
        sharing.filter(([, spec]) => !spec.not).map(([n]) => `${n} shares ${glyph} but has no \`not:\``),
      );
    expect(silentlyMerged).toEqual([]);
  });
});

describe('icon registry', () => {
  it('draws only icons the manifest names', () => {
    expect(Object.keys(ICON_ART).filter((n) => !(n in ICONS))).toEqual([]);
  });

  it('has art for every arcade game, so the FunZone grid is complete', () => {
    const games = Object.keys(ICONS).filter((n) => n.startsWith('game.'));
    expect(games.filter((n) => !(n in ICON_ART))).toEqual([]);
  });
});
