// Vitest config for the Master Control admin SPA's component tests
// (admin/*.test.tsx). Separate from vite.admin.config.ts (the production
// build config) — tests don't need Tailwind processing or the dev proxy, and
// keeping them apart avoids the build config accreting test-only concerns.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // No `globals: true` — test files import describe/test/expect/vi
    // explicitly from 'vitest', matching this repo's explicit-import style
    // (server/'s node:test suite does the same) and avoiding a second global
    // ambient-types entry alongside tsconfig.admin.json's "vite/client".
    setupFiles: ['./admin/test-support/setup.ts'],
    include: ['admin/**/*.test.{ts,tsx}'],
  },
});
