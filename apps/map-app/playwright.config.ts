import { defineConfig } from '@playwright/test';

const externalVisualServer = process.env.KATU_VISUAL_SERVER === 'external';

export default defineConfig({
  testDir: './tests/visual', outputDir: 'test-results/visual-artifacts', timeout: 90_000,
  expect: { timeout: 10_000 }, fullyParallel: true, workers: process.env.CI ? 2 : 1,
  reporter: [['line'], ['./tests/visual/report-reporter.ts']],
  use: {
    baseURL: 'http://127.0.0.1:4173', locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  webServer: externalVisualServer ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_DIGITRANSIT_SUBSCRIPTION_KEY: 'visual-fixture-key' },
  },
});
