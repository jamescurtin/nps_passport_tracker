// Browser e2e tests against the production build (`npm run build` first).
// Chromium only; the iPhone project emulates a touch screen, so
// `(pointer: coarse)` matches as on a real phone.
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The app sets zoom and sheet durations to 0 under reduced motion, so
    // assertions do not race the 750ms zoom or the sheet entry transition.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "iphone",
      testMatch: /mobile-.*\.spec\.js/,
      // The preset defaults to WebKit; only Chromium is installed.
      use: { ...devices["iPhone 14"], browserName: "chromium" },
    },
    {
      name: "desktop",
      testMatch: /(desktop-.*|deep-links|offline)\.spec\.js/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npx http-server dist -p ${PORT} -a 127.0.0.1 -c-1 --silent`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
