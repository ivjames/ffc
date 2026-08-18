// Vitest config for the player app's pure-logic tests (src/**/*.test.ts).
// Mirrors vitest.admin.config.ts's explicit-import style; node environment is
// enough — these are pure modules (no DOM), e.g. the shared-round LWW merge.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // scripts/ too: the content generator rewrites src/data/content.generated.ts
    // (types included) on every deploy, so its template is load-bearing and
    // needs the same gate the app modules get.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
});
