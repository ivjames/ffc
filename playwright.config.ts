// e2e config for the Master Control admin SPA. Unlike admin/*.test.tsx
// (Vitest + RTL, mocked api.ts), these drive a real browser against the real
// Express API + Postgres — the login flow's manual verification caught two
// real bugs a mocked component test couldn't have (cookie/credentials
// handling, the actual server's 401 response shape), so this layer is
// complementary, not redundant.
//
// Requires a reachable Postgres at E2E_DATABASE_URL / TEST_DATABASE_URL
// (default postgres://postgres:postgres@localhost:5432/ffc_test — same
// database server/'s own test suite uses). global-setup.ts seeds two fixed
// admin_user accounts + an org; global-teardown.ts removes them.
import { defineConfig, devices } from '@playwright/test';

const API_PORT = 8060;
const ADMIN_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false, // tests share the seeded DB fixtures — keep them serial
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${ADMIN_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node index.js',
      cwd: 'server',
      url: `http://localhost:${API_PORT}/api/health`,
      env: {
        DATABASE_URL:
          process.env.E2E_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/ffc_test',
        PORT: String(API_PORT),
        APP_TOKEN: 'e2e-app-token',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: 'npx vite --config vite.admin.config.ts',
      url: `http://localhost:${ADMIN_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
