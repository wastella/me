// Browser tests: they start the built app against a throwaway database in a
// temp folder (never data/me.db, never the cloud database) and click through
// it at desktop and phone size.   npm run test:e2e
import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'me-e2e-'));

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3737', timezoneId: 'America/New_York', colorScheme: 'dark', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: 'npx next start -H 127.0.0.1 -p 3737',
    url: 'http://localhost:3737/api/tasks',
    reuseExistingServer: false,   // never run against a server that might hold real data
    timeout: 60_000,
    // Empty values switch off the cloud database, sign-in and outside services for the test run.
    env: { ME_DATA_DIR: dataDir, ME_TZ: 'America/New_York', TZ: 'America/New_York', TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', SESSION_SECRET: '', MCP_TOKEN: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' },
  },
});
