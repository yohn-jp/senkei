import { defineConfig, devices } from "@playwright/test";

// SSR component evidence is independent of the deployed production journey.
export default defineConfig({
  testDir: "./component-specs",
  testMatch: "skill-run-context.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "./test-results/skill-components",
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    launchOptions: {
      ...(process.env.SENKEI_CHROMIUM_EXECUTABLE ? { executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE } : {}),
      args: ["--no-sandbox"],
    },
  },
});
