import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { render } from './export-content.mjs';

// This generator rewrites src/data/content.generated.ts — TYPES INCLUDED — on
// every build that can reach a live API. That makes drift between the two a
// deploy-only failure: the repo builds fine (no API, committed file kept),
// and the droplet's build breaks at the moment it regenerates.
//
// That is exactly how `modules` got lost. #202 added the field to the
// committed file and to src/data/courses.ts, but not to the template here, so
// the next real deploy regenerated a type without it and tsc failed on
// `l.modules` — after the merge, in the one place nobody had run.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMITTED = readFileSync(join(ROOT, 'src', 'data', 'content.generated.ts'), 'utf8');

const LOCATION = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Upland',
  slug: 'upland',
  lat: 34.08867,
  lng: -117.67946,
  geofenceKm: 2,
  tz: 'America/Los_Angeles',
  sortOrder: 10,
  menuUrl: null,
  orderingUrl: null,
  hours: null,
  pos: null,
  orgId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

/** The field names declared on the emitted GeneratedLocation type. */
function typeFields(source) {
  const block = source.match(/export type GeneratedLocation = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('no GeneratedLocation type in source');
  // Top-level keys only — nested object literals (pos) are indented deeper.
  return [...block[1].matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]).sort();
}

/** The field names actually written into a location literal. */
function emittedFields(source) {
  const block = source.match(/GENERATED_LOCATIONS: GeneratedLocation\[\] = \[\n {2}\{([\s\S]*?)\n {2}\},/);
  if (!block) throw new Error('no location literal in source');
  return [...block[1].matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]).sort();
}

describe('the generated content type', () => {
  test('matches the committed file it overwrites', () => {
    // The guard that was missing. If a field is added to
    // src/data/content.generated.ts by hand (or by an older generator) and not
    // to the template here, the next deploy silently drops it — this fails in
    // the repo instead, where someone is looking.
    expect(typeFields(render([LOCATION], []))).toEqual(typeFields(COMMITTED));
  });

  test('declares every field it writes', () => {
    const emitted = emittedFields(render([{ ...LOCATION, modules: { arcade: true } }], []));
    const declared = typeFields(render([LOCATION], []));
    expect(emitted.filter((f) => !declared.includes(f))).toEqual([]);
  });
});

describe('module entitlements', () => {
  test('a venue with resolved modules bakes them', () => {
    const out = render([{ ...LOCATION, modules: { arcade: true, ordering: false } }], []);
    expect(out).toContain('modules: {"arcade":true,"ordering":false},');
  });

  test('a venue without them omits the key rather than baking null', () => {
    // Absent means "derive from pos" (src/lib/modules.ts). `null` would fail
    // the optional type, and `{}` would be a claim the server never made.
    const out = render([LOCATION], []);
    expect(out).not.toMatch(/modules: (null|\{\})/);
    expect(emittedFields(out)).not.toContain('modules');
  });
});
