import { defineConfig } from '@playwright/test';

/**
 * E2E tests (CLAUDE.md §3, §14). Multiplayer specs open separate browser contexts (separate
 * IndexedDB → separate device identities) against the `local` configuration, which uses the
 * Supabase project in src/environments/environment.local.ts. Tests that need it skip when
 * that file has no keys.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4310',
    // Uses the installed Chrome (no browser download needed).
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  // Two servers: the dev server for most specs, and a production build with the service worker
  // for the offline spec (ng serve doesn't ship a service worker).
  webServer: [
    {
      command: 'npx ng serve --configuration local --port 4310',
      url: 'http://localhost:4310',
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      // Never reused: a leftover server would serve a stale build and the offline spec would
      // silently test old code.
      command: 'npm run serve:pwa',
      url: 'http://localhost:4311',
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
