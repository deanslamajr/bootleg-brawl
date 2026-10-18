import { defineConfig, devices } from "@playwright/test";

// The integration test runs against the built dist/ (pnpm build), served by vite preview.
// Make sure that nothing else listens on port 4180 before a run.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.SMOKE_URL ?? "http://localhost:4180/",
    trace: "retain-on-failure",
    viewport: { width: 960, height: 540 },
  },
  webServer: process.env.SMOKE_URL
    ? undefined
    : {
        command: "pnpm preview",
        url: "http://localhost:4180/",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 960, height: 540 } },
      testMatch: /(boot|pause|layout)\.spec\.ts/,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 960, height: 540 } },
      testMatch: /boot\.spec\.ts/,
    },
    { name: "perf", use: { ...devices["Desktop Chrome"] }, testMatch: /perf\.spec\.ts/ },
    { name: "smoke", use: { ...devices["Desktop Chrome"] }, testMatch: /smoke\.spec\.ts/ },
  ],
});
