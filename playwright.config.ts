import { defineConfig, devices } from "@playwright/test";

// E2E runs its own dev server on a separate port with the offline fake language model, so a
// test run can never call the real API (or reuse a dev server that would).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Tests share the demo accounts' sessions and data, so run them one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // When E2E_BASE_URL is set (e.g. a Vercel preview), test that instead of a local server.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next dev --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { LLM_PROVIDER: "fake" },
      },
});
