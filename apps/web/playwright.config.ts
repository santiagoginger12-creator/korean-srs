// E2E against a production build served locally (build first: `npm run test:e2e` at the root
// does both). Chromium only offline: WebKit isn't installed in agent sessions (see report);
// set PW_WEBKIT=1 where it is.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
// Same normalization as build.ts: BASE=/repo/ (GitHub Pages) or / (default).
const BASE = `/${(process.env.BASE ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
const projects = [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }];
if (process.env.PW_WEBKIT) projects.push({ name: 'webkit', use: { ...devices['Desktop Safari'] } });

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './node_modules/.pw-output',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE}`,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects,
  webServer: {
    command: `tsx serve.ts --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}${BASE}`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
