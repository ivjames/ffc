// Vitest config for the player app's pure-logic tests (src/**/*.test.ts).
// Mirrors vitest.admin.config.ts's explicit-import style; node environment is
// enough — these are pure modules (no DOM), e.g. the shared-round LWW merge.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
