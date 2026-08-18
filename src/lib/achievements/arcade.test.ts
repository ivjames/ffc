import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { ARCADE_GAME_KEYS } from './arcade';

// Guards the duplication arcade.ts documents: the roster there has to be the
// set of game keys the arcade actually reports, or "play all of them" silently
// becomes unearnable (a new game is added, nobody updates the list, the badge
// can never complete) or falsely earnable (a game is removed).
describe('arcade roster', () => {
  test('matches the game keys the fun-zone screens report', () => {
    // Both homes: the fun-zone screens, and Arcade Putt, which lives under
    // features/putt because it predates the arcade section.
    const dirs = [
      new URL('../../features/fun/', import.meta.url),
      new URL('../../features/putt/', import.meta.url),
    ];
    const keys = new Set<string>();
    for (const dir of dirs)
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.tsx') || file.endsWith('.test.tsx')) continue;
      const src = readFileSync(new URL(file, dir), 'utf8');
      // Scoped to the `game=` prop itself — both the literal spelling and the
      // bumper arena's ternary, which serves two games from one component. A
      // looser pattern picks up every unrelated ternary in the file.
      for (const m of src.matchAll(/game=(?:"([a-z]+)"|\{([^}]*)\})/g)) {
        if (m[1]) {
          keys.add(m[1]);
          continue;
        }
        const expr = m[2] ?? '';
        // A ternary yields two games; anything before the `?` is the condition
        // (`theme.kind === 'car'`) and is not a game key.
        const ternary = expr.match(/\?\s*['"]([a-z]+)['"]\s*:\s*['"]([a-z]+)['"]/);
        if (ternary) {
          keys.add(ternary[1]);
          keys.add(ternary[2]);
        } else {
          for (const q of expr.matchAll(/['"]([a-z]+)['"]/g)) keys.add(q[1]);
        }
      }
    }
    expect([...keys].sort()).toEqual([...ARCADE_GAME_KEYS].sort());
  });
});
