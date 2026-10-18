import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}/kiosk-video-nfc-website/`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // Google Chrome rather than bundled Chromium: the fixtures are H.264, and
      // Chrome is the production browser.
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/kiosk-video-nfc-website/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
