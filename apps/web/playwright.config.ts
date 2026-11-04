// E2E against production builds served locally. `npm run test:e2e` (root) first builds two
// targets via tests/e2e/build-e2e.ts:
//   fixture   – the 10-item M1 fixture seed; all behavioural tests (content-independent)
//   real-seed – the live packages/content/seed; one smoke test + the owner's screenshots
// Chromium only: WebKit isn't installed in agent sessions; set PW_WEBKIT=1 where it is.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const REAL_PORT = PORT + 1;
const UPDATE_PORT = PORT + 2;
const ARTIFACT_PORT = PORT + 3;
// Same normalization as build.ts: BASE=/repo/ (GitHub Pages) or / (default).
const BASE = `/${(process.env.BASE ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
const url = (port: number) => `http://127.0.0.1:${port}${BASE}`;

const browsers = [{ name: 'chromium', use: devices['Desktop Chrome'] }];
if (process.env.PW_WEBKIT) browsers.push({ name: 'webkit', use: devices['Desktop Safari'] });

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './node_modules/.pw-output',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: { serviceWorkers: 'allow', trace: 'retain-on-failure' },
  projects: browsers.flatMap((b) => [
    { name: `fixture-${b.name}`, testMatch: /(app|dashboard|data|study|pwa|m5-qa|master|grammar|examples|sync|keyboard)\.spec\.ts/, use: { ...b.use, baseURL: url(PORT) } },
    { name: `update-${b.name}`, testMatch: 'update.spec.ts', use: { ...b.use, baseURL: url(UPDATE_PORT) } },
    { name: `real-seed-${b.name}`, testMatch: 'real-seed.spec.ts', use: { ...b.use, baseURL: url(REAL_PORT) } },
    { name: `artifact-${b.name}`, testMatch: 'hosted.spec.ts', use: { ...b.use, baseURL: url(ARTIFACT_PORT) } },
  ]),
  webServer: [
    { command: `tsx serve.ts --port ${PORT} --dir node_modules/.e2e/fixture`, url: url(PORT), reuseExistingServer: false, timeout: 20_000 },
    { command: `tsx serve.ts --port ${REAL_PORT} --dir node_modules/.e2e/real`, url: url(REAL_PORT), reuseExistingServer: false, timeout: 20_000 },
    { command: `tsx serve.ts --port ${UPDATE_PORT} --dir node_modules/.e2e/update`, url: url(UPDATE_PORT), reuseExistingServer: false, timeout: 20_000 },
    { command: `tsx serve.ts --port ${ARTIFACT_PORT} --dir node_modules/.e2e/artifact`, url: url(ARTIFACT_PORT), reuseExistingServer: false, timeout: 20_000 },
  ],
});
