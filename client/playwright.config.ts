import { defineConfig } from '@playwright/test'

// Acceptance ("does it actually work") harness for Even Scribe. Boots the REAL
// client through a Vite dev server (SDK native boundary mocked) and drives it with
// a headless browser, asserting on the glasses screen and the editor.
//
// Run: npm run e2e        (from even-scribe/client)
// One-time: npm run e2e:install   (downloads the Chromium binary)

const PORT = 5179

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'e2e-results.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx vite --config vite.acceptance.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
